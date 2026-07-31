use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::prelude::Accessor;
use lofty::probe::Probe;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

// mp3/flac/wav/m4a (AAC-in-MP4) are decodable via rodio's default features
// and taggable via lofty already. "aac" (bare ADTS elementary stream, no MP4
// container) is a distinct format both libraries also support natively —
// confirmed via source: rodio's `mp4` feature enables symphonia's `aac`
// feature, which registers symphonia's `AdtsReader` format (not just the AAC
// codec) in the shared probe rodio's `Decoder` uses; lofty has a dedicated
// `FileType::Aac` for tag/property reading. It was just missing from this
// extension list, so such files were silently skipped during a folder scan.
const AUDIO_EXTENSIONS: &[&str] = &["mp3", "m4a", "aac", "flac", "wav", "ogg"];

#[derive(Serialize, Clone)]
pub struct LocalTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    pub thumbnail: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Config {
    folder: String,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("local_library.json"))
}

#[tauri::command]
pub fn local_get_folder(app: AppHandle) -> Result<Option<String>, String> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let cfg: Config = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(Some(cfg.folder))
}

#[tauri::command]
pub fn local_set_folder(app: AppHandle, folder: String) -> Result<(), String> {
    let path = config_path(&app)?;
    let cfg = Config { folder };
    let text = serde_json::to_string(&cfg).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())
}

fn read_track(path: &Path) -> Option<LocalTrack> {
    let tagged = Probe::open(path).ok()?.read().ok()?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let duration = tagged.properties().duration().as_secs_f64();

    let file_stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let parent_name = path
        .parent()
        .and_then(|p| p.file_name())
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let title = tag
        .and_then(|t| t.title().map(|s| s.to_string()))
        .filter(|s| !s.is_empty())
        .unwrap_or(file_stem);
    let artist = tag
        .and_then(|t| t.artist().map(|s| s.to_string()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Unknown Artist".to_string());
    let album = tag
        .and_then(|t| t.album().map(|s| s.to_string()))
        .filter(|s| !s.is_empty())
        .unwrap_or(parent_name);

    let thumbnail = tag.and_then(|t| t.pictures().first()).map(|pic| {
        let mime = pic
            .mime_type()
            .map(|m| m.to_string())
            .unwrap_or_else(|| "image/jpeg".to_string());
        format!("data:{};base64,{}", mime, STANDARD.encode(pic.data()))
    });

    Some(LocalTrack {
        id: format!("local:{}", path.to_string_lossy()),
        title,
        artist,
        album,
        duration,
        thumbnail,
    })
}

#[tauri::command]
pub fn local_scan(app: AppHandle) -> Result<Vec<LocalTrack>, String> {
    let folder = local_get_folder(app)?.ok_or("no local music folder configured")?;
    let root = PathBuf::from(&folder);
    if !root.is_dir() {
        return Err("the configured local music folder no longer exists".to_string());
    }

    let mut tracks = Vec::new();
    for entry in walkdir::WalkDir::new(&root)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let ext = entry
            .path()
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_lowercase());
        let is_audio = matches!(ext.as_deref(), Some(e) if AUDIO_EXTENSIONS.contains(&e));
        if !is_audio {
            continue;
        }
        if let Some(track) = read_track(entry.path()) {
            tracks.push(track);
        }
    }
    Ok(tracks)
}
