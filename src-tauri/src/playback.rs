use std::collections::HashMap;
use std::io::Cursor;
use std::str::FromStr;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};

use rodio::cpal::traits::{DeviceTrait, HostTrait};
use rodio::{stream::DeviceSinkBuilder, Decoder, MixerDeviceSink, Player, Source};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::analyzer::{spawn_emitter, Analyzer, SpectrumTap};
use crate::crossfeed::{Crossfeed, CrossfeedSettings};
use crate::equalizer::{EqGains, Equalizer, BAND_COUNT};
use crate::exclusive::ExclusiveEvent;
use crate::gapless::{Cancellable, NextHandle};
use crate::replaygain::{
    self, AppliedGain, Gain, GainTags, ReplayGainMode, ReplayGainSettings,
};
use crate::resample::Resampled;

/// Where to read a track's audio bytes from.
pub enum PlaySource {
    Remote(String, HashMap<String, String>),
    Local(String),
}

enum Command {
    Play(PlaySource),
    /// Fetch the track expected to play next and queue it behind the current
    /// one, so the two join with no gap. `id` is echoed back when it starts.
    Preload {
        source: PlaySource,
        id: String,
    },
    /// The preloaded track is no longer what should play next.
    CancelPreload,
    Pause,
    Resume,
    Seek(f64),
    SetVolume(f32),
    SetFadeMs(u32),
    SetEq([f32; BAND_COUNT]),
    SetCrossfeed(u32),
    SetReplayGain {
        mode: ReplayGainMode,
        preamp_db: f32,
        prevent_clipping: bool,
    },
    /// `None` follows the system default output.
    SetOutputDevice(Option<String>),
    SetBitPerfect(bool),
    SetHighQualityResampling(bool),
    Stop,
}

/// An output device as offered to the user.
#[derive(serde::Serialize)]
pub struct OutputDevice {
    /// Stable across restarts and reconnections — this is what gets persisted,
    /// rather than the display name, which isn't guaranteed unique or fixed.
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

/// Enumerates the system's audio outputs.
///
/// Failures are reported as an empty list rather than an error: a missing or
/// busy audio host shouldn't stop the settings screen from opening, and
/// "follow the system default" stays selectable regardless.
pub fn list_output_devices() -> Vec<OutputDevice> {
    let host = rodio::cpal::default_host();
    let default_id = host.default_output_device().and_then(|d| d.id().ok());

    let Ok(devices) = host.output_devices() else {
        return Vec::new();
    };
    devices
        .filter_map(|device| {
            let id = device.id().ok()?;
            let name = device.description().ok()?.name().to_string();
            Some(OutputDevice {
                is_default: Some(&id) == default_id.as_ref(),
                id: id.to_string(),
                name,
            })
        })
        .collect()
}

/// Whether this build can open a device in exclusive mode at all.
pub fn bit_perfect_supported() -> bool {
    cfg!(windows)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Enumeration has to hold its invariants on a machine with no sound card
    /// too, so an empty list is a pass — this guards the shape of what's
    /// returned, not the presence of hardware.
    #[test]
    fn output_devices_are_well_formed() {
        let devices = list_output_devices();

        for device in &devices {
            assert!(!device.id.is_empty(), "device id must be usable as a key");
            assert!(!device.name.is_empty(), "device needs a display name");
            assert!(
                rodio::cpal::DeviceId::from_str(&device.id).is_ok(),
                "id must round-trip back for device_by_id: {}",
                device.id
            );
        }

        let ids: Vec<_> = devices.iter().map(|d| &d.id).collect();
        let mut unique = ids.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(ids.len(), unique.len(), "device ids must be unique");

        assert!(
            devices.iter().filter(|d| d.is_default).count() <= 1,
            "at most one device can be the system default"
        );
    }
}

/// Opens a sink on a specific device id, or the system default when `None`.
fn open_sink(id: Option<&str>) -> Result<MixerDeviceSink, String> {
    let Some(want) = id else {
        return DeviceSinkBuilder::open_default_sink().map_err(|e| describe_error(&e));
    };

    let device_id = rodio::cpal::DeviceId::from_str(want)
        .map_err(|_| format!("unrecognised audio output id \"{want}\""))?;
    let device = rodio::cpal::default_host()
        .device_by_id(&device_id)
        // Expected whenever a saved device has since been unplugged.
        .ok_or_else(|| "that audio output isn't connected any more".to_string())?;

    DeviceSinkBuilder::from_device(device)
        .map_err(|e| describe_error(&e))?
        .open_stream()
        .map_err(|e| describe_error(&e))
}

/// Messages the audio thread's loop selects over: either a real command from
/// `Playback`, or a background fetch reporting back. Fetches never run inline
/// in the command loop — a slow/stalled network read must not block Stop,
/// Pause, or a newer Play from being processed.
enum Msg {
    Cmd(Command),
    /// Carries whatever ReplayGain metadata the source turned out to have —
    /// read on the fetch thread alongside the audio bytes, since tag reading
    /// is filesystem work that has no business on the audio thread.
    Fetched(u64, Result<Vec<u8>, String>, GainTags),
    Preloaded {
        generation: u64,
        preload_generation: u64,
        id: String,
        result: Result<Vec<u8>, String>,
        tags: GainTags,
    },
    /// From an exclusive-mode render thread, tagged with the output it came
    /// from so a report from an output since replaced is ignored.
    Exclusive(u64, ExclusiveEvent),
}

/// A handle to the dedicated audio thread. Cheap, `Send + Sync`, safe to
/// store as Tauri-managed state — the actual `rodio`/`cpal` resources never
/// leave the thread that owns them.
pub struct Playback {
    tx: Sender<Msg>,
}

impl Playback {
    pub fn spawn(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<Msg>();
        let fetch_tx = tx.clone();
        let dsp = Dsp {
            eq_gains: EqGains::flat(),
            crossfeed: CrossfeedSettings::off(),
            replay_gain: ReplayGainSettings::default_off(),
        };
        let tap = SpectrumTap::new();
        spawn_emitter(app.clone(), tap.clone());
        std::thread::spawn(move || audio_thread(app, rx, fetch_tx, dsp, tap));
        Self { tx }
    }

    fn send(&self, cmd: Command) -> Result<(), String> {
        self.tx
            .send(Msg::Cmd(cmd))
            .map_err(|_| "audio engine is not running".to_string())
    }

    pub fn play_source(&self, source: PlaySource) -> Result<(), String> {
        self.send(Command::Play(source))
    }

    pub fn preload(&self, source: PlaySource, id: String) -> Result<(), String> {
        self.send(Command::Preload { source, id })
    }

    pub fn cancel_preload(&self) -> Result<(), String> {
        self.send(Command::CancelPreload)
    }

    pub fn pause(&self) -> Result<(), String> {
        self.send(Command::Pause)
    }

    pub fn resume(&self) -> Result<(), String> {
        self.send(Command::Resume)
    }

    pub fn seek(&self, seconds: f64) -> Result<(), String> {
        self.send(Command::Seek(seconds))
    }

    pub fn set_volume(&self, volume: f32) -> Result<(), String> {
        self.send(Command::SetVolume(volume))
    }

    pub fn set_fade_ms(&self, ms: u32) -> Result<(), String> {
        self.send(Command::SetFadeMs(ms))
    }

    pub fn set_eq(&self, bands: [f32; BAND_COUNT]) -> Result<(), String> {
        self.send(Command::SetEq(bands))
    }

    pub fn set_crossfeed(&self, strength: u32) -> Result<(), String> {
        self.send(Command::SetCrossfeed(strength))
    }

    pub fn set_replay_gain(
        &self,
        mode: ReplayGainMode,
        preamp_db: f32,
        prevent_clipping: bool,
    ) -> Result<(), String> {
        self.send(Command::SetReplayGain {
            mode,
            preamp_db,
            prevent_clipping,
        })
    }

    pub fn set_output_device(&self, name: Option<String>) -> Result<(), String> {
        self.send(Command::SetOutputDevice(name))
    }

    pub fn set_bit_perfect(&self, enabled: bool) -> Result<(), String> {
        if enabled && !bit_perfect_supported() {
            return Err("bit-perfect output is only available on Windows for now".into());
        }
        self.send(Command::SetBitPerfect(enabled))
    }

    pub fn set_high_quality_resampling(&self, enabled: bool) -> Result<(), String> {
        self.send(Command::SetHighQualityResampling(enabled))
    }

    pub fn stop(&self) -> Result<(), String> {
        self.send(Command::Stop)
    }
}

fn describe_error(e: &dyn std::error::Error) -> String {
    let mut msg = e.to_string();
    let mut source = e.source();
    while let Some(s) = source {
        msg.push_str(" <- ");
        msg.push_str(&s.to_string());
        source = s.source();
    }
    msg
}

fn fetch_bytes(url: &str, headers: &HashMap<String, String>) -> Result<Vec<u8>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| describe_error(&e))?;

    let mut request = client.get(url);
    for (key, value) in headers {
        request = request.header(key.as_str(), value.as_str());
    }

    // YouTube deliberately throttles plain full-file GETs on its media CDN.
    // Measured on a 3.3 MiB track: a plain GET trickles at ~32 KiB/s (never
    // finishing inside any sane timeout), while the identical request with an
    // explicit byte range completes in well under a second. Asking for the
    // whole file *as a range* is what makes playback viable at all.
    let has_range = headers.keys().any(|k| k.eq_ignore_ascii_case("range"));
    if !has_range {
        request = request.header("Range", "bytes=0-");
    }

    let response = request.send().map_err(|e| describe_error(&e))?;

    // Surface an HTTP failure directly. Without this an error page body would
    // be handed to the decoder and reported as an unrecognised audio format,
    // hiding the real cause (commonly an expired stream URL).
    let status = response.status();
    if !status.is_success() {
        return Err(format!("stream request failed: HTTP {status}"));
    }

    response
        .bytes()
        .map(|b| b.to_vec())
        .map_err(|e| describe_error(&e))
}

/// What to do once an in-progress volume ramp reaches its target.
enum AfterFade {
    None,
    Pause,
    Stop,
}

struct FadeState {
    from: f32,
    to: f32,
    start: Instant,
    duration: Duration,
    then: AfterFade,
}

impl FadeState {
    fn value_at(&self, now: Instant) -> f32 {
        let elapsed = now.saturating_duration_since(self.start).as_secs_f32();
        let t = (elapsed / self.duration.as_secs_f32()).clamp(0.0, 1.0);
        self.from + (self.to - self.from) * t
    }

    fn is_done(&self, now: Instant) -> bool {
        now.saturating_duration_since(self.start) >= self.duration
    }
}

/// The shared, lock-free DSP state the audio thread reads and the UI writes.
struct Dsp {
    eq_gains: Arc<EqGains>,
    crossfeed: Arc<CrossfeedSettings>,
    replay_gain: Arc<ReplayGainSettings>,
}

impl Dsp {
    fn gain_for(&self, tags: GainTags) -> f32 {
        replaygain::resolve_gain_db(
            self.replay_gain.mode(),
            tags,
            self.replay_gain.preamp_db(),
            self.replay_gain.prevent_clipping(),
        )
    }
}

/// Reads a track's bytes and ReplayGain tags. Runs on a throwaway thread.
fn fetch_source(source: PlaySource) -> (Result<Vec<u8>, String>, GainTags) {
    match source {
        // Streams carry no ReplayGain metadata — YouTube and SoundCloud both
        // apply their own normalization server-side and strip the tags.
        PlaySource::Remote(url, headers) => (fetch_bytes(&url, &headers), GainTags::default()),
        PlaySource::Local(path) => {
            let tags = replaygain::read_tags(std::path::Path::new(&path));
            (
                std::fs::read(&path).map_err(|e| format!("{e} ({path})")),
                tags,
            )
        }
    }
}

type BoxedSource = Box<dyn Source + Send>;

/// Where the audio goes.
enum Output {
    /// Through the OS mixer, via cpal.
    Shared(MixerDeviceSink),
    /// Straight to the device, bypassing the mixer.
    #[cfg(windows)]
    Exclusive(crate::exclusive::ExclusiveOutput),
}

impl Output {
    fn open(device_id: Option<&str>, bit_perfect: bool, tx: &Sender<Msg>, token: u64) -> Result<Self, String> {
        #[cfg(windows)]
        if bit_perfect {
            // cpal ids are "<host>:<endpoint id>"; WASAPI wants the endpoint id.
            let endpoint = device_id.map(|id| id.split_once(':').map_or(id, |(_, e)| e).to_string());
            let tx = tx.clone();
            return crate::exclusive::ExclusiveOutput::open(endpoint, move |event| {
                let _ = tx.send(Msg::Exclusive(token, event));
            })
            .map(Output::Exclusive);
        }
        #[cfg(not(windows))]
        let _ = (bit_perfect, tx, token);
        open_sink(device_id).map(Output::Shared)
    }

    fn is_exclusive(&self) -> bool {
        match self {
            Output::Shared(_) => false,
            #[cfg(windows)]
            Output::Exclusive(_) => true,
        }
    }

    /// The rate a track should be converted to before it's played, if any.
    fn target_rate(&self, source_rate: u32, channels: u16, high_quality: bool) -> Option<u32> {
        match self {
            // Converting here, to the mixer's own rate, means rodio's mixer
            // then has nothing left to do — its linear interpolation never runs.
            Output::Shared(sink) => high_quality.then(|| sink.config().sample_rate().get()),
            #[cfg(windows)]
            Output::Exclusive(out) => {
                if channels == 2 {
                    crate::exclusive::pick_rate(source_rate, out.stereo_rates())
                } else {
                    // Only stereo is probed; anything else is tried as-is.
                    None
                }
            }
        }
    }

    fn start_player(&self, chain: BoxedSource) -> Player {
        match self {
            Output::Shared(sink) => {
                let p = Player::connect_new(sink.mixer());
                p.append(chain);
                p
            }
            #[cfg(windows)]
            Output::Exclusive(out) => {
                let (p, queue) = Player::new();
                // Appended before handing over, so the first format the
                // render thread sees is the track's rather than the empty
                // queue's placeholder.
                p.append(chain);
                out.attach(Box::new(queue));
                p
            }
        }
    }

    /// Bit-perfect means nothing scales the samples — the device's own
    /// volume control is the only one.
    fn volume(&self, user: f32) -> f32 {
        if self.is_exclusive() { 1.0 } else { user }
    }

    fn fade_ms(&self, user: u32) -> u32 {
        if self.is_exclusive() { 0 } else { user }
    }
}

/// A track's rate before and after any conversion.
#[derive(Clone, Copy)]
struct TrackFormat {
    source_rate: u32,
    output_rate: u32,
}

/// Decodes a track and wraps it in the processing chain.
///
/// Order matters: resampling first, so everything after runs at the output
/// rate; then ReplayGain normalizes the level, the EQ shapes it, and
/// crossfeed does its stereo-image work last — it wants the signal that's
/// actually going to the headphones. The analyser sits outermost so the
/// visualiser shows what's being heard.
///
/// In bit-perfect mode every stage that alters samples is left out.
///
/// Each track gets its own `AppliedGain`: with a gapless successor queued,
/// two tracks with different ReplayGain values are alive at once.
fn build_chain(
    bytes: Vec<u8>,
    gain: Arc<AppliedGain>,
    dsp: &Dsp,
    tap: &Arc<SpectrumTap>,
    output: &Output,
    high_quality: bool,
) -> Result<(BoxedSource, TrackFormat), String> {
    let decoder = Decoder::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let source_rate = decoder.sample_rate().get();
    let target = output.target_rate(source_rate, decoder.channels().get(), high_quality);
    let source: BoxedSource = match target {
        Some(rate) => Resampled::wrap(decoder, rate),
        None => Box::new(decoder),
    };
    let format = TrackFormat {
        source_rate,
        output_rate: source.sample_rate().get(),
    };

    let chain: BoxedSource = if output.is_exclusive() {
        Box::new(Analyzer::new(source, tap.clone()))
    } else {
        Box::new(Analyzer::new(
            Crossfeed::new(
                Equalizer::new(Gain::new(source, gain), dsp.eq_gains.clone()),
                dsp.crossfeed.clone(),
            ),
            tap.clone(),
        ))
    };
    Ok((chain, format))
}

/// A track queued behind the current one, not yet audible.
struct Upcoming {
    id: String,
    handle: Arc<NextHandle>,
    gain: Arc<AppliedGain>,
    tags: GainTags,
    format: TrackFormat,
}

/// Everything tied to what's currently playing.
struct Session {
    player: Option<Player>,
    upcoming: Option<Upcoming>,
    fade: Option<FadeState>,
    // Bumped on every Play/Stop so a fetch that finishes after being
    // superseded (by a newer Play or a Stop) gets discarded instead of
    // clobbering whatever should actually be playing.
    generation: u64,
    // Bumped whenever a preload is requested or withdrawn, so only the most
    // recent request's fetch is ever queued.
    preload_generation: u64,
    // Kept so a ReplayGain settings change can be re-resolved against the
    // track that's already playing, rather than only taking effect on the next one.
    current_tags: GainTags,
    current_gain: Arc<AppliedGain>,
    current_format: Option<TrackFormat>,
}

impl Session {
    /// Drops everything wired to the current output ahead of replacing it,
    /// and reports where playback was so the UI can resume it on the new one
    /// rather than appearing to stop for no reason.
    fn detach(&mut self, app: &AppHandle) {
        let was_playing = self.player.as_ref().is_some_and(|p| !p.is_paused());
        let position = self.player.as_ref().map(|p| p.get_pos().as_secs_f64());
        self.player = None;
        self.fade = None;
        self.upcoming = None;
        self.current_format = None;
        self.generation += 1;
        self.preload_generation += 1;
        let _ = app.emit(
            "playback:output-changed",
            json!({ "wasPlaying": was_playing, "position": position }),
        );
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputStatus<'a> {
    bit_perfect: bool,
    /// What the device was opened with, in exclusive mode.
    device_format: Option<&'a str>,
    source_rate: Option<u32>,
    output_rate: Option<u32>,
    error: Option<String>,
}

fn emit_status(
    app: &AppHandle,
    output: &Output,
    device_format: &Option<String>,
    track: Option<TrackFormat>,
    error: Option<String>,
) {
    let _ = app.emit(
        "playback:output-status",
        OutputStatus {
            bit_perfect: output.is_exclusive(),
            device_format: device_format.as_deref(),
            source_rate: track.map(|t| t.source_rate),
            output_rate: track.map(|t| t.output_rate),
            error,
        },
    );
}

fn audio_thread(
    app: AppHandle,
    rx: std::sync::mpsc::Receiver<Msg>,
    fetch_tx: Sender<Msg>,
    dsp: Dsp,
    tap: Arc<SpectrumTap>,
) {
    let mut device_id: Option<String> = None;
    // Tags exclusive-mode reports with the output that sent them.
    let mut output_token: u64 = 0;
    let mut output = match Output::open(None, false, &fetch_tx, output_token) {
        Ok(o) => o,
        Err(e) => {
            let _ = app.emit("playback:error", format!("no audio output device: {e}"));
            return;
        }
    };
    let mut device_format: Option<String> = None;
    let mut high_quality = true;

    // The user's chosen level and fade, distinct from whatever a fade ramp is
    // driving the player to right now, and from what bit-perfect mode pins.
    let mut user_volume: f32 = 1.0;
    let mut user_fade_ms: u32 = 0;

    let mut s = Session {
        player: None,
        upcoming: None,
        fade: None,
        generation: 0,
        preload_generation: 0,
        current_tags: GainTags::default(),
        current_gain: AppliedGain::unity(),
        current_format: None,
    };

    loop {
        // Poll finely while a fade is in flight for a smooth ~50Hz ramp;
        // otherwise the coarser interval is plenty for position/ended events.
        let poll_interval = if s.fade.is_some() {
            Duration::from_millis(20)
        } else {
            Duration::from_millis(250)
        };
        let fade_ms = output.fade_ms(user_fade_ms);
        let target_volume = output.volume(user_volume);

        match rx.recv_timeout(poll_interval) {
            Ok(Msg::Cmd(Command::Play(source))) => {
                if let Some(p) = s.player.take() {
                    p.stop();
                }
                s.fade = None;
                s.upcoming = None;
                s.preload_generation += 1;
                s.generation += 1;
                let gen = s.generation;
                let tx = fetch_tx.clone();
                std::thread::spawn(move || {
                    let (result, tags) = fetch_source(source);
                    let _ = tx.send(Msg::Fetched(gen, result, tags));
                });
            }
            Ok(Msg::Cmd(Command::Preload { source, id })) => {
                if let Some(u) = s.upcoming.take() {
                    u.handle.cancel();
                }
                s.preload_generation += 1;
                let (gen, pgen) = (s.generation, s.preload_generation);
                let tx = fetch_tx.clone();
                std::thread::spawn(move || {
                    let (result, tags) = fetch_source(source);
                    let _ = tx.send(Msg::Preloaded {
                        generation: gen,
                        preload_generation: pgen,
                        id,
                        result,
                        tags,
                    });
                });
            }
            Ok(Msg::Cmd(Command::CancelPreload)) => {
                s.preload_generation += 1;
                if let Some(u) = s.upcoming.take() {
                    if !u.handle.cancel() {
                        // Too late: it's already the track being heard. Put it
                        // back so the poll below reports the advance.
                        s.upcoming = Some(u);
                    }
                }
            }
            Ok(Msg::Cmd(Command::Pause)) => {
                if let Some(p) = &s.player {
                    if fade_ms == 0 {
                        p.pause();
                    } else {
                        s.fade = Some(FadeState {
                            from: p.volume(),
                            to: 0.0,
                            start: Instant::now(),
                            duration: Duration::from_millis(fade_ms as u64),
                            then: AfterFade::Pause,
                        });
                    }
                }
            }
            Ok(Msg::Cmd(Command::Resume)) => {
                if let Some(p) = &s.player {
                    // Unconditionally (re)play: this also cancels a pending
                    // fade-to-pause, since `p.play()` clears rodio's own
                    // paused flag regardless of what our fade was doing.
                    p.play();
                    if fade_ms == 0 {
                        s.fade = None;
                        p.set_volume(target_volume);
                    } else {
                        s.fade = Some(FadeState {
                            from: p.volume(),
                            to: target_volume,
                            start: Instant::now(),
                            duration: Duration::from_millis(fade_ms as u64),
                            then: AfterFade::None,
                        });
                    }
                }
            }
            Ok(Msg::Cmd(Command::Seek(seconds))) => {
                if let Some(p) = &s.player {
                    let _ = p.try_seek(Duration::from_secs_f64(seconds.max(0.0)));
                }
            }
            Ok(Msg::Cmd(Command::SetVolume(volume))) => {
                user_volume = volume;
                let volume = output.volume(volume);
                if let Some(f) = &mut s.fade {
                    f.to = volume;
                } else if let Some(p) = &s.player {
                    p.set_volume(volume);
                }
            }
            Ok(Msg::Cmd(Command::SetFadeMs(ms))) => {
                user_fade_ms = ms;
            }
            Ok(Msg::Cmd(Command::SetEq(bands))) => {
                dsp.eq_gains.set_all(&bands);
            }
            Ok(Msg::Cmd(Command::SetCrossfeed(strength))) => {
                dsp.crossfeed.set_strength(strength);
            }
            Ok(Msg::Cmd(Command::SetReplayGain {
                mode,
                preamp_db,
                prevent_clipping,
            })) => {
                dsp.replay_gain.set(mode, preamp_db, prevent_clipping);
                // Re-resolve for whatever is playing now; the `Gain` source
                // ramps to the new value rather than stepping to it.
                s.current_gain.set_db(dsp.gain_for(s.current_tags));
                if let Some(u) = &s.upcoming {
                    u.gain.set_db(dsp.gain_for(u.tags));
                }
            }
            Ok(Msg::Cmd(Command::SetOutputDevice(name))) => {
                output_token += 1;
                match Output::open(name.as_deref(), output.is_exclusive(), &fetch_tx, output_token) {
                    Ok(new_output) => {
                        // The live player is wired to the outgoing output, so
                        // it cannot survive the swap.
                        s.detach(&app);
                        output = new_output;
                        device_id = name;
                        device_format = None;
                        emit_status(&app, &output, &device_format, None, None);
                    }
                    Err(e) => {
                        // Keep playing on the existing device; only the switch failed.
                        let _ = app.emit("playback:error", e);
                    }
                }
            }
            Ok(Msg::Cmd(Command::SetBitPerfect(enabled))) => {
                if enabled == output.is_exclusive() {
                    emit_status(&app, &output, &device_format, s.current_format, None);
                } else {
                    // The current output has to go first: an exclusive stream
                    // can't be opened while this process holds a shared one.
                    s.detach(&app);
                    output_token += 1;
                    let previous = std::mem::replace(
                        &mut output,
                        // A placeholder only for the instant between dropping
                        // the old output and opening the new one.
                        match open_sink(None) {
                            Ok(sink) => Output::Shared(sink),
                            Err(e) => {
                                let _ = app.emit("playback:error", e);
                                continue;
                            }
                        },
                    );
                    drop(previous);
                    device_format = None;
                    match Output::open(device_id.as_deref(), enabled, &fetch_tx, output_token) {
                        Ok(new_output) => {
                            drop(std::mem::replace(&mut output, new_output));
                            emit_status(&app, &output, &device_format, None, None);
                        }
                        Err(e) => {
                            // Fall back to shared output on the chosen device.
                            if let Ok(o) = Output::open(device_id.as_deref(), false, &fetch_tx, output_token) {
                                output = o;
                            }
                            emit_status(&app, &output, &device_format, None, Some(e));
                        }
                    }
                }
            }
            Ok(Msg::Cmd(Command::SetHighQualityResampling(enabled))) => {
                // Takes effect from the next track; rebuilding the chain
                // mid-song would mean a restart.
                high_quality = enabled;
            }
            Ok(Msg::Cmd(Command::Stop)) => {
                // Invalidate any in-flight fetch regardless of branch below.
                s.generation += 1;
                s.preload_generation += 1;
                if let Some(u) = s.upcoming.take() {
                    u.handle.cancel();
                }
                match (&s.player, fade_ms) {
                    (Some(_), 0) => s.player = None,
                    (Some(p), _) => {
                        s.fade = Some(FadeState {
                            from: p.volume(),
                            to: 0.0,
                            start: Instant::now(),
                            duration: Duration::from_millis(fade_ms as u64),
                            then: AfterFade::Stop,
                        });
                    }
                    (None, _) => {}
                }
            }
            Ok(Msg::Fetched(gen, result, tags)) => {
                if gen != s.generation {
                    // Superseded by a newer Play or a Stop while this fetch
                    // was in flight — discard it.
                } else {
                    s.current_tags = tags;
                    s.current_gain = AppliedGain::unity();
                    s.current_gain.set_db(dsp.gain_for(tags));

                    let built = result.and_then(|bytes| {
                        build_chain(bytes, s.current_gain.clone(), &dsp, &tap, &output, high_quality)
                    });
                    match built {
                        Ok((chain, format)) => {
                            let p = output.start_player(chain);
                            p.set_volume(0.0);
                            p.play();
                            s.fade = if fade_ms == 0 {
                                p.set_volume(target_volume);
                                None
                            } else {
                                Some(FadeState {
                                    from: 0.0,
                                    to: target_volume,
                                    start: Instant::now(),
                                    duration: Duration::from_millis(fade_ms as u64),
                                    then: AfterFade::None,
                                })
                            };
                            s.player = Some(p);
                            s.current_format = Some(format);
                            emit_status(&app, &output, &device_format, Some(format), None);
                        }
                        Err(e) => {
                            let _ = app.emit("playback:error", e);
                        }
                    }
                }
            }
            Ok(Msg::Preloaded {
                generation: gen,
                preload_generation: pgen,
                id,
                result,
                tags,
            }) => {
                // Anything that changed what's playing, or what should come
                // next, since this was requested makes it stale. A failure is
                // dropped quietly: the normal path retries the track when it's
                // actually due, and reports the error then if it recurs.
                let current = gen == s.generation && pgen == s.preload_generation && s.upcoming.is_none();
                if let (Some(p), true) = (&s.player, current) {
                    let gain = AppliedGain::unity();
                    gain.set_db(dsp.gain_for(tags));
                    let built = result.and_then(|bytes| {
                        build_chain(bytes, gain.clone(), &dsp, &tap, &output, high_quality)
                    });
                    if let Ok((chain, format)) = built {
                        let handle = NextHandle::new();
                        p.append(Cancellable::new(chain, handle.clone()));
                        s.upcoming = Some(Upcoming { id, handle, gain, tags, format });
                    }
                }
            }
            Ok(Msg::Exclusive(token, event)) => {
                if token != output_token {
                    // From an output that has since been replaced.
                } else {
                    match event {
                        ExclusiveEvent::Opened(format) => {
                            device_format = Some(format);
                            emit_status(&app, &output, &device_format, s.current_format, None);
                        }
                        ExclusiveEvent::Failed(e) => {
                            // Exclusive mode is unusable right now (device
                            // busy, unplugged, format refused): carry on
                            // through the shared mixer rather than going silent.
                            s.detach(&app);
                            output_token += 1;
                            device_format = None;
                            drop(std::mem::replace(
                                &mut output,
                                match Output::open(device_id.as_deref(), false, &fetch_tx, output_token)
                                    .or_else(|_| Output::open(None, false, &fetch_tx, output_token))
                                {
                                    Ok(o) => o,
                                    Err(open_err) => {
                                        let _ = app.emit("playback:error", open_err);
                                        continue;
                                    }
                                },
                            ));
                            emit_status(&app, &output, &device_format, None, Some(e));
                        }
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }

        if let Some(f) = &s.fade {
            let now = Instant::now();
            if let Some(p) = &s.player {
                p.set_volume(f.value_at(now));
            }
            if f.is_done(now) {
                match f.then {
                    AfterFade::None => {}
                    AfterFade::Pause => {
                        if let Some(p) = &s.player {
                            p.set_volume(0.0);
                            p.pause();
                        }
                    }
                    AfterFade::Stop => {
                        s.player = None;
                        s.upcoming = None;
                    }
                }
                s.fade = None;
            }
        }

        // Checked before the ended/position report so the UI learns about the
        // new track before it sees a position that belongs to it.
        if s.upcoming.as_ref().is_some_and(|u| u.handle.has_started()) {
            let u = s.upcoming.take().expect("checked above");
            s.current_tags = u.tags;
            s.current_gain = u.gain;
            s.current_format = Some(u.format);
            let _ = app.emit("playback:advanced", u.id);
            emit_status(&app, &output, &device_format, s.current_format, None);
        }

        if let Some(p) = &s.player {
            if p.empty() {
                s.player = None;
                s.upcoming = None;
                let _ = app.emit("playback:ended", json!({}));
            } else {
                let _ = app.emit("playback:position", p.get_pos().as_secs_f64());
            }
        }

        // Derived from the real player state rather than set in each command
        // branch, so pause/stop/end-of-track all gate the visualiser correctly.
        tap.set_active(s.player.as_ref().is_some_and(|p| !p.is_paused()));
    }
}
