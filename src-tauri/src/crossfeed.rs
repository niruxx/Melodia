use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rodio::source::SeekError;
use rodio::{ChannelCount, Sample, SampleRate, Source};

/// Interaural time difference: how much later the far ear hears a speaker than
/// the near one. ~300µs is the figure Bauer's original stereophonic-to-binaural
/// work uses, and what bs2b and most crossfeed implementations settled on.
const DELAY_US: f32 = 300.0;

/// Corner frequency of the lowpass the crossfed signal passes through. A head
/// shadows high frequencies far more than low ones, so only the bottom end
/// really reaches the far ear.
const LOWPASS_HZ: f32 = 700.0;

/// The most of the opposite channel that ever gets mixed in, at strength 100.
/// At 0.5 the direct and crossed paths are equal, which collapses everything
/// below the lowpass corner to mono — the strongest setting that still makes
/// musical sense.
const MAX_CROSS: f32 = 0.5;

/// 300µs at 192kHz is ~58 samples; 128 leaves headroom for anything higher.
const MAX_DELAY_SAMPLES: usize = 128;

/// Lock-free crossfeed strength, shared between the UI thread (which writes)
/// and the audio thread (which reads every frame). Same atomics-not-locks
/// reasoning as `EqGains` in `equalizer.rs` — the audio callback must never
/// block on a settings change.
pub struct CrossfeedSettings {
    /// 0 = bypass, 100 = `MAX_CROSS`.
    strength: AtomicU32,
}

impl CrossfeedSettings {
    pub fn off() -> Arc<Self> {
        Arc::new(Self {
            strength: AtomicU32::new(0),
        })
    }

    pub fn set_strength(&self, strength: u32) {
        self.strength.store(strength.min(100), Ordering::Relaxed);
    }

    fn raw(&self) -> u32 {
        self.strength.load(Ordering::Relaxed)
    }
}

/// Mixes a delayed, lowpassed copy of each channel into the other, which is
/// roughly what happens acoustically when you listen to speakers in a room:
/// each ear hears both of them. Headphones deliver the two channels in total
/// isolation, and that unnatural separation is what makes hard-panned mixes
/// tiring over long sessions.
///
/// Stereo only — anything else passes straight through.
pub struct Crossfeed<I> {
    input: I,
    settings: Arc<CrossfeedSettings>,
    stereo: bool,
    /// The right-channel output of the frame already computed, waiting to be
    /// returned on the next `next()` call.
    pending: Option<Sample>,
    /// Ring buffers holding recent samples, index 0 = left, 1 = right.
    delay: [[Sample; MAX_DELAY_SAMPLES]; 2],
    delay_pos: usize,
    delay_len: usize,
    /// One-pole lowpass state. Index 0 filters what crosses *into* the left
    /// channel (i.e. the right channel's signal), 1 the other way.
    lp: [Sample; 2],
    lp_coeff: f32,
    last_strength: u32,
    cross_gain: f32,
    direct_gain: f32,
}

/// Splits a strength into the direct and crossed path gains. They sum to 1, so
/// mono content (where both channels are identical) comes through at unity and
/// only the stereo difference signal is attenuated — which is the whole point.
fn gains_for(strength: u32) -> (f32, f32) {
    let cross = (strength.min(100) as f32 / 100.0) * MAX_CROSS;
    (1.0 - cross, cross)
}

impl<I> Crossfeed<I>
where
    I: Source<Item = Sample>,
{
    pub fn new(input: I, settings: Arc<CrossfeedSettings>) -> Self {
        let channels = input.channels().get();
        let sample_rate = input.sample_rate().get() as f32;

        let delay_len = ((DELAY_US * 1e-6 * sample_rate).round() as usize).min(MAX_DELAY_SAMPLES - 1);
        // Standard one-pole lowpass coefficient for a given corner frequency.
        let lp_coeff = 1.0 - (-2.0 * std::f32::consts::PI * LOWPASS_HZ / sample_rate).exp();

        let strength = settings.raw();
        let (direct_gain, cross_gain) = gains_for(strength);

        Self {
            input,
            settings,
            stereo: channels == 2,
            pending: None,
            delay: [[0.0; MAX_DELAY_SAMPLES]; 2],
            delay_pos: 0,
            delay_len,
            lp: [0.0; 2],
            lp_coeff,
            last_strength: strength,
            cross_gain,
            direct_gain,
        }
    }

    /// Writes this frame into the delay lines and returns what came out the
    /// far end, `delay_len` samples ago.
    #[inline]
    fn push_delay(&mut self, left: Sample, right: Sample) -> (Sample, Sample) {
        let read = (self.delay_pos + MAX_DELAY_SAMPLES - self.delay_len) % MAX_DELAY_SAMPLES;
        self.delay[0][self.delay_pos] = left;
        self.delay[1][self.delay_pos] = right;
        let delayed = (self.delay[0][read], self.delay[1][read]);
        self.delay_pos = (self.delay_pos + 1) % MAX_DELAY_SAMPLES;
        delayed
    }
}

impl<I> Iterator for Crossfeed<I>
where
    I: Source<Item = Sample>,
{
    type Item = Sample;

    #[inline]
    fn next(&mut self) -> Option<Sample> {
        if let Some(pending) = self.pending.take() {
            return Some(pending);
        }

        let left = self.input.next()?;
        if !self.stereo {
            return Some(left);
        }
        // Both channels are always pulled together, even at strength 0, so
        // toggling the effect mid-stream can never leave the pair alignment
        // off by one and silently swap L and R.
        let Some(right) = self.input.next() else {
            return Some(left);
        };

        let strength = self.settings.raw();
        if strength != self.last_strength {
            let (direct, cross) = gains_for(strength);
            self.direct_gain = direct;
            self.cross_gain = cross;
            self.last_strength = strength;
        }

        // Deliberately unconditional: at strength 0 this is direct=1, cross=0,
        // which is an exact passthrough. A bypass branch would buy a few flops
        // per frame at the cost of a stale delay line clicking on re-enable.
        let (delayed_left, delayed_right) = self.push_delay(left, right);
        self.lp[0] += self.lp_coeff * (delayed_right - self.lp[0]);
        self.lp[1] += self.lp_coeff * (delayed_left - self.lp[1]);

        let out_left = self.direct_gain * left + self.cross_gain * self.lp[0];
        let out_right = self.direct_gain * right + self.cross_gain * self.lp[1];

        self.pending = Some(out_right);
        Some(out_left)
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.input.size_hint()
    }
}

impl<I> Source for Crossfeed<I>
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

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.input.try_seek(pos)?;
        // The buffered sample and the delay/filter state all belong to the
        // old position. Carrying them across a jump crossfeeds a scrap of
        // wherever the track used to be into wherever it now is.
        self.pending = None;
        self.delay = [[0.0; MAX_DELAY_SAMPLES]; 2];
        self.delay_pos = 0;
        self.lp = [0.0; 2];
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::buffer::SamplesBuffer;

    fn run(samples: Vec<f32>, channels: u16, strength: u32) -> Vec<f32> {
        let settings = CrossfeedSettings::off();
        settings.set_strength(strength);
        let source = SamplesBuffer::new(
            ChannelCount::new(channels).unwrap(),
            SampleRate::new(44100).unwrap(),
            samples,
        );
        Crossfeed::new(source, settings).collect()
    }

    /// A hard-panned signal is the case crossfeed exists for: the silent ear
    /// should stop being completely silent.
    #[test]
    fn hard_panned_signal_reaches_the_other_ear() {
        // Left channel carries a tone, right is digital silence.
        let mut input = Vec::new();
        for i in 0..4096 {
            let t = i as f32 / 44100.0;
            input.push((2.0 * std::f32::consts::PI * 200.0 * t).sin());
            input.push(0.0);
        }
        let out = run(input, 2, 60);

        let right_energy: f32 = out.iter().skip(1).step_by(2).map(|s| s * s).sum();
        assert!(
            right_energy > 0.0,
            "the crossed path should put signal into the previously silent channel"
        );
    }

    /// Strength 0 has to be bit-identical passthrough, not merely close —
    /// the DSP runs unconditionally, so this is what makes "off" mean off.
    #[test]
    fn zero_strength_is_exact_passthrough() {
        let input: Vec<f32> = (0..512).map(|i| (i as f32 / 64.0).sin()).collect();
        let out = run(input.clone(), 2, 0);
        assert_eq!(out, input, "strength 0 must not alter a single sample");
    }

    /// Mono content is identical in both channels, so the direct and crossed
    /// paths carry the same signal and must not add up to a level change.
    #[test]
    fn mono_content_keeps_its_level() {
        let input: Vec<f32> = (0..8192)
            .flat_map(|i| {
                let t = i as f32 / 44100.0;
                let s = (2.0 * std::f32::consts::PI * 100.0 * t).sin();
                [s, s]
            })
            .collect();
        let out = run(input.clone(), 2, 100);

        // Skip the lowpass/delay settling period at the start.
        let rms = |v: &[f32]| (v.iter().map(|s| s * s).sum::<f32>() / v.len() as f32).sqrt();
        let before = rms(&input[2048..]);
        let after = rms(&out[2048..]);
        assert!(
            (after - before).abs() < 0.05,
            "mono should pass at unity: in={before} out={after}"
        );
    }

    /// Non-stereo audio has no "other channel" to fold in; it must come
    /// through untouched rather than being mangled by pair-wise processing.
    #[test]
    fn mono_stream_passes_through_untouched() {
        let input: Vec<f32> = (0..256).map(|i| (i as f32 / 32.0).sin()).collect();
        let out = run(input.clone(), 1, 100);
        assert_eq!(out, input);
    }

    #[test]
    fn output_length_matches_input() {
        let input: Vec<f32> = vec![0.25; 1024];
        assert_eq!(run(input.clone(), 2, 50).len(), input.len());
    }

    #[test]
    fn stays_finite_at_full_scale() {
        let input: Vec<f32> = (0..2048).map(|i| if i % 2 == 0 { 1.0 } else { -1.0 }).collect();
        let out = run(input, 2, 100);
        assert!(out.iter().all(|s| s.is_finite()), "no NaN/inf in output");
        assert!(
            out.iter().all(|s| s.abs() <= 1.001),
            "gains sum to 1, so a full-scale input must not clip"
        );
    }
}
