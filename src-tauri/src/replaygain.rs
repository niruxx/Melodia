use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;

use lofty::file::TaggedFileExt;
use lofty::prelude::ItemKey;
use lofty::probe::Probe;
use rodio::source::SeekError;
use rodio::{ChannelCount, Sample, SampleRate, Source};

/// Nothing sane needs more than this, and it bounds how badly a corrupt tag
/// can misbehave.
const MAX_ABS_GAIN_DB: f32 = 30.0;

/// How long a gain change takes to ramp in, in seconds. Instant jumps click.
const RAMP_SECONDS: f32 = 0.02;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReplayGainMode {
    Off,
    Track,
    Album,
}

impl ReplayGainMode {
    fn from_u8(raw: u8) -> Self {
        match raw {
            1 => Self::Track,
            2 => Self::Album,
            _ => Self::Off,
        }
    }

    fn as_u8(self) -> u8 {
        match self {
            Self::Off => 0,
            Self::Track => 1,
            Self::Album => 2,
        }
    }
}

/// The gain and peak values a file declares. All optional: most files have
/// none of it, plenty have track values but no album ones.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct GainTags {
    pub track_gain_db: Option<f32>,
    pub track_peak: Option<f32>,
    pub album_gain_db: Option<f32>,
    pub album_peak: Option<f32>,
}

/// User-facing ReplayGain configuration, shared with the audio thread.
pub struct ReplayGainSettings {
    mode: AtomicU8,
    preamp_db_x100: AtomicI32,
    prevent_clipping: AtomicBool,
}

impl ReplayGainSettings {
    pub fn default_off() -> Arc<Self> {
        Arc::new(Self {
            mode: AtomicU8::new(ReplayGainMode::Off.as_u8()),
            preamp_db_x100: AtomicI32::new(0),
            prevent_clipping: AtomicBool::new(true),
        })
    }

    pub fn set(&self, mode: ReplayGainMode, preamp_db: f32, prevent_clipping: bool) {
        self.mode.store(mode.as_u8(), Ordering::Relaxed);
        self.preamp_db_x100.store(
            (preamp_db.clamp(-MAX_ABS_GAIN_DB, MAX_ABS_GAIN_DB) * 100.0) as i32,
            Ordering::Relaxed,
        );
        self.prevent_clipping
            .store(prevent_clipping, Ordering::Relaxed);
    }

    pub fn mode(&self) -> ReplayGainMode {
        ReplayGainMode::from_u8(self.mode.load(Ordering::Relaxed))
    }

    pub fn preamp_db(&self) -> f32 {
        self.preamp_db_x100.load(Ordering::Relaxed) as f32 / 100.0
    }

    pub fn prevent_clipping(&self) -> bool {
        self.prevent_clipping.load(Ordering::Relaxed)
    }
}

/// The gain currently being applied, in dB×100 (`f32` isn't atomic). Written
/// when a track starts or settings change; read by the `Gain` source on the
/// audio thread.
pub struct AppliedGain {
    db_x100: AtomicI32,
}

impl AppliedGain {
    pub fn unity() -> Arc<Self> {
        Arc::new(Self {
            db_x100: AtomicI32::new(0),
        })
    }

    pub fn set_db(&self, db: f32) {
        self.db_x100.store(
            (db.clamp(-MAX_ABS_GAIN_DB, MAX_ABS_GAIN_DB) * 100.0) as i32,
            Ordering::Relaxed,
        );
    }

    fn raw(&self) -> i32 {
        self.db_x100.load(Ordering::Relaxed)
    }
}

/// Parses a ReplayGain gain string: `"-7.55 dB"`, `"-7.55"`, `"+2 dB"`.
pub fn parse_gain_db(raw: &str) -> Option<f32> {
    let trimmed = raw.trim();
    let numeric = trimmed
        .strip_suffix("dB")
        .or_else(|| trimmed.strip_suffix("db"))
        .or_else(|| trimmed.strip_suffix("DB"))
        .unwrap_or(trimmed)
        .trim();
    let value: f32 = numeric.parse().ok()?;
    value.is_finite().then_some(value)
}

/// Parses a peak string. ReplayGain peaks are sample values where 1.0 is full
/// scale, though a clipped master can legitimately report above that.
pub fn parse_peak(raw: &str) -> Option<f32> {
    let value: f32 = raw.trim().parse().ok()?;
    (value.is_finite() && value > 0.0).then_some(value)
}

/// Reads whatever gain metadata a file carries. Returns defaults (all `None`)
/// for an untagged or unreadable file — absent ReplayGain data is the normal
/// case, not an error worth surfacing.
///
/// Reads the ReplayGain 2.0 tags only, which covers FLAC, MP3, M4A and Ogg
/// Vorbis. Opus stores loudness as an `R128_TRACK_GAIN` Vorbis comment
/// instead, and lofty exposes no way to read an unmapped key — those files
/// come back untagged and simply play unnormalized.
pub fn read_tags(path: &Path) -> GainTags {
    let Ok(probe) = Probe::open(path) else {
        return GainTags::default();
    };
    let Ok(tagged) = probe.read() else {
        return GainTags::default();
    };
    let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) else {
        return GainTags::default();
    };

    GainTags {
        track_gain_db: tag
            .get_string(ItemKey::ReplayGainTrackGain)
            .and_then(parse_gain_db),
        album_gain_db: tag
            .get_string(ItemKey::ReplayGainAlbumGain)
            .and_then(parse_gain_db),
        track_peak: tag
            .get_string(ItemKey::ReplayGainTrackPeak)
            .and_then(parse_peak),
        album_peak: tag
            .get_string(ItemKey::ReplayGainAlbumPeak)
            .and_then(parse_peak),
    }
}

/// Works out the dB adjustment to apply for a track.
///
/// Returns 0 (leave the audio alone) whenever normalization is off or the file
/// carries nothing to normalize by — silently guessing a gain for untagged
/// files would make them louder or quieter than the tagged ones around them,
/// which is the exact problem ReplayGain exists to solve.
pub fn resolve_gain_db(
    mode: ReplayGainMode,
    tags: GainTags,
    preamp_db: f32,
    prevent_clipping: bool,
) -> f32 {
    let (gain, peak) = match mode {
        ReplayGainMode::Off => return 0.0,
        ReplayGainMode::Track => (tags.track_gain_db, tags.track_peak),
        // Album mode falls back to track values so a partially tagged library
        // still gets normalized rather than jumping between modes' volumes.
        ReplayGainMode::Album => (
            tags.album_gain_db.or(tags.track_gain_db),
            tags.album_peak.or(tags.track_peak),
        ),
    };

    let Some(gain) = gain else {
        return 0.0;
    };

    let mut total = gain + preamp_db;

    // A positive gain applied to a track that already peaks near full scale
    // would clip. The headroom available is whatever the peak leaves below 0dBFS.
    if prevent_clipping {
        if let Some(peak) = peak.filter(|p| *p > 0.0) {
            let headroom_db = -20.0 * peak.log10();
            total = total.min(headroom_db);
        }
    }

    total.clamp(-MAX_ABS_GAIN_DB, MAX_ABS_GAIN_DB)
}

/// Applies `AppliedGain` to the stream, ramping rather than stepping so a
/// settings change mid-track doesn't click.
pub struct Gain<I> {
    input: I,
    gain: Arc<AppliedGain>,
    last_raw: i32,
    current: f32,
    target: f32,
    step: f32,
}

impl<I> Gain<I>
where
    I: Source<Item = Sample>,
{
    pub fn new(input: I, gain: Arc<AppliedGain>) -> Self {
        let sample_rate = input.sample_rate().get() as f32;
        let raw = gain.raw();
        let factor = db_to_linear(raw as f32 / 100.0);
        Self {
            input,
            gain,
            last_raw: raw,
            // Starts already at target: the gain for a track is set before its
            // source is built, so there is nothing to ramp from at track start.
            current: factor,
            target: factor,
            step: 1.0 / (RAMP_SECONDS * sample_rate).max(1.0),
        }
    }
}

fn db_to_linear(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}

impl<I> Iterator for Gain<I>
where
    I: Source<Item = Sample>,
{
    type Item = Sample;

    #[inline]
    fn next(&mut self) -> Option<Sample> {
        let sample = self.input.next()?;

        let raw = self.gain.raw();
        if raw != self.last_raw {
            self.last_raw = raw;
            self.target = db_to_linear(raw as f32 / 100.0);
        }
        if self.current != self.target {
            let delta = self.target - self.current;
            self.current += delta.clamp(-self.step, self.step);
        }

        Some(sample * self.current)
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.input.size_hint()
    }
}

impl<I> Source for Gain<I>
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

    #[test]
    fn parses_gain_strings() {
        assert_eq!(parse_gain_db("-7.55 dB"), Some(-7.55));
        assert_eq!(parse_gain_db("-7.55"), Some(-7.55));
        assert_eq!(parse_gain_db("+2 dB"), Some(2.0));
        assert_eq!(parse_gain_db("  0.00 dB  "), Some(0.0));
        assert_eq!(parse_gain_db("not a number"), None);
        assert_eq!(parse_gain_db(""), None);
    }

    #[test]
    fn parses_peaks_and_rejects_nonsense() {
        assert_eq!(parse_peak("0.987"), Some(0.987));
        assert_eq!(parse_peak("1.0"), Some(1.0));
        assert_eq!(parse_peak("0"), None, "a zero peak would imply silence");
        assert_eq!(parse_peak("-1"), None);
        assert_eq!(parse_peak("abc"), None);
    }

    #[test]
    fn off_mode_never_touches_the_signal() {
        let tags = GainTags {
            track_gain_db: Some(-9.0),
            ..Default::default()
        };
        assert_eq!(resolve_gain_db(ReplayGainMode::Off, tags, 6.0, true), 0.0);
    }

    #[test]
    fn untagged_files_are_left_alone() {
        let gain = resolve_gain_db(ReplayGainMode::Track, GainTags::default(), 3.0, true);
        assert_eq!(gain, 0.0, "a preamp must not apply where there is no RG data");
    }

    #[test]
    fn track_mode_applies_gain_plus_preamp() {
        let tags = GainTags {
            track_gain_db: Some(-6.0),
            ..Default::default()
        };
        assert_eq!(resolve_gain_db(ReplayGainMode::Track, tags, 2.0, false), -4.0);
    }

    #[test]
    fn album_mode_falls_back_to_track_values() {
        let tags = GainTags {
            track_gain_db: Some(-6.0),
            album_gain_db: None,
            ..Default::default()
        };
        assert_eq!(resolve_gain_db(ReplayGainMode::Album, tags, 0.0, false), -6.0);

        let with_album = GainTags {
            track_gain_db: Some(-6.0),
            album_gain_db: Some(-8.0),
            ..Default::default()
        };
        assert_eq!(
            resolve_gain_db(ReplayGainMode::Album, with_album, 0.0, false),
            -8.0
        );
    }

    /// The headroom cap is the whole point of peak tags: a boost that would
    /// push a near-full-scale master past 0dBFS has to be held back.
    #[test]
    fn clipping_prevention_caps_a_boost() {
        let tags = GainTags {
            track_gain_db: Some(6.0),
            track_peak: Some(1.0),
            ..Default::default()
        };
        let capped = resolve_gain_db(ReplayGainMode::Track, tags, 0.0, true);
        assert_eq!(capped, 0.0, "a peak of 1.0 leaves no headroom at all");

        let uncapped = resolve_gain_db(ReplayGainMode::Track, tags, 0.0, false);
        assert_eq!(uncapped, 6.0, "without the guard the full boost applies");
    }

    #[test]
    fn clipping_prevention_allows_boost_within_headroom() {
        // A peak of 0.5 is 6dB below full scale, so +3dB is safe.
        let tags = GainTags {
            track_gain_db: Some(3.0),
            track_peak: Some(0.5),
            ..Default::default()
        };
        assert_eq!(resolve_gain_db(ReplayGainMode::Track, tags, 0.0, true), 3.0);
    }

    /// Cuts are always safe, so the clipping guard must never turn one into a
    /// boost by "raising it to the available headroom".
    #[test]
    fn clipping_prevention_never_raises_a_cut() {
        let tags = GainTags {
            track_gain_db: Some(-12.0),
            track_peak: Some(0.1),
            ..Default::default()
        };
        assert_eq!(resolve_gain_db(ReplayGainMode::Track, tags, 0.0, true), -12.0);
    }

    #[test]
    fn extreme_tags_are_clamped() {
        let tags = GainTags {
            track_gain_db: Some(-999.0),
            ..Default::default()
        };
        assert_eq!(
            resolve_gain_db(ReplayGainMode::Track, tags, 0.0, false),
            -MAX_ABS_GAIN_DB
        );
    }

    #[test]
    fn unity_gain_source_is_transparent() {
        use rodio::buffer::SamplesBuffer;

        let input: Vec<f32> = (0..512).map(|i| (i as f32 / 64.0).sin()).collect();
        let source = SamplesBuffer::new(
            ChannelCount::new(2).unwrap(),
            SampleRate::new(44100).unwrap(),
            input.clone(),
        );
        let out: Vec<f32> = Gain::new(source, AppliedGain::unity()).collect();
        assert_eq!(out, input);
    }

    #[test]
    fn negative_gain_reduces_amplitude() {
        use rodio::buffer::SamplesBuffer;

        let gain = AppliedGain::unity();
        gain.set_db(-6.0);
        let input: Vec<f32> = vec![1.0; 4096];
        let source = SamplesBuffer::new(
            ChannelCount::new(2).unwrap(),
            SampleRate::new(44100).unwrap(),
            input,
        );
        let out: Vec<f32> = Gain::new(source, gain).collect();
        // -6dB is very close to half amplitude.
        assert!((out[out.len() - 1] - 0.501).abs() < 0.01, "got {}", out[out.len() - 1]);
    }
}
