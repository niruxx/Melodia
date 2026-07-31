use std::collections::HashMap;
use std::io::Cursor;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};

use rodio::{stream::DeviceSinkBuilder, Decoder, Player};
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::equalizer::{EqGains, Equalizer, BAND_COUNT};

/// Where to read a track's audio bytes from.
pub enum PlaySource {
    Remote(String, HashMap<String, String>),
    Local(String),
}

enum Command {
    Play(PlaySource),
    Pause,
    Resume,
    Seek(f64),
    SetVolume(f32),
    SetFadeMs(u32),
    SetEq([f32; BAND_COUNT]),
    Stop,
}

/// Messages the audio thread's loop selects over: either a real command from
/// `Playback`, or a background fetch reporting back. Fetches never run inline
/// in the command loop — a slow/stalled network read must not block Stop,
/// Pause, or a newer Play from being processed.
enum Msg {
    Cmd(Command),
    Fetched(u64, Result<Vec<u8>, String>),
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
        let eq_gains = EqGains::flat();
        std::thread::spawn(move || audio_thread(app, rx, fetch_tx, eq_gains));
        Self { tx }
    }

    fn send(&self, cmd: Command) -> Result<(), String> {
        self.tx
            .send(Msg::Cmd(cmd))
            .map_err(|_| "audio engine is not running".to_string())
    }

    pub fn play(&self, url: String, headers: HashMap<String, String>) -> Result<(), String> {
        self.send(Command::Play(PlaySource::Remote(url, headers)))
    }

    pub fn play_local(&self, path: String) -> Result<(), String> {
        self.send(Command::Play(PlaySource::Local(path)))
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
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| describe_error(&e))?;

    let mut request = client.get(url);
    for (key, value) in headers {
        request = request.header(key.as_str(), value.as_str());
    }

    let response = request.send().map_err(|e| describe_error(&e))?;
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

fn audio_thread(
    app: AppHandle,
    rx: std::sync::mpsc::Receiver<Msg>,
    fetch_tx: Sender<Msg>,
    eq_gains: Arc<EqGains>,
) {
    let device_sink = match DeviceSinkBuilder::open_default_sink() {
        Ok(sink) => sink,
        Err(e) => {
            let _ = app.emit("playback:error", format!("no audio output device: {e}"));
            return;
        }
    };
    let mixer = device_sink.mixer();
    let mut player: Option<Player> = None;
    // Bumped on every Play/Stop so a fetch that finishes after being
    // superseded (by a newer Play or a Stop) gets discarded instead of
    // clobbering whatever should actually be playing.
    let mut generation: u64 = 0;

    // The user's actual chosen output level, distinct from whatever
    // instantaneous value a fade ramp is currently driving the player to.
    let mut target_volume: f32 = 1.0;
    let mut fade_ms: u32 = 0;
    let mut fade: Option<FadeState> = None;

    loop {
        // Poll finely while a fade is in flight for a smooth ~50Hz ramp;
        // otherwise the coarser interval is plenty for position/ended events.
        let poll_interval = if fade.is_some() {
            Duration::from_millis(20)
        } else {
            Duration::from_millis(250)
        };

        match rx.recv_timeout(poll_interval) {
            Ok(Msg::Cmd(Command::Play(source))) => {
                if let Some(p) = player.take() {
                    p.stop();
                }
                fade = None;
                generation += 1;
                let gen = generation;
                let tx = fetch_tx.clone();
                std::thread::spawn(move || {
                    let result = match source {
                        PlaySource::Remote(url, headers) => fetch_bytes(&url, &headers),
                        PlaySource::Local(path) => {
                            std::fs::read(&path).map_err(|e| format!("{e} ({path})"))
                        }
                    };
                    let _ = tx.send(Msg::Fetched(gen, result));
                });
            }
            Ok(Msg::Cmd(Command::Pause)) => {
                if let Some(p) = &player {
                    if fade_ms == 0 {
                        p.pause();
                    } else {
                        fade = Some(FadeState {
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
                if let Some(p) = &player {
                    // Unconditionally (re)play: this also cancels a pending
                    // fade-to-pause, since `p.play()` clears rodio's own
                    // paused flag regardless of what our fade was doing.
                    p.play();
                    if fade_ms == 0 {
                        fade = None;
                        p.set_volume(target_volume);
                    } else {
                        fade = Some(FadeState {
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
                if let Some(p) = &player {
                    let _ = p.try_seek(Duration::from_secs_f64(seconds.max(0.0)));
                }
            }
            Ok(Msg::Cmd(Command::SetVolume(volume))) => {
                target_volume = volume;
                if let Some(f) = &mut fade {
                    f.to = volume;
                } else if let Some(p) = &player {
                    p.set_volume(volume);
                }
            }
            Ok(Msg::Cmd(Command::SetFadeMs(ms))) => {
                fade_ms = ms;
            }
            Ok(Msg::Cmd(Command::SetEq(bands))) => {
                eq_gains.set_all(&bands);
            }
            Ok(Msg::Cmd(Command::Stop)) => {
                // Invalidate any in-flight fetch regardless of branch below.
                generation += 1;
                match (&player, fade_ms) {
                    (Some(_), 0) => player = None,
                    (Some(p), _) => {
                        fade = Some(FadeState {
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
            Ok(Msg::Fetched(gen, result)) => {
                if gen != generation {
                    // Superseded by a newer Play or a Stop while this fetch
                    // was in flight — discard it.
                } else {
                    match result
                        .and_then(|bytes| Decoder::new(Cursor::new(bytes)).map_err(|e| e.to_string()))
                    {
                        Ok(source) => {
                            let p = Player::connect_new(mixer);
                            p.append(Equalizer::new(source, eq_gains.clone()));
                            p.set_volume(0.0);
                            p.play();
                            fade = if fade_ms == 0 {
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
                            player = Some(p);
                        }
                        Err(e) => {
                            let _ = app.emit("playback:error", e);
                        }
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }

        if let Some(f) = &fade {
            let now = Instant::now();
            if let Some(p) = &player {
                p.set_volume(f.value_at(now));
            }
            if f.is_done(now) {
                match f.then {
                    AfterFade::None => {}
                    AfterFade::Pause => {
                        if let Some(p) = &player {
                            p.set_volume(0.0);
                            p.pause();
                        }
                    }
                    AfterFade::Stop => {
                        player = None;
                    }
                }
                fade = None;
            }
        }

        if let Some(p) = &player {
            if p.empty() {
                player = None;
                let _ = app.emit("playback:ended", json!({}));
            } else {
                let _ = app.emit("playback:position", p.get_pos().as_secs_f64());
            }
        }
    }
}
