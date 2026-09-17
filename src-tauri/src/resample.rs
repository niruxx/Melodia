use std::time::Duration;

use rodio::source::SeekError;
use rodio::{ChannelCount, Sample, SampleRate, Source};
use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Indexing, Resampler};

/// Input frames per resampler call. Large enough for the FFT resampler to be
/// efficient, small enough that a seek or track start doesn't wait on it.
const CHUNK_FRAMES: usize = 1024;

/// Converts a source to another sample rate with a band-limited (FFT) resampler.
///
/// rodio's built-in converter interpolates linearly, which folds everything
/// above the new Nyquist frequency back down as audible aliasing. This one
/// filters properly, and trims its own processing delay at both ends so the
/// output lines up with the input — without that, every resampled track would
/// start late and end with silence, which gapless playback would expose.
pub struct Resampled<I> {
    input: I,
    resampler: Fft<f32>,
    channels: usize,
    rate_in: u32,
    rate_out: SampleRate,
    in_buf: Vec<f32>,
    out_buf: Vec<f32>,
    out_pos: usize,
    out_len: usize,
    /// Leading output samples still to discard (the resampler's delay).
    skip: usize,
    in_frames: u64,
    out_frames: u64,
    input_done: bool,
}

impl<I> Resampled<I>
where
    I: Source,
{
    /// Returns the source unchanged (boxed) when no conversion is needed, or
    /// when the resampler can't be built for this ratio.
    pub fn wrap(input: I, rate_out: u32) -> Box<dyn Source + Send>
    where
        I: Send + 'static,
    {
        if input.sample_rate().get() == rate_out {
            return Box::new(input);
        }
        match Self::new(input, rate_out) {
            Ok(r) => Box::new(r),
            Err(input) => Box::new(input),
        }
    }

    fn new(input: I, rate_out: u32) -> Result<Self, I> {
        let channels = input.channels().get() as usize;
        let rate_in = input.sample_rate().get();
        let Ok(resampler) = Fft::<f32>::new(
            rate_in as usize,
            rate_out as usize,
            CHUNK_FRAMES,
            channels,
            FixedSync::Input,
        ) else {
            return Err(input);
        };
        let Some(rate_out_nz) = SampleRate::new(rate_out) else {
            return Err(input);
        };
        let out_cap = resampler.output_frames_max() * channels;
        let skip = resampler.output_delay() * channels;
        Ok(Self {
            input,
            resampler,
            channels,
            rate_in,
            rate_out: rate_out_nz,
            in_buf: Vec::with_capacity(CHUNK_FRAMES * channels),
            out_buf: vec![0.0; out_cap],
            out_pos: 0,
            out_len: 0,
            skip,
            in_frames: 0,
            out_frames: 0,
            input_done: false,
        })
    }

    /// How many output frames the input so far should become in total.
    fn expected_out_frames(&self) -> u64 {
        let (num, den) = (self.rate_out.get() as u64, self.rate_in as u64);
        (self.in_frames * num).div_ceil(den)
    }

    /// Runs one resampler chunk. Returns false once everything is out.
    fn refill(&mut self) -> bool {
        if self.input_done && self.out_frames >= self.expected_out_frames() {
            return false;
        }

        let want = self.resampler.input_frames_next() * self.channels;
        self.in_buf.clear();
        if !self.input_done {
            while self.in_buf.len() < want {
                match self.input.next() {
                    Some(s) => self.in_buf.push(s),
                    None => {
                        self.input_done = true;
                        break;
                    }
                }
            }
        }
        // A stream that ended mid-frame is padded out to a whole frame.
        let frames = self.in_buf.len().div_ceil(self.channels);
        self.in_buf.resize(frames * self.channels, 0.0);
        self.in_frames += frames as u64;

        let full = frames * self.channels == want;
        let indexing = (!full).then(|| Indexing::new().partial_len(frames));
        // The resampler reads a full chunk regardless of `partial_len`.
        let mut padded;
        let input: &[f32] = if full {
            &self.in_buf
        } else {
            padded = self.in_buf.clone();
            padded.resize(want, 0.0);
            &padded
        };
        let chunk = want / self.channels;
        let out_frames_cap = self.out_buf.len() / self.channels;
        let (Ok(adapter_in), Ok(mut adapter_out)) = (
            InterleavedSlice::new(input, self.channels, chunk),
            InterleavedSlice::new_mut(&mut self.out_buf, self.channels, out_frames_cap),
        ) else {
            return false;
        };
        let Ok((_, produced)) =
            self.resampler
                .process_into_buffer(&adapter_in, &mut adapter_out, indexing.as_ref())
        else {
            return false;
        };

        self.out_pos = 0;
        self.out_len = produced * self.channels;
        true
    }
}

impl<I> Iterator for Resampled<I>
where
    I: Source,
{
    type Item = Sample;

    fn next(&mut self) -> Option<Sample> {
        loop {
            if self.out_pos < self.out_len {
                let sample = self.out_buf[self.out_pos];
                self.out_pos += 1;
                if self.skip > 0 {
                    self.skip -= 1;
                    continue;
                }
                // Past the end of the real signal: the rest is flush padding.
                if self.input_done && self.out_frames >= self.expected_out_frames() {
                    return None;
                }
                if self.out_pos % self.channels == 0 {
                    self.out_frames += 1;
                }
                return Some(sample);
            }
            if !self.refill() {
                return None;
            }
        }
    }
}

impl<I> Source for Resampled<I>
where
    I: Source,
{
    fn current_span_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> ChannelCount {
        self.input.channels()
    }

    fn sample_rate(&self) -> SampleRate {
        self.rate_out
    }

    fn total_duration(&self) -> Option<Duration> {
        self.input.total_duration()
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.input.try_seek(pos)?;
        self.resampler.reset();
        self.out_pos = 0;
        self.out_len = 0;
        self.skip = self.resampler.output_delay() * self.channels;
        self.in_frames = 0;
        self.out_frames = 0;
        self.input_done = false;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::buffer::SamplesBuffer;
    use std::f32::consts::TAU;

    fn sine(rate: u32, freq: f32, frames: usize, channels: u16) -> SamplesBuffer {
        let samples: Vec<f32> = (0..frames)
            .flat_map(|i| {
                let s = 0.5 * (TAU * freq * i as f32 / rate as f32).sin();
                std::iter::repeat_n(s, channels as usize)
            })
            .collect();
        SamplesBuffer::new(
            ChannelCount::new(channels).unwrap(),
            SampleRate::new(rate).unwrap(),
            samples,
        )
    }

    /// The output should *be* the same tone, sample-accurately in time. A
    /// resampler delay that wasn't trimmed shows up here as a phase error.
    fn assert_matches_ideal(rate_in: u32, rate_out: u32) {
        let (freq, seconds) = (1000.0, 1.0);
        let frames_in = (rate_in as f32 * seconds) as usize;
        let out: Vec<f32> = Resampled::new(sine(rate_in, freq, frames_in, 1), rate_out)
            .ok()
            .unwrap()
            .collect();

        let expected_len = (frames_in as u64 * rate_out as u64).div_ceil(rate_in as u64) as usize;
        assert_eq!(out.len(), expected_len, "no missing samples and no trailing silence");

        // Edges are skipped: the tone starts and stops abruptly, which rings.
        let margin = rate_out as usize / 20;
        let rms_with_delay = |delay_frames: f32| {
            let sum: f32 = out[margin..out.len() - margin]
                .iter()
                .enumerate()
                .map(|(i, s)| {
                    let t = ((i + margin) as f32 - delay_frames) / rate_out as f32;
                    (s - 0.5 * (TAU * freq * t).sin()).powi(2)
                })
                .sum();
            (sum / (out.len() - 2 * margin) as f32).sqrt()
        };
        // Some ratios leave a constant sub-sample delay (the FFT sizes don't
        // divide evenly). That's a timing offset of microseconds, not an
        // error — but anything beyond one output sample would be.
        let (delay, err) = (-20..=20)
            .map(|step| step as f32 / 20.0)
            .map(|d| (d, rms_with_delay(d)))
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .unwrap();
        assert!(
            err < 1e-3,
            "rms error {err} (best delay {delay} frames) converting {rate_in} -> {rate_out}"
        );
    }

    #[test]
    fn upsamples_cd_audio_to_48k() {
        assert_matches_ideal(44_100, 48_000);
    }

    #[test]
    fn downsamples_48k_to_cd_rate() {
        assert_matches_ideal(48_000, 44_100);
    }

    #[test]
    fn downsamples_hi_res() {
        assert_matches_ideal(96_000, 44_100);
    }

    /// The thing a linear interpolator gets wrong: content above the new
    /// Nyquist frequency must be removed, not folded back into the audio.
    #[test]
    fn removes_content_above_the_new_nyquist() {
        // 30 kHz is fine at 96 kHz but impossible at 44.1 kHz; if it
        // aliased, it would reappear at 14.1 kHz at nearly full level.
        let out: Vec<f32> = Resampled::new(sine(96_000, 30_000.0, 96_000, 1), 44_100)
            .ok()
            .unwrap()
            .collect();
        let middle = &out[4410..out.len() - 4410];
        let rms = (middle.iter().map(|s| s * s).sum::<f32>() / middle.len() as f32).sqrt();
        assert!(rms < 1e-3, "aliased energy left behind: rms {rms}");
    }

    #[test]
    fn stereo_channels_stay_in_their_lanes() {
        // Left is a tone, right is silence.
        let frames = 44_100;
        let samples: Vec<f32> = (0..frames)
            .flat_map(|i| [0.5 * (TAU * 440.0 * i as f32 / 44_100.0).sin(), 0.0])
            .collect();
        let src = SamplesBuffer::new(
            ChannelCount::new(2).unwrap(),
            SampleRate::new(44_100).unwrap(),
            samples,
        );
        let out: Vec<f32> = Resampled::new(src, 48_000).ok().unwrap().collect();
        assert_eq!(out.len() % 2, 0);
        let right_peak = out.iter().skip(1).step_by(2).fold(0f32, |m, s| m.max(s.abs()));
        let left_peak = out.iter().step_by(2).fold(0f32, |m, s| m.max(s.abs()));
        assert!(left_peak > 0.4);
        assert!(right_peak < 1e-4, "right channel picked up {right_peak}");
    }

    #[test]
    fn matching_rates_are_passed_through_untouched() {
        let src = sine(44_100, 440.0, 100, 2);
        let expected: Vec<f32> = src.clone().collect();
        let out: Vec<f32> = Resampled::wrap(src, 44_100).collect();
        assert_eq!(out, expected);
    }

    #[test]
    fn reports_the_new_rate() {
        let r = Resampled::new(sine(44_100, 440.0, 10, 2), 96_000).ok().unwrap();
        assert_eq!(r.sample_rate().get(), 96_000);
        assert_eq!(r.channels().get(), 2);
    }
}
