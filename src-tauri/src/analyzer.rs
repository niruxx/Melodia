use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rodio::source::SeekError;
use rodio::{ChannelCount, Sample, SampleRate, Source};
use rustfft::{num_complex::Complex, FftPlanner};
use tauri::{AppHandle, Emitter};

/// Samples per FFT window. At 44.1kHz this is ~23ms of audio — long enough
/// for usable low-frequency resolution, short enough to feel responsive.
const FFT_SIZE: usize = 1024;
/// Number of log-spaced bars emitted to the UI.
pub const BAND_COUNT: usize = 32;
const EMIT_INTERVAL: Duration = Duration::from_millis(33);
/// Envelope coefficients: bars jump up quickly but fall back gently, which
/// reads as "musical" rather than jittery.
const ATTACK: f32 = 0.55;
const DECAY: f32 = 0.12;

/// Shared, lock-light hand-off between the audio thread and the FFT thread.
pub struct SpectrumTap {
    /// Most recent mono samples. Guarded by a mutex the audio thread only ever
    /// `try_lock`s — see `Analyzer::next`.
    buffer: Mutex<Vec<f32>>,
    active: AtomicBool,
}

impl SpectrumTap {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            buffer: Mutex::new(vec![0.0; FFT_SIZE]),
            active: AtomicBool::new(false),
        })
    }

    /// Marks whether audio is currently flowing, so the FFT thread can idle.
    pub fn set_active(&self, active: bool) {
        self.active.store(active, Ordering::Relaxed);
    }
}

/// A `Source` wrapper that copies audio through untouched while tapping a
/// mono mixdown for visualisation. Mirrors the `Equalizer` wrapper's shape.
pub struct Analyzer<I> {
    input: I,
    tap: Arc<SpectrumTap>,
    channels: usize,
    channel_index: usize,
    frame_accum: f32,
    scratch: Vec<f32>,
}

impl<I> Analyzer<I>
where
    I: Source<Item = Sample>,
{
    pub fn new(input: I, tap: Arc<SpectrumTap>) -> Self {
        let channels = input.channels().get().max(1) as usize;
        Self {
            input,
            tap,
            channels,
            channel_index: 0,
            frame_accum: 0.0,
            scratch: Vec::with_capacity(FFT_SIZE),
        }
    }
}

impl<I> Iterator for Analyzer<I>
where
    I: Source<Item = Sample>,
{
    type Item = Sample;

    #[inline]
    fn next(&mut self) -> Option<Sample> {
        let sample = self.input.next()?;

        // Average across channels so the visualiser sees one mono stream.
        self.frame_accum += sample;
        self.channel_index += 1;
        if self.channel_index >= self.channels {
            self.scratch.push(self.frame_accum / self.channels as f32);
            self.channel_index = 0;
            self.frame_accum = 0.0;

            if self.scratch.len() >= FFT_SIZE {
                // `try_lock`, never `lock`: the audio thread must never block
                // waiting on the FFT thread. Dropping the odd window is
                // invisible in a 30fps visualiser.
                if let Ok(mut buf) = self.tap.buffer.try_lock() {
                    buf.clear();
                    buf.extend_from_slice(&self.scratch);
                }
                self.scratch.clear();
            }
        }

        Some(sample)
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.input.size_hint()
    }
}

impl<I> Source for Analyzer<I>
where
    I: Source<Item = Sample>,
{
    #[inline]
    fn current_span_len(&self) -> Option<usize> {
        self.input.current_span_len()
    }
    #[inline]
    fn channels(&self) -> ChannelCount {
        self.input.channels()
    }
    #[inline]
    fn sample_rate(&self) -> SampleRate {
        self.input.sample_rate()
    }
    #[inline]
    fn total_duration(&self) -> Option<Duration> {
        self.input.total_duration()
    }
    #[inline]
    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.input.try_seek(pos)
    }
}

/// Edges of `BAND_COUNT` log-spaced buckets over the FFT's usable bins.
/// Logarithmic because pitch perception is — linear buckets would cram every
/// musically interesting frequency into the first couple of bars.
fn band_edges(bins: usize) -> Vec<usize> {
    let min_bin = 1.0f32;
    let max_bin = bins as f32;
    (0..=BAND_COUNT)
        .map(|i| {
            let t = i as f32 / BAND_COUNT as f32;
            let bin = min_bin * (max_bin / min_bin).powf(t);
            (bin.round() as usize).clamp(1, bins)
        })
        .collect()
}

/// Turns one window of samples into normalised 0..1 band magnitudes.
pub fn compute_bands(samples: &[f32], planner: &mut FftPlanner<f32>) -> Vec<f32> {
    let n = samples.len().min(FFT_SIZE);
    if n == 0 {
        return vec![0.0; BAND_COUNT];
    }

    let fft = planner.plan_fft_forward(n);
    let mut buf: Vec<Complex<f32>> = samples[..n]
        .iter()
        .enumerate()
        .map(|(i, &s)| {
            // Hann window suppresses spectral leakage from the hard window edges.
            let w = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / n as f32).cos());
            Complex::new(s * w, 0.0)
        })
        .collect();
    fft.process(&mut buf);

    let usable = n / 2;
    let edges = band_edges(usable);
    let mut bands = Vec::with_capacity(BAND_COUNT);

    for b in 0..BAND_COUNT {
        let (lo, hi) = (edges[b], edges[b + 1].max(edges[b] + 1));
        let slice = &buf[lo.min(usable)..hi.min(usable).max(lo.min(usable))];
        let peak = slice.iter().map(|c| c.norm()).fold(0.0f32, f32::max);
        // dB-ish curve: raw magnitudes are far too spiky to look good directly.
        let scaled = (1.0 + peak).ln() / 4.0;
        bands.push(scaled.clamp(0.0, 1.0));
    }
    bands
}

/// Spawns the thread that periodically FFTs the tap and emits `playback:spectrum`.
pub fn spawn_emitter(app: AppHandle, tap: Arc<SpectrumTap>) {
    std::thread::spawn(move || {
        let mut planner = FftPlanner::<f32>::new();
        let mut smoothed = vec![0.0f32; BAND_COUNT];
        let mut was_active = false;

        loop {
            std::thread::sleep(EMIT_INTERVAL);

            if !tap.active.load(Ordering::Relaxed) {
                // Emit one final all-zero frame so the UI settles to a flat
                // line instead of freezing mid-spectrum, then go quiet.
                if was_active {
                    smoothed.iter_mut().for_each(|v| *v = 0.0);
                    let _ = app.emit("playback:spectrum", &smoothed);
                    was_active = false;
                }
                continue;
            }
            was_active = true;

            let snapshot = match tap.buffer.try_lock() {
                Ok(buf) => buf.clone(),
                Err(_) => continue,
            };

            let bands = compute_bands(&snapshot, &mut planner);
            for (s, b) in smoothed.iter_mut().zip(&bands) {
                let coeff = if *b > *s { ATTACK } else { DECAY };
                *s += (*b - *s) * coeff;
            }
            let _ = app.emit("playback:spectrum", &smoothed);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, sample_rate: f32, n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / sample_rate).sin())
            .collect()
    }

    #[test]
    fn band_edges_are_monotonic_and_in_range() {
        let edges = band_edges(512);
        assert_eq!(edges.len(), BAND_COUNT + 1);
        for pair in edges.windows(2) {
            assert!(pair[1] >= pair[0], "edges must be non-decreasing: {edges:?}");
        }
        assert!(*edges.last().unwrap() <= 512);
    }

    #[test]
    fn a_tone_peaks_above_the_noise_floor() {
        let mut planner = FftPlanner::<f32>::new();
        let bands = compute_bands(&sine(1000.0, 44100.0, FFT_SIZE), &mut planner);

        assert_eq!(bands.len(), BAND_COUNT);
        assert!(bands.iter().all(|b| b.is_finite()), "no NaN/inf in output");
        assert!(bands.iter().all(|b| (0.0..=1.0).contains(b)), "bands stay normalised");

        let peak_idx = bands
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .unwrap()
            .0;
        let mean = bands.iter().sum::<f32>() / BAND_COUNT as f32;
        assert!(
            bands[peak_idx] > mean * 2.0,
            "a pure tone should stand well clear of the average: {bands:?}"
        );
    }

    #[test]
    fn a_higher_tone_peaks_in_a_higher_band() {
        let mut planner = FftPlanner::<f32>::new();
        let mut peak_of = |freq: f32| {
            compute_bands(&sine(freq, 44100.0, FFT_SIZE), &mut planner)
                .iter()
                .enumerate()
                .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
                .unwrap()
                .0
        };
        assert!(
            peak_of(400.0) < peak_of(5000.0),
            "band index should track frequency"
        );
    }

    #[test]
    fn silence_produces_no_energy() {
        let mut planner = FftPlanner::<f32>::new();
        let bands = compute_bands(&vec![0.0; FFT_SIZE], &mut planner);
        assert!(bands.iter().all(|b| *b < 1e-6), "silence should be flat: {bands:?}");
    }
}
