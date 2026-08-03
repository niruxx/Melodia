//! Tells the app when a newer Melodia has been published.
//!
//! Notification only: nothing is downloaded, verified or installed here. That
//! is a deliberate first step — an in-app installer needs a signing keypair
//! whose loss permanently strands every existing install, and this gets users
//! off an old build today without that commitment. The shape of the data it
//! returns is the same one a real updater would need, so adopting one later
//! replaces this module rather than the UI around it.
//!
//! Reaching GitHub from Rust rather than the webview is what keeps the request
//! honest: an explicit User-Agent (which the API requires), a timeout, and no
//! opinion from the webview's fetch stack about cross-origin requests.

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// The published-releases endpoint. Drafts and pre-releases are excluded by
/// GitHub itself for `/latest`, so an unfinished release can't be announced.
const LATEST_RELEASE_URL: &str = "https://api.github.com/repos/niruxx/Melodia/releases/latest";

/// GitHub rejects requests without one.
const USER_AGENT: &str = concat!("Melodia/", env!("CARGO_PKG_VERSION"));

/// Long enough for a slow connection, short enough that a launch-time check
/// can't leave anything hanging around.
const TIMEOUT: Duration = Duration::from_secs(15);

/// Release notes are shown in a scrollable panel, but a runaway body still
/// isn't worth holding in memory or sending across the bridge.
const MAX_NOTES_BYTES: usize = 32 * 1024;

/// Only the fields we use. Anything GitHub adds or renames elsewhere in the
/// payload is ignored rather than breaking the parse.
#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

/// What the UI needs to describe a release, whether or not it's newer.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    /// Normalised: no `v` prefix, so it compares with the app's own version.
    pub version: String,
    /// The version this was compared against.
    pub current_version: String,
    /// The release's title, falling back to its tag.
    pub name: String,
    /// Markdown, as written on the release. Rendered as plain text.
    pub notes: String,
    /// The release page, used when there's no installer to point at.
    pub url: String,
    /// The installer for *this* platform, when the release has one.
    pub download_url: Option<String>,
    pub published_at: Option<String>,
    /// The whole point: whether this is worth telling the user about.
    pub is_newer: bool,
}

/// Looks up the latest published release.
///
/// Errors are the caller's to swallow quietly on a launch-time check — a
/// machine that is offline, behind a proxy, or rate-limited is not having a
/// problem the user needs to hear about unless they asked.
#[tauri::command]
pub async fn check_for_update() -> Result<ReleaseInfo, String> {
    let response = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("couldn't prepare the update check ({e})"))?
        .get(LATEST_RELEASE_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("couldn't reach GitHub ({e})"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            // Unauthenticated requests share an hourly quota per IP.
            403 | 429 => "GitHub is rate-limiting update checks. Try again later.".to_string(),
            404 => "no releases have been published yet.".to_string(),
            other => format!("GitHub answered {other}."),
        });
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("couldn't read GitHub's answer ({e})"))?;
    let release: GithubRelease =
        serde_json::from_str(&body).map_err(|e| format!("couldn't parse GitHub's answer ({e})"))?;

    Ok(describe(release, env!("CARGO_PKG_VERSION")))
}

/// Turns a release into what the UI shows. Split out so the comparison and the
/// asset choice can be tested without a network.
fn describe(release: GithubRelease, current: &str) -> ReleaseInfo {
    let version = normalise(&release.tag_name);
    let mut notes = release.body.unwrap_or_default();
    if notes.len() > MAX_NOTES_BYTES {
        // On a char boundary, or the string can't be truncated at all.
        let cut = (0..=MAX_NOTES_BYTES)
            .rev()
            .find(|i| notes.is_char_boundary(*i))
            .unwrap_or(0);
        notes.truncate(cut);
        notes.push_str("\n\n…");
    }

    ReleaseInfo {
        is_newer: is_newer(&version, current),
        download_url: installer_for_this_platform(&release.assets),
        name: release.name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| release.tag_name.clone()),
        version,
        current_version: current.to_string(),
        notes,
        url: release.html_url,
        published_at: release.published_at,
    }
}

/// Picks the asset a user on this platform should actually download.
///
/// Windows is MSI-only on purpose: an MSI installs over the previous version
/// in place (the bundler emits `<MajorUpgrade>` against a pinned upgrade code),
/// whereas mixing installer formats leaves two entries in Add/Remove Programs.
fn installer_for_this_platform(assets: &[GithubAsset]) -> Option<String> {
    #[cfg(windows)]
    const EXTENSION: &str = ".msi";
    #[cfg(target_os = "macos")]
    const EXTENSION: &str = ".dmg";
    #[cfg(all(unix, not(target_os = "macos")))]
    const EXTENSION: &str = ".appimage";

    assets
        .iter()
        .find(|a| a.name.to_ascii_lowercase().ends_with(EXTENSION))
        .map(|a| a.browser_download_url.clone())
}

/// Strips the `v` a tag may carry; `v0.6.0` and `0.6.0` are the same release.
fn normalise(tag: &str) -> String {
    tag.trim()
        .strip_prefix(['v', 'V'])
        .unwrap_or(tag.trim())
        .to_string()
}

/// Compares MAJOR.MINOR.PATCH numerically.
///
/// Deliberately not a full semver implementation: the versions being compared
/// are Melodia's own, and the MSI bundler already refuses anything but numeric
/// cores. A pre-release suffix (`0.6.0-1`) is ignored rather than ranked, so a
/// pre-release never announces itself as newer than the release it precedes —
/// the safer way round for something that only ever nags.
fn is_newer(candidate: &str, current: &str) -> bool {
    match (parse(candidate), parse(current)) {
        (Some(candidate), Some(current)) => candidate > current,
        // An unparseable tag is not an update. Announcing one on a version we
        // can't reason about is how users get sent backwards.
        _ => false,
    }
}

fn parse(version: &str) -> Option<(u64, u64, u64)> {
    // Tolerates a `v` here as well as in `normalise`, so a caller that passes a
    // raw tag straight in still compares correctly.
    let version = version.trim();
    let version = version.strip_prefix(['v', 'V']).unwrap_or(version);
    let core = version.split(['-', '+']).next()?;
    let mut parts = core.split('.').map(|p| p.trim().parse::<u64>());
    let major = parts.next()?.ok()?;
    // Absent components are zero: `1` and `1.0.0` are the same release.
    let minor = parts.next().transpose().ok()?.unwrap_or(0);
    let patch = parts.next().transpose().ok()?.unwrap_or(0);
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_versions_are_recognised() {
        assert!(is_newer("0.6.0", "0.5.0"));
        assert!(is_newer("v0.5.1", "0.5.0"));
        assert!(is_newer("1.0.0", "0.99.99"));
        assert!(is_newer("0.5.10", "0.5.9"), "not a string comparison");
    }

    #[test]
    fn same_or_older_versions_are_not() {
        assert!(!is_newer("0.5.0", "0.5.0"));
        assert!(!is_newer("0.4.9", "0.5.0"));
        assert!(!is_newer("0.5", "0.5.0"));
    }

    /// A tag that isn't a version must never look like an update.
    #[test]
    fn unparseable_tags_are_ignored() {
        for tag in ["public", "latest", "", "0.5.0.1", "nightly-2026-08-02"] {
            assert!(!is_newer(&normalise(tag), "0.5.0"), "{tag}");
        }
    }

    /// A pre-release ranks as its core version, so it can't jump ahead of the
    /// release it precedes.
    #[test]
    fn pre_release_suffixes_rank_as_the_core_version() {
        assert!(!is_newer("0.5.0-1", "0.5.0"));
        assert!(is_newer("0.6.0-1", "0.5.0"));
    }

    fn release(tag: &str, assets: &[&str]) -> GithubRelease {
        GithubRelease {
            tag_name: tag.to_string(),
            name: None,
            body: Some("notes".into()),
            html_url: "https://example.invalid/release".into(),
            published_at: None,
            assets: assets
                .iter()
                .map(|name| GithubAsset {
                    name: (*name).to_string(),
                    browser_download_url: format!("https://example.invalid/{name}"),
                })
                .collect(),
        }
    }

    #[test]
    fn the_platform_installer_is_chosen_over_other_assets() {
        let info = describe(
            release(
                "v0.6.0",
                &[
                    "Melodia_0.6.0_x64_en-US.msi",
                    "Melodia_0.6.0_x64-setup.exe",
                    "Melodia_0.6.0_aarch64.dmg",
                    "melodia_0.6.0_amd64.AppImage",
                ],
            ),
            "0.5.0",
        );

        assert!(info.is_newer);
        assert_eq!(info.version, "0.6.0");
        // Falls back to the tag when the release has no title of its own.
        assert_eq!(info.name, "v0.6.0");

        let chosen = info.download_url.expect("an installer for this platform");
        #[cfg(windows)]
        assert!(chosen.ends_with(".msi"), "{chosen}");
        #[cfg(target_os = "macos")]
        assert!(chosen.ends_with(".dmg"), "{chosen}");
        #[cfg(all(unix, not(target_os = "macos")))]
        assert!(chosen.ends_with(".AppImage"), "{chosen}");
    }

    /// A release with only source archives still has a page worth opening.
    #[test]
    fn a_release_without_installers_has_no_download() {
        let info = describe(release("0.6.0", &["Source code.zip"]), "0.5.0");
        assert!(info.download_url.is_none());
        assert_eq!(info.url, "https://example.invalid/release");
    }

    /// Against the real endpoint: `cargo test -- --ignored`. Catches the things
    /// unit tests can't — a renamed field, the User-Agent requirement, a repo
    /// with no published release — without waiting for a user to hit them.
    #[test]
    #[ignore = "requires network access to api.github.com"]
    fn the_real_endpoint_answers() {
        tauri::async_runtime::block_on(async {
            let info = check_for_update().await.expect("GitHub should answer");
            assert!(parse(&info.version).is_some(), "{}", info.version);
            assert_eq!(info.current_version, env!("CARGO_PKG_VERSION"));
            assert!(info.url.starts_with("https://github.com/"), "{}", info.url);
            println!(
                "latest={} current={} newer={} download={:?}",
                info.version, info.current_version, info.is_newer, info.download_url
            );
        });
    }

    #[test]
    fn oversized_notes_are_truncated_on_a_char_boundary() {
        let mut long = release("0.6.0", &[]);
        long.body = Some("é".repeat(MAX_NOTES_BYTES));
        let info = describe(long, "0.5.0");
        assert!(info.notes.len() <= MAX_NOTES_BYTES + 8);
        assert!(info.notes.ends_with('…'));
    }
}
