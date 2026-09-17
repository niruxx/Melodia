use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::prelude::{Accessor, ItemKey};
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
#[serde(rename_all = "camelCase")]
pub struct LocalTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    pub thumbnail: Option<String>,
    /// Who the *album* is credited to, which is what albums should be grouped
    /// by — a compilation's tracks each have their own `artist`.
    pub album_artist: Option<String>,
    pub composers: Vec<String>,
    pub genres: Vec<String>,
    pub performers: Vec<String>,
    pub producers: Vec<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub year: Option<u32>,
}

/// Collects every value stored under a key.
///
/// Two things produce multiple values: repeated entries (how Vorbis comments
/// and ID3v2.4 do it), and a single entry packing several values into one
/// string. For the latter only `;` and NUL are treated as separators — `/`
/// looks like one but is far too common inside real names to split on ("AC/DC",
/// and "Folk/Rock" as a single genre).
fn multi_value(tag: &lofty::tag::Tag, key: ItemKey) -> Vec<String> {
    tag.get_strings(key)
        .flat_map(|value| value.split([';', '\0']))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

#[derive(Serialize, Deserialize)]
struct Config {
    folder: String,
}

pub(crate) fn app_data_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(name))
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app_data_file(app, "local_library.json")
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

/// Pulls a release year out of a date tag.
///
/// Tags carry anything from a bare `1994` to a full `2019-05-17T00:00:00`, so
/// this takes the leading four-digit run rather than trying to parse a date.
fn parse_year(raw: &str) -> Option<u32> {
    let digits: String = raw
        .trim()
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if digits.len() != 4 {
        return None;
    }
    digits.parse().ok()
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
        album_artist: tag
            .and_then(|t| t.get_string(ItemKey::AlbumArtist))
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty()),
        composers: tag.map(|t| multi_value(t, ItemKey::Composer)).unwrap_or_default(),
        genres: tag.map(|t| multi_value(t, ItemKey::Genre)).unwrap_or_default(),
        performers: tag.map(|t| multi_value(t, ItemKey::Performer)).unwrap_or_default(),
        producers: tag.map(|t| multi_value(t, ItemKey::Producer)).unwrap_or_default(),
        track_number: tag.and_then(|t| t.track()),
        disc_number: tag.and_then(|t| t.disk()),
        year: tag.and_then(|t| {
            t.get_string(ItemKey::Year)
                .or_else(|| t.get_string(ItemKey::RecordingDate))
                .and_then(parse_year)
        }),
    })
}

/// The configured library folder, checked to still exist.
pub(crate) fn library_root(app: AppHandle) -> Result<PathBuf, String> {
    let folder = local_get_folder(app)?.ok_or("no local music folder configured")?;
    let root = PathBuf::from(&folder);
    if !root.is_dir() {
        return Err("the configured local music folder no longer exists".to_string());
    }
    Ok(root)
}

/// The filesystem path a local track's id refers to.
pub(crate) fn track_path(track: &LocalTrack) -> PathBuf {
    PathBuf::from(track.id.strip_prefix("local:").unwrap_or(&track.id))
}

#[tauri::command]
pub fn local_scan(app: AppHandle) -> Result<Vec<LocalTrack>, String> {
    Ok(scan(&library_root(app)?))
}

pub(crate) fn scan(root: &Path) -> Vec<LocalTrack> {
    let mut tracks = Vec::new();
    for entry in walkdir::WalkDir::new(root)
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

    // Walk order is whatever the filesystem hands back, which scatters an
    // album's tracks. Disc and track numbers are the order they were meant to
    // be heard in; title breaks the tie for untagged files, where both are None.
    sort_for_display(&mut tracks);
    tracks
}

fn sort_for_display(tracks: &mut [LocalTrack]) {
    tracks.sort_by(|a, b| {
        let album_key = |t: &LocalTrack| {
            (
                t.album_artist.as_deref().unwrap_or(&t.artist).to_lowercase(),
                t.album.to_lowercase(),
            )
        };
        album_key(a)
            .cmp(&album_key(b))
            .then(a.disc_number.unwrap_or(1).cmp(&b.disc_number.unwrap_or(1)))
            .then(a.track_number.cmp(&b.track_number))
            .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(title: &str, album: &str, disc: Option<u32>, number: Option<u32>) -> LocalTrack {
        LocalTrack {
            id: format!("local:{title}"),
            title: title.to_string(),
            artist: "Artist".to_string(),
            album: album.to_string(),
            duration: 0.0,
            thumbnail: None,
            album_artist: None,
            composers: Vec::new(),
            genres: Vec::new(),
            performers: Vec::new(),
            producers: Vec::new(),
            track_number: number,
            disc_number: disc,
            year: None,
        }
    }

    #[test]
    fn parses_year_from_assorted_date_tags() {
        assert_eq!(parse_year("1994"), Some(1994));
        assert_eq!(parse_year("2019-05-17"), Some(2019));
        assert_eq!(parse_year("2019-05-17T00:00:00"), Some(2019));
        assert_eq!(parse_year("  2005  "), Some(2005));
    }

    #[test]
    fn rejects_years_that_are_not_four_digits() {
        assert_eq!(parse_year("94"), None);
        assert_eq!(parse_year(""), None);
        assert_eq!(parse_year("not a year"), None);
        assert_eq!(parse_year("20190517"), None, "a run-on date is not a year");
    }

    /// The whole point of reading disc/track numbers: an album has to come back
    /// in the order it was meant to be heard, not in whatever order the
    /// filesystem walk produced.
    #[test]
    fn tracks_sort_into_disc_and_track_order() {
        let mut tracks = vec![
            track("Third", "Album", Some(2), Some(1)),
            track("First", "Album", Some(1), Some(1)),
            track("Second", "Album", Some(1), Some(2)),
        ];
        sort_for_display(&mut tracks);
        let titles: Vec<&str> = tracks.iter().map(|t| t.title.as_str()).collect();
        assert_eq!(titles, ["First", "Second", "Third"]);
    }

    /// A single-disc album leaves the disc tag off entirely, so an untagged
    /// disc has to sort as disc 1 rather than ahead of or behind everything.
    #[test]
    fn a_missing_disc_number_counts_as_the_first_disc() {
        let mut tracks = vec![
            track("Disc two opener", "Album", Some(2), Some(1)),
            track("Untagged disc", "Album", None, Some(5)),
        ];
        sort_for_display(&mut tracks);
        assert_eq!(tracks[0].title, "Untagged disc");
    }

    #[test]
    fn untagged_tracks_fall_back_to_title_order() {
        let mut tracks = vec![
            track("Zebra", "Album", None, None),
            track("apple", "Album", None, None),
        ];
        sort_for_display(&mut tracks);
        assert_eq!(tracks[0].title, "apple", "ordering is case-insensitive");
    }

    /// Two albums sharing a name are a real collision ("Greatest Hits"), and
    /// the album artist is what keeps them apart.
    #[test]
    fn same_named_albums_stay_separated_by_album_artist() {
        let mut one = track("A", "Greatest Hits", None, Some(1));
        one.album_artist = Some("Queen".to_string());
        let mut two = track("B", "Greatest Hits", None, Some(1));
        two.album_artist = Some("ABBA".to_string());

        let mut tracks = vec![one, two];
        sort_for_display(&mut tracks);
        assert_eq!(tracks[0].album_artist.as_deref(), Some("ABBA"));
    }
}
