use std::path::{Path, PathBuf};

use lofty::file::TaggedFileExt;
use lofty::prelude::ItemKey;
use lofty::probe::Probe;
use serde::Serialize;

/// A single timed lyric line.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    pub start_ms: i64,
    pub text: String,
}

/// What a local file had to offer. `lines` is empty when nothing timed could
/// be parsed, in which case `plain` carries whatever text was found.
#[derive(Serialize, Default, Debug, PartialEq)]
pub struct LocalLyrics {
    pub lines: Vec<LyricLine>,
    pub plain: Option<String>,
}

/// Parses one `mm:ss`, `mm:ss.xx` or `mm:ss:xx` timestamp into milliseconds.
///
/// Minutes are deliberately not capped at 59 — a long DJ set or audiobook
/// chapter legitimately runs past an hour and writes `[73:20.50]`.
fn parse_timestamp(raw: &str) -> Option<i64> {
    let (minutes, rest) = raw.split_once(':')?;
    let minutes: i64 = minutes.trim().parse().ok()?;
    if minutes < 0 {
        return None;
    }

    // The fraction is separated by '.' in the common form and by a second ':'
    // in the older one; both mean the same thing.
    let (seconds, fraction) = match rest.split_once(['.', ':']) {
        Some((s, f)) => (s, Some(f)),
        None => (rest, None),
    };
    let seconds: i64 = seconds.trim().parse().ok()?;
    if !(0..60).contains(&seconds) {
        return None;
    }

    let fraction_ms = match fraction {
        None => 0,
        Some(f) => {
            let digits: String = f.trim().chars().take_while(|c| c.is_ascii_digit()).collect();
            if digits.is_empty() {
                return None;
            }
            let value: i64 = digits.parse().ok()?;
            match digits.len() {
                1 => value * 100,
                2 => value * 10,
                _ => value / 10i64.pow(digits.len() as u32 - 3),
            }
        }
    };

    Some(minutes * 60_000 + seconds * 1_000 + fraction_ms)
}

/// Parses LRC text into timed lines, sorted by time.
///
/// Returns an empty vec for text that carries no timestamps at all, which is
/// how a plain-text lyrics file (or a plain embedded tag) is distinguished
/// from a synced one.
pub fn parse_lrc(text: &str) -> Vec<LyricLine> {
    let mut out: Vec<LyricLine> = Vec::new();
    let mut offset_ms: i64 = 0;

    for raw_line in text.lines() {
        let mut rest = raw_line.trim_start();
        let mut stamps: Vec<i64> = Vec::new();

        // A line can carry several timestamps, all sharing the text that
        // follows them — how LRC files avoid repeating a chorus.
        while let Some(stripped) = rest.strip_prefix('[') {
            let Some(end) = stripped.find(']') else { break };
            let inside = &stripped[..end];

            if let Some(ms) = parse_timestamp(inside) {
                stamps.push(ms);
            } else if let Some(value) = inside.strip_prefix("offset:") {
                if let Ok(parsed) = value.trim().trim_start_matches('+').parse::<i64>() {
                    offset_ms = parsed;
                }
            }
            // Anything else in brackets is metadata ([ar:], [ti:], [by:] …),
            // skipped along with the timestamps.
            rest = &stripped[end + 1..];
        }

        if stamps.is_empty() {
            continue;
        }
        let text = rest.trim().to_string();
        for start in stamps {
            out.push(LyricLine {
                // A positive offset means "show these lyrics earlier", so it
                // comes off the timestamps rather than being added to them.
                start_ms: (start - offset_ms).max(0),
                text: text.clone(),
            });
        }
    }

    out.sort_by_key(|line| line.start_ms);
    out
}

/// The `.lrc` sitting next to a track, if there is one.
fn sidecar_lrc_path(audio: &Path) -> Option<PathBuf> {
    // Tried in both cases because only Windows and macOS will find the file
    // regardless; a Linux filesystem is exact about it.
    for ext in ["lrc", "LRC"] {
        let candidate = audio.with_extension(ext);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Lyrics embedded in the file's own tags, which may themselves be LRC-formatted.
fn embedded_lyrics(audio: &Path) -> Option<String> {
    let tagged = Probe::open(audio).ok()?.read().ok()?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
    tag.get_string(ItemKey::Lyrics)
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty())
}

/// Finds whatever lyrics a local file has: a sidecar `.lrc` first, then the
/// file's own embedded tag.
#[tauri::command]
pub fn local_read_lyrics(path: String) -> LocalLyrics {
    let audio = Path::new(&path);

    let text = sidecar_lrc_path(audio)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .or_else(|| embedded_lyrics(audio));

    let Some(text) = text else {
        return LocalLyrics::default();
    };

    let lines = parse_lrc(&text);
    if lines.is_empty() {
        let trimmed = text.trim();
        return LocalLyrics {
            lines,
            plain: (!trimmed.is_empty()).then(|| trimmed.to_string()),
        };
    }
    LocalLyrics { lines, plain: None }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_timestamp_forms() {
        assert_eq!(parse_timestamp("00:00.00"), Some(0));
        assert_eq!(parse_timestamp("01:30"), Some(90_000));
        assert_eq!(parse_timestamp("01:30.5"), Some(90_500));
        assert_eq!(parse_timestamp("01:30.50"), Some(90_500));
        assert_eq!(parse_timestamp("01:30.500"), Some(90_500));
        // The older colon-separated hundredths form.
        assert_eq!(parse_timestamp("01:30:50"), Some(90_500));
    }

    /// A set or an audiobook chapter can legitimately run past an hour.
    #[test]
    fn minutes_may_exceed_an_hour() {
        assert_eq!(parse_timestamp("73:20.50"), Some(73 * 60_000 + 20_500));
    }

    #[test]
    fn rejects_nonsense_timestamps() {
        assert_eq!(parse_timestamp("ar:Some Artist"), None);
        assert_eq!(parse_timestamp("01:99"), None, "seconds must be < 60");
        assert_eq!(parse_timestamp("nope"), None);
        assert_eq!(parse_timestamp(""), None);
    }

    #[test]
    fn parses_a_simple_lrc() {
        let lrc = "[00:12.00]First line\n[00:15.30]Second line\n";
        assert_eq!(
            parse_lrc(lrc),
            vec![
                LyricLine { start_ms: 12_000, text: "First line".into() },
                LyricLine { start_ms: 15_300, text: "Second line".into() },
            ]
        );
    }

    #[test]
    fn metadata_tags_are_skipped() {
        let lrc = "[ar:Artist]\n[ti:Title]\n[by:Someone]\n[00:05.00]Only real line\n";
        assert_eq!(
            parse_lrc(lrc),
            vec![LyricLine { start_ms: 5_000, text: "Only real line".into() }]
        );
    }

    /// One text, several times — how a chorus avoids being written out twice.
    #[test]
    fn a_line_can_carry_several_timestamps() {
        let lrc = "[00:10.00][01:20.00]Chorus\n";
        assert_eq!(
            parse_lrc(lrc),
            vec![
                LyricLine { start_ms: 10_000, text: "Chorus".into() },
                LyricLine { start_ms: 80_000, text: "Chorus".into() },
            ]
        );
    }

    #[test]
    fn lines_come_back_sorted() {
        let lrc = "[00:30.00]Later\n[00:10.00]Earlier\n";
        let parsed = parse_lrc(lrc);
        assert_eq!(parsed[0].text, "Earlier");
        assert_eq!(parsed[1].text, "Later");
    }

    /// An empty timed line is an instrumental gap, and has to survive parsing
    /// so the highlight can move off the previous line instead of sticking.
    #[test]
    fn empty_timed_lines_are_kept() {
        let lrc = "[00:10.00]Singing\n[00:14.00]\n[00:20.00]More singing\n";
        let parsed = parse_lrc(lrc);
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[1].text, "");
    }

    #[test]
    fn offset_shifts_timestamps_earlier() {
        let lrc = "[offset:+500]\n[00:10.00]Line\n";
        assert_eq!(parse_lrc(lrc)[0].start_ms, 9_500);

        let negative = "[offset:-500]\n[00:10.00]Line\n";
        assert_eq!(parse_lrc(negative)[0].start_ms, 10_500);
    }

    #[test]
    fn offset_never_pushes_a_line_negative() {
        let lrc = "[offset:+5000]\n[00:01.00]Line\n";
        assert_eq!(parse_lrc(lrc)[0].start_ms, 0);
    }

    /// Plain text must come back as "not synced" rather than as garbage lines,
    /// since that is what selects the unsynced rendering path.
    #[test]
    fn plain_text_yields_no_timed_lines() {
        assert!(parse_lrc("Just some lyrics\nwith no timings\n").is_empty());
        assert!(parse_lrc("").is_empty());
    }

    #[test]
    fn whitespace_around_text_is_trimmed() {
        let parsed = parse_lrc("[00:01.00]   padded text   \n");
        assert_eq!(parsed[0].text, "padded text");
    }

    #[test]
    fn a_missing_file_yields_nothing_rather_than_an_error() {
        let result = local_read_lyrics("Z:/definitely/not/here.flac".to_string());
        assert_eq!(result, LocalLyrics::default());
    }
}
