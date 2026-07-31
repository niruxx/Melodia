use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rodio::source::SeekError;
use rodio::{ChannelCount, Sample, SampleRate, Source};

pub const BAND_COUNT: usize = 5;
pub const BAND_FREQS_HZ: [f32; BAND_COUNT] = [60.0, 250.0, 1000.0, 4000.0, 12000.0];
const Q: f32 = 1.0;
const MAX_GAIN_DB: f32 = 12.0;

/// Lock-free, shared graphic-EQ gain state. Reads happen on the real-time
/// audio thread (inside the `Equalizer` `Source` wrapper below); writes come
/// from a Tauri command handler on a different thread — atomics avoid ever
/// blocking the audio callback on a lock for a UI-driven settings change.
/// Gains are dB, stored fixed-point (×100) since `f32` isn't atomic.
pub struct EqGains {
    bands_db_x100: [AtomicI32; BAND_COUNT],
}

impl EqGains {
    pub fn flat() -> Arc<Self> {
        Arc::new(Self {
            bands_db_x100: [
                AtomicI32::new(0),
                AtomicI32::new(0),
                AtomicI32::new(0),
                AtomicI32::new(0),
                AtomicI32::new(0),
            ],
        })
    }

    pub fn set_all(&self, bands_db: &[f32; BAND_COUNT]) {
        for (slot, db) in self.bands_db_x100.iter().zip(bands_db) {
            slot.store((db.clamp(-MAX_GAIN_DB, MAX_GAIN_DB) * 100.0) as i32, Ordering::Relaxed);
        }
    }

    fn raw(&self, index: usize) -> i32 {
        self.bands_db_x100[index].load(Ordering::Relaxed)
    }
}

#[derive(Clone, Copy, Default)]
struct BiquadCoeffs {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
}

impl BiquadCoeffs {
    /// RBJ Audio-EQ-Cookbook peaking-EQ biquad (http://www.musicdsp.org/files/Audio-EQ-Cookbook.txt).
    fn peaking(freq: f32, sample_rate: f32, q: f32, gain_db: f32) -> Self {
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq / sample_rate;
        let (sin_w0, cos_w0) = w0.sin_cos();
        let alpha = sin_w0 / (2.0 * q);

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos_w0;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha / a;

        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
        }
    }
}

#[derive(Clone, Copy, Default)]
struct BiquadState {
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl BiquadState {
    #[inline]
    fn process(&mut self, c: &BiquadCoeffs, x0: f32) -> f32 {
        let y0 = c.b0 * x0 + c.b1 * self.x1 + c.b2 * self.x2 - c.a1 * self.y1 - c.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x0;
        self.y2 = self.y1;
        self.y1 = y0;
        y0
    }
}

/// A 5-band graphic EQ `Source` wrapper. Each channel gets its own biquad
/// state per band (interleaved samples mean a shared state would otherwise
/// mix L/R filter history — a bug present in rodio's own single-band
/// `BltFilter`, which this avoids).
pub struct Equalizer<I> {
    input: I,
    gains: Arc<EqGains>,
    channels: usize,
    channel_index: usize,
    states: Vec<[BiquadState; BAND_COUNT]>,
    coeffs: [BiquadCoeffs; BAND_COUNT],
    last_gain_x100: [i32; BAND_COUNT],
    sample_rate: f32,
}

impl<I> Equalizer<I>
where
    I: Source<Item = Sample>,
{
    pub fn new(input: I, gains: Arc<EqGains>) -> Self {
        let channels = input.channels().get().max(1) as usize;
        let sample_rate = input.sample_rate().get() as f32;

        let mut coeffs = [BiquadCoeffs::default(); BAND_COUNT];
        let mut last_gain_x100 = [0i32; BAND_COUNT];
        for i in 0..BAND_COUNT {
            let raw = gains.raw(i);
            coeffs[i] = BiquadCoeffs::peaking(BAND_FREQS_HZ[i], sample_rate, Q, raw as f32 / 100.0);
            last_gain_x100[i] = raw;
        }

        Self {
            input,
            gains,
            channels,
            channel_index: 0,
            states: vec![[BiquadState::default(); BAND_COUNT]; channels],
            coeffs,
            last_gain_x100,
            sample_rate,
        }
    }
}

impl<I> Iterator for Equalizer<I>
where
    I: Source<Item = Sample>,
{
    type Item = Sample;

    #[inline]
    fn next(&mut self) -> Option<Sample> {
        let sample = self.input.next()?;

        for i in 0..BAND_COUNT {
            let raw = self.gains.raw(i);
            if raw != self.last_gain_x100[i] {
                self.coeffs[i] =
                    BiquadCoeffs::peaking(BAND_FREQS_HZ[i], self.sample_rate, Q, raw as f32 / 100.0);
                self.last_gain_x100[i] = raw;
            }
        }

        let ch = self.channel_index;
        self.channel_index = (self.channel_index + 1) % self.channels;

        let state = &mut self.states[ch];
        let mut x = sample;
        for i in 0..BAND_COUNT {
            x = state[i].process(&self.coeffs[i], x);
        }
        Some(x)
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.input.size_hint()
    }
}

impl<I> Source for Equalizer<I>
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Feeds a 1kHz sine wave through a single peaking band centered at
    /// 1kHz and checks the output amplitude actually moves in the expected
    /// direction for a boost vs. a cut, and stays flat (no NaN/blowup) at 0dB.
    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
    }

    fn run_band(gain_db: f32, freq: f32, sample_rate: f32, n: usize) -> Vec<f32> {
        let coeffs = BiquadCoeffs::peaking(freq, sample_rate, Q, gain_db);
        let mut state = BiquadState::default();
        (0..n)
            .map(|i| {
                let t = i as f32 / sample_rate;
                let x = (2.0 * std::f32::consts::PI * freq * t).sin();
                state.process(&coeffs, x)
            })
            .collect()
    }

    #[test]
    fn boost_increases_amplitude_at_center_freq() {
        let sr = 44100.0;
        let flat = run_band(0.0, 1000.0, sr, 4096);
        let boosted = run_band(12.0, 1000.0, sr, 4096);
        let cut = run_band(-12.0, 1000.0, sr, 4096);

        // Skip the filter's transient settling period at the start.
        let steady = |v: &[f32]| rms(&v[1024..]);

        assert!(steady(&boosted) > steady(&flat) * 1.5, "boost should raise amplitude");
        assert!(steady(&cut) < steady(&flat) * 0.7, "cut should lower amplitude");
        assert!(boosted.iter().all(|s| s.is_finite()), "no NaN/inf in boosted output");
    }

    #[test]
    fn flat_gain_is_near_unity() {
        let sr = 44100.0;
        let flat = run_band(0.0, 1000.0, sr, 4096);
        let input_rms = {
            let n = 4096;
            let samples: Vec<f32> = (0..n)
                .map(|i| (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / sr).sin())
                .collect();
            rms(&samples[1024..])
        };
        let output_rms = rms(&flat[1024..]);
        assert!(
            (output_rms - input_rms).abs() < 0.05,
            "0dB band should leave amplitude ~unchanged: in={input_rms} out={output_rms}"
        );
    }
}
