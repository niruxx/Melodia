use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::local_library::{self, LocalTrack};

const JOURNAL_FILE: &str = "organize_journal.jsonl";

/// Longest a single path component may get. Well under every filesystem's
/// 255-byte limit even after UTF-8 expansion, and keeps full paths clear of
/// Windows' legacy 260-character ceiling for sensibly nested templates.
const MAX_COMPONENT_CHARS: usize = 100;

const FIELDS: &[&str] = &[
    "title",
    "artist",
    "albumartist",
    "album",
    "genre",
    "composer",
    "year",
    "track",
    "disc",
];

/// Names Windows refuses as a file or folder, with or without an extension.
const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Move {
    pub from: PathBuf,
    pub to: PathBuf,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub moves: Vec<Move>,
    /// Tracks already where the template says they belong.
    pub unchanged: usize,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    /// Every move that actually happened, so the UI can repoint anything
    /// (the queue, liked songs) still holding an old path.
    pub moved: Vec<Move>,
    pub failed: Vec<String>,
}

/// Makes a tag value safe to use as (part of) a file name. Path separators are
/// replaced here, *before* the template is split into folders, so an artist
/// like "AC/DC" can never create a folder level of its own.
fn sanitize_value(value: &str) -> String {
    value
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect()
}

/// Tidies a rendered component. Trimming separators off the ends is what lets
/// `{year} - {album}` degrade to just the album when there's no year.
fn finish_component(raw: &str) -> String {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    // Trailing dots and spaces are silently dropped by Windows, and a leading
    // dot hides a file on everything else.
    let trimmed = collapsed.trim_matches(|c: char| c == ' ' || c == '-' || c == '.' || c == '_');
    let mut out: String = trimmed.chars().take(MAX_COMPONENT_CHARS).collect();
    out = out.trim_end_matches(['.', ' ']).to_string();

    if out.is_empty() {
        return "_".to_string();
    }
    let stem = out.split('.').next().unwrap_or("").to_ascii_uppercase();
    if RESERVED.contains(&stem.as_str()) {
        out.push('_');
    }
    out
}

fn field_value(track: &LocalTrack, field: &str) -> String {
    let first = |values: &[String]| values.first().cloned();
    let value = match field {
        "title" => Some(track.title.clone()),
        "artist" => Some(track.artist.clone()),
        "albumartist" => Some(track.album_artist.clone().unwrap_or_else(|| track.artist.clone())),
        "album" => Some(track.album.clone()),
        "genre" => Some(first(&track.genres).unwrap_or_else(|| "Unknown Genre".to_string())),
        "composer" => Some(first(&track.composers).unwrap_or_else(|| "Unknown Composer".to_string())),
        // Numeric fields render empty rather than as a placeholder, so the
        // separators around them trim away cleanly.
        "year" => track.year.map(|y| y.to_string()),
        "track" => track.track_number.map(|n| format!("{n:02}")),
        "disc" => track.disc_number.map(|n| n.to_string()),
        _ => None,
    };
    sanitize_value(&value.unwrap_or_default())
}

/// Checks a template up front, so a typo is reported once rather than as a
/// failure on every file.
pub fn validate_template(template: &str) -> Result<(), String> {
    if template.trim().is_empty() {
        return Err("the template is empty".to_string());
    }
    let mut rest = template;
    while let Some(open) = rest.find('{') {
        let after = &rest[open + 1..];
        let close = after
            .find('}')
            .ok_or_else(|| "a `{` in the template is never closed".to_string())?;
        let name = after[..close].trim().to_ascii_lowercase();
        if !FIELDS.contains(&name.as_str()) {
            return Err(format!(
                "unknown field {{{name}}} — use one of: {}",
                FIELDS.iter().map(|f| format!("{{{f}}}")).collect::<Vec<_>>().join(", ")
            ));
        }
        rest = &after[close + 1..];
    }
    if template.split(['/', '\\']).any(|seg| seg.trim() == "..") {
        return Err("the template can't climb out of the library folder with `..`".to_string());
    }
    Ok(())
}

/// Renders a template into the relative path (without extension) a track
/// belongs at.
pub fn render(template: &str, track: &LocalTrack) -> Result<PathBuf, String> {
    validate_template(template)?;
    let mut path = PathBuf::new();
    for segment in template.split(['/', '\\']).filter(|s| !s.trim().is_empty()) {
        let mut rendered = String::new();
        let mut rest = segment;
        while let Some(open) = rest.find('{') {
            rendered.push_str(&rest[..open]);
            let after = &rest[open + 1..];
            let close = after.find('}').expect("validated above");
            rendered.push_str(&field_value(track, &after[..close].trim().to_ascii_lowercase()));
            rest = &after[close + 1..];
        }
        rendered.push_str(rest);
        path.push(finish_component(&rendered));
    }
    Ok(path)
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Lowercased for claim tracking: two targets differing only in case are the
/// same file on Windows and macOS, and planning as if they weren't would
/// have one move overwrite the other.
fn claim_key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

/// Picks `path`, or `path (2)`, `path (3)` … — whichever is free.
fn free_target(path: PathBuf, from: &Path, claimed: &HashSet<String>) -> PathBuf {
    let taken = |p: &Path| claimed.contains(&claim_key(p)) || (p.exists() && !same_file(p, from));
    if !taken(&path) {
        return path;
    }
    let stem = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let ext = path.extension().map(|e| e.to_string_lossy().to_string());
    for n in 2.. {
        let name = match &ext {
            Some(ext) => format!("{stem} ({n}).{ext}"),
            None => format!("{stem} ({n})"),
        };
        let candidate = path.with_file_name(name);
        if !taken(&candidate) {
            return candidate;
        }
    }
    unreachable!("the range above is unbounded")
}

/// Works out every move needed, without touching the disk.
pub fn plan(root: &Path, template: &str, tracks: &[LocalTrack]) -> Result<Plan, String> {
    validate_template(template)?;
    let mut moves = Vec::new();
    let mut unchanged = 0;
    let mut claimed = HashSet::new();

    for track in tracks {
        let from = local_library::track_path(track);
        let Some(ext) = from.extension().map(|e| e.to_string_lossy().to_lowercase()) else {
            continue;
        };
        let wanted = root.join(render(template, track)?).with_extension(&ext);

        if wanted == from {
            unchanged += 1;
            claimed.insert(claim_key(&wanted));
            continue;
        }
        let to = free_target(wanted, &from, &claimed);
        claimed.insert(claim_key(&to));

        // Lyrics travel with their track, or they'd stop being found.
        let lrc = from.with_extension("lrc");
        if lrc.is_file() {
            let lrc_to = to.with_extension("lrc");
            if !claimed.contains(&claim_key(&lrc_to)) && !lrc_to.exists() {
                claimed.insert(claim_key(&lrc_to));
                moves.push(Move { from: lrc, to: lrc_to });
            }
        }
        moves.push(Move { from, to });
    }
    Ok(Plan { moves, unchanged })
}

/// Removes folders left empty by a move, walking up but never past `root`.
fn prune_empty_dirs(start: Option<&Path>, root: &Path) {
    let mut dir = start;
    while let Some(d) = dir {
        if d == root || !d.starts_with(root) {
            break;
        }
        // Fails (harmlessly) the moment a folder still has something in it.
        if fs::remove_dir(d).is_err() {
            break;
        }
        dir = d.parent();
    }
}

fn perform(moves: &[Move], root: &Path, mut on_done: impl FnMut(&Move) -> std::io::Result<()>) -> Report {
    let mut report = Report::default();
    for m in moves {
        let result = (|| -> Result<(), String> {
            if !m.from.exists() {
                return Err(format!("{} is gone", m.from.display()));
            }
            // Re-checked at the last moment: the plan may be stale.
            if m.to.exists() && !same_file(&m.to, &m.from) {
                return Err(format!("{} already exists", m.to.display()));
            }
            if let Some(parent) = m.to.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
            }
            fs::rename(&m.from, &m.to).map_err(|e| format!("{}: {e}", m.from.display()))?;
            on_done(m).map_err(|e| format!("couldn't record the move for undo: {e}"))?;
            Ok(())
        })();
        match result {
            Ok(()) => {
                prune_empty_dirs(m.from.parent(), root);
                report.moved.push(m.clone());
            }
            Err(e) => report.failed.push(e),
        }
    }
    report
}

/// Carries out a plan, journalling each completed move before the next one
/// starts so an interrupted run can still be undone.
pub fn apply(moves: &[Move], root: &Path, journal: &Path) -> Result<Report, String> {
    let file = fs::File::create(journal).map_err(|e| format!("couldn't start the undo journal: {e}"))?;
    let mut writer = std::io::BufWriter::new(file);
    Ok(perform(moves, root, |m| {
        serde_json::to_writer(&mut writer, m).map_err(std::io::Error::other)?;
        writer.write_all(b"\n")?;
        writer.flush()
    }))
}

/// Reverses the last applied organize, newest move first.
pub fn undo(root: &Path, journal: &Path) -> Result<Report, String> {
    let file = fs::File::open(journal).map_err(|_| "there's nothing to undo".to_string())?;
    let done: Vec<Move> = BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        // A line cut short by a crash mid-write is the only way to get here
        // with bad JSON; that move never completed, so skipping it is right.
        .filter_map(|line| serde_json::from_str(&line).ok())
        .collect();

    let reversed: Vec<Move> = done
        .into_iter()
        .rev()
        .map(|m| Move { from: m.to, to: m.from })
        .collect();
    let report = perform(&reversed, root, |_| Ok(()));
    if report.failed.is_empty() {
        let _ = fs::remove_file(journal);
    }
    Ok(report)
}

fn journal_path(app: &AppHandle) -> Result<PathBuf, String> {
    local_library::app_data_file(app, JOURNAL_FILE)
}

#[tauri::command]
pub fn organize_preview(app: AppHandle, template: String) -> Result<Plan, String> {
    let root = local_library::library_root(app)?;
    plan(&root, &template, &local_library::scan(&root))
}

/// Re-plans from disk rather than trusting a preview the UI is holding —
/// the library may have changed since it was shown.
#[tauri::command]
pub fn organize_apply(app: AppHandle, template: String) -> Result<Report, String> {
    let root = local_library::library_root(app.clone())?;
    let plan = plan(&root, &template, &local_library::scan(&root))?;
    apply(&plan.moves, &root, &journal_path(&app)?)
}

#[tauri::command]
pub fn organize_undo(app: AppHandle) -> Result<Report, String> {
    let root = local_library::library_root(app.clone())?;
    undo(&root, &journal_path(&app)?)
}

#[tauri::command]
pub fn organize_can_undo(app: AppHandle) -> bool {
    journal_path(&app).is_ok_and(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(path: &Path) -> LocalTrack {
        LocalTrack {
            id: format!("local:{}", path.display()),
            title: "Song".into(),
            artist: "Artist".into(),
            album: "Album".into(),
            duration: 0.0,
            thumbnail: None,
            album_artist: None,
            composers: Vec::new(),
            genres: vec!["Rock".into()],
            performers: Vec::new(),
            producers: Vec::new(),
            track_number: Some(3),
            disc_number: None,
            year: Some(1994),
        }
    }

    /// A private scratch folder per test, removed again on drop.
    struct Scratch(PathBuf);
    impl Scratch {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("melodia-organize-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn file(&self, rel: &str) -> PathBuf {
            let p = self.0.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(&p, rel).unwrap();
            p
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn renders_the_documented_example() {
        let t = track(Path::new("x.flac"));
        let path = render("{genre}/{albumartist}/{year} - {album}/{track} - {title}", &t).unwrap();
        assert_eq!(path, PathBuf::from("Rock/Artist/1994 - Album/03 - Song"));
    }

    #[test]
    fn missing_numbers_take_their_separators_with_them() {
        let mut t = track(Path::new("x.flac"));
        t.year = None;
        t.track_number = None;
        let path = render("{year} - {album}/{track} - {title}", &t).unwrap();
        assert_eq!(path, PathBuf::from("Album/Song"));
    }

    /// The reason values are sanitized before the template is split.
    #[test]
    fn a_slash_in_a_tag_never_becomes_a_folder() {
        let mut t = track(Path::new("x.flac"));
        t.artist = "AC/DC".into();
        assert_eq!(render("{artist}/{title}", &t).unwrap(), PathBuf::from("AC_DC/Song"));
    }

    #[test]
    fn illegal_and_reserved_names_are_neutralised() {
        let mut t = track(Path::new("x.flac"));
        t.title = "What? Why: \"No\"".into();
        t.album = "con".into();
        let path = render("{album}/{title}", &t).unwrap();
        assert_eq!(path, PathBuf::from("con_/What_ Why_ _No"));
    }

    #[test]
    fn trailing_dots_and_long_names_are_trimmed() {
        let mut t = track(Path::new("x.flac"));
        t.album = "Etc...".into();
        t.title = "x".repeat(300);
        let path = render("{album}/{title}", &t).unwrap();
        let parts: Vec<_> = path.iter().map(|p| p.to_string_lossy().to_string()).collect();
        assert_eq!(parts[0], "Etc");
        assert_eq!(parts[1].chars().count(), MAX_COMPONENT_CHARS);
    }

    #[test]
    fn album_artist_falls_back_to_artist() {
        let mut t = track(Path::new("x.flac"));
        assert_eq!(render("{albumartist}", &t).unwrap(), PathBuf::from("Artist"));
        t.album_artist = Some("Various Artists".into());
        assert_eq!(render("{albumartist}", &t).unwrap(), PathBuf::from("Various Artists"));
    }

    #[test]
    fn bad_templates_are_rejected_up_front() {
        assert!(validate_template("{artsit}/{title}").is_err());
        assert!(validate_template("{artist/{title}").is_err());
        assert!(validate_template("../{title}").is_err());
        assert!(validate_template("   ").is_err());
        assert!(validate_template("{Artist}/{TITLE}").is_ok(), "field names are case-insensitive");
    }

    #[test]
    fn files_already_in_place_are_left_alone() {
        let s = Scratch::new("in-place");
        let f = s.file("Artist/03 - Song.flac");
        let plan = plan(&s.0, "{artist}/{track} - {title}", &[track(&f)]).unwrap();
        assert!(plan.moves.is_empty());
        assert_eq!(plan.unchanged, 1);
    }

    /// Two tracks rendering to one name must not overwrite each other, and an
    /// unrelated file already sitting at the target must be respected too.
    #[test]
    fn collisions_get_numbered() {
        let s = Scratch::new("collide");
        let a = s.file("a.flac");
        let b = s.file("b.flac");
        s.file("Artist/Song.flac");
        let plan = plan(&s.0, "{artist}/{title}", &[track(&a), track(&b)]).unwrap();
        let targets: Vec<_> = plan.moves.iter().map(|m| m.to.clone()).collect();
        assert_eq!(
            targets,
            vec![s.0.join("Artist/Song (2).flac"), s.0.join("Artist/Song (3).flac")]
        );
    }

    #[test]
    fn apply_moves_files_with_their_lyrics_and_undo_restores_them() {
        let s = Scratch::new("round-trip");
        let journal = s.0.join("journal.jsonl");
        let song = s.file("inbox/messy name.FLAC");
        s.file("inbox/messy name.lrc");

        let plan = plan(&s.0, "{artist}/{album}/{track} - {title}", &[track(&song)]).unwrap();
        let report = apply(&plan.moves, &s.0, &journal).unwrap();
        assert!(report.failed.is_empty(), "{:?}", report.failed);

        let dest = s.0.join("Artist/Album/03 - Song.flac");
        assert!(dest.is_file(), "extension is normalised to lowercase");
        assert!(dest.with_extension("lrc").is_file(), "lyrics followed the track");
        assert!(!s.0.join("inbox").exists(), "the emptied folder was removed");

        let undone = undo(&s.0, &journal).unwrap();
        assert!(undone.failed.is_empty(), "{:?}", undone.failed);
        assert!(song.is_file());
        assert!(song.with_extension("lrc").is_file());
        assert!(!s.0.join("Artist").exists(), "undo tidies up after itself too");
        assert!(!journal.exists(), "a completed undo can't be run twice");
    }

    #[test]
    fn a_stale_plan_fails_per_file_instead_of_overwriting() {
        let s = Scratch::new("stale");
        let journal = s.0.join("journal.jsonl");
        let song = s.file("a.flac");
        let plan = plan(&s.0, "{title}", &[track(&song)]).unwrap();
        // Something appears at the destination after planning.
        let squatter = s.file("Song.flac");

        let report = apply(&plan.moves, &s.0, &journal).unwrap();
        assert_eq!(report.failed.len(), 1);
        assert!(song.is_file());
        assert_eq!(fs::read_to_string(squatter).unwrap(), "Song.flac", "untouched");
    }

    #[test]
    fn nothing_to_undo_is_reported() {
        let s = Scratch::new("no-journal");
        assert!(undo(&s.0, &s.0.join("missing.jsonl")).is_err());
    }
}
