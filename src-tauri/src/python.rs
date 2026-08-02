//! Provisioning for the Python the sidecar runs on.
//!
//! The helper in `sidecar/main.py` needs an interpreter *and* the packages in
//! `sidecar/requirements.txt`. A fresh machine has neither, and until this
//! module existed the only symptom was sign-in failing with a message telling
//! the user to go and run pip themselves — which is not something a person who
//! installed a music player signed up for.
//!
//! So the two missing pieces are handled here, in the order they can be:
//!
//! 1. No interpreter — nothing we can do from inside the app except send the
//!    user somewhere trustworthy. On Windows that's the Microsoft Store listing
//!    for the Python Install Manager, which needs no admin rights and puts
//!    `python` on PATH; elsewhere, python.org.
//! 2. An interpreter but no packages — that we *can* do, by running pip
//!    ourselves against the bundled requirements file.
//!
//! Everything reports through [`PythonStatus`], which is deliberately the same
//! shape whether it came from a startup check or a post-install re-check.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Interpreter names to try, in order.
///
/// macOS and most Linux distros ship only `python3` — a bare `python` either
/// doesn't exist or (on Windows) may be the Microsoft Store shim that exits
/// immediately. Trying several keeps one build working everywhere; the probe
/// below is what tells a real interpreter from a shim, since the shim spawns
/// perfectly happily and only then gives up.
#[cfg(windows)]
const PATH_CANDIDATES: &[&str] = &["python", "python3", "py"];
#[cfg(not(windows))]
const PATH_CANDIDATES: &[&str] = &["python3", "python"];

/// `CREATE_NO_WINDOW` — see the same constant in `sidecar.rs`. pip is chattier
/// than the sidecar and would otherwise flash a console window per command.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// ytmusicapi and yt-dlp both require 3.9; below that, installing the packages
/// would only fail later and less clearly.
const MIN_MINOR: u32 = 9;

/// Generous because the first run of a freshly installed Python pays for
/// bytecode compilation, and the Windows Install Manager's shim may download a
/// runtime on demand the first time it is invoked.
const PROBE_TIMEOUT: Duration = Duration::from_secs(120);

/// pip on a slow connection, from cold, installing yt-dlp. Not a limit anyone
/// should hit — it exists so a wedged download can't hang the wizard forever.
const INSTALL_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// Where the install log is streamed, a line at a time, for the setup UI.
const LOG_EVENT: &str = "python-setup:log";

/// How much of a failed command's output to keep for the error message.
const TAIL_LINES: usize = 40;

/// The Microsoft Store listing for the Python Install Manager (`py`), which is
/// what python.org itself recommends on Windows: it installs per-user, needs no
/// administrator, and registers the `python` and `py` commands.
#[cfg(windows)]
const STORE_PRODUCT_ID: &str = "9NQ7512CXL7T";

/// Asks an interpreter everything we need to know in one round trip: whether it
/// runs at all, how old it is, and which of the helper's imports fail.
///
/// The imports are attempted for real rather than looked up, because a package
/// that is present but broken (a partial install, a wheel for the wrong ABI) is
/// exactly the case that would otherwise pass here and then kill the sidecar.
const PROBE: &str = r#"
import importlib, json, sys
missing = []
for name in ("ytmusicapi", "yt_dlp", "requests"):
    try:
        importlib.import_module(name)
    except Exception:
        missing.append(name)
print(json.dumps({
    "version": "%d.%d.%d" % sys.version_info[:3],
    "major": sys.version_info[0],
    "minor": sys.version_info[1],
    "missing": missing,
    "executable": sys.executable or "",
}))
"#;

/// What one interpreter reported.
#[derive(Deserialize)]
struct Probe {
    version: String,
    major: u32,
    minor: u32,
    missing: Vec<String>,
}

impl Probe {
    fn is_supported(&self) -> bool {
        self.major > 3 || (self.major == 3 && self.minor >= MIN_MINOR)
    }
}

/// The state of the machine's Python, as the UI needs to present it.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PythonStatus {
    /// The interpreter the sidecar will use, once there is a usable one. Also
    /// set when packages are missing — that's the one they'd be installed into.
    pub interpreter: Option<String>,
    pub version: Option<String>,
    /// Imports that failed. Empty when [`Self::interpreter`] is `None`, since
    /// nothing could be asked.
    pub missing: Vec<String>,
    /// True only when the sidecar can actually run: interpreter plus packages.
    pub ready: bool,
    /// Whether the missing piece is something [`python_install_packages`] can
    /// fix. False when there is no interpreter to install into.
    pub can_install: bool,
    /// One human-readable line about what's wrong. `None` when ready.
    pub detail: Option<String>,
}

/// The requirements as of build time, compiled into the binary.
///
/// The same file also ships as a Tauri resource, which is what pip is normally
/// pointed at. This copy is the guarantee: an install that is missing the
/// resource — a partial extraction, an antivirus quarantine, a `cargo run` from
/// a tree where the path resolution lands somewhere else — can still be
/// repaired, because the one thing pip actually needs is three lines of text.
const EMBEDDED_REQUIREMENTS: &str = include_str!("../../sidecar/requirements.txt");

/// Managed state: where the requirements file lives, plus a guard so two
/// installs can't run at once.
pub struct PythonSetup {
    /// The shipped resource. Not assumed to exist — see [`EMBEDDED_REQUIREMENTS`].
    requirements: PathBuf,
    /// Somewhere writable to reconstruct it if it doesn't.
    data_dir: PathBuf,
    installing: AtomicBool,
}

impl PythonSetup {
    pub fn new(resource_dir: Option<&Path>, data_dir: PathBuf) -> Self {
        Self {
            requirements: sidecar_file(resource_dir, "requirements.txt"),
            data_dir,
            installing: AtomicBool::new(false),
        }
    }

    /// A requirements file that exists, whatever state the install is in.
    fn requirements(&self) -> Result<PathBuf, String> {
        if self.requirements.is_file() {
            return Ok(self.requirements.clone());
        }
        let path = self.data_dir.join("requirements.txt");
        std::fs::create_dir_all(&self.data_dir)
            .and_then(|()| std::fs::write(&path, EMBEDDED_REQUIREMENTS))
            .map_err(|e| {
                format!(
                    "the requirements file is missing ({}) and a replacement couldn't be \
                     written to {} ({e}).",
                    self.requirements.display(),
                    self.data_dir.display()
                )
            })?;
        Ok(path)
    }
}

/// Locates a file from the `sidecar/` directory.
///
/// In a bundled app it ships as a Tauri resource; in development it sits next
/// to the crate. `CARGO_MANIFEST_DIR` alone is a build-machine path, so relying
/// on it would break every installed copy.
pub fn sidecar_file(resource_dir: Option<&Path>, name: &str) -> PathBuf {
    if let Some(dir) = resource_dir {
        let bundled = dir.join("sidecar").join(name);
        if bundled.is_file() {
            return bundled;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("sidecar")
        .join(name)
}

/// Every interpreter worth trying, best first.
///
/// The PATH names come first because they're what a working machine resolves.
/// The absolute paths after them exist for one specific moment: the user has
/// just installed Python from the Store and come back to the app *without*
/// restarting it. PATH is inherited at process start, so a newly added entry is
/// invisible to us — but the install locations are well known, so the new
/// interpreter can still be found and the user spared a restart.
///
/// Shared with the sidecar supervisor on purpose: packages installed into the
/// interpreter chosen here must be the ones the sidecar later finds.
pub fn interpreter_candidates() -> Vec<String> {
    let mut candidates: Vec<String> = PATH_CANDIDATES.iter().map(|s| (*s).to_string()).collect();
    for path in install_locations() {
        if path.is_file() {
            candidates.push(path.to_string_lossy().into_owned());
        }
    }
    candidates
}

#[cfg(windows)]
fn install_locations() -> Vec<PathBuf> {
    let Ok(local) = std::env::var("LOCALAPPDATA") else {
        return Vec::new();
    };
    let local = PathBuf::from(local);
    // The Store package installs its app-execution aliases under WindowsApps;
    // the Install Manager then puts the per-runtime shims in its own bin
    // directory and adds that to the user's PATH. Both are per-user, and both
    // are verified against the machine before being offered as candidates.
    let store_aliases = local.join("Microsoft").join("WindowsApps");
    let manager_bin = local.join("Python").join("bin");
    vec![
        store_aliases.join("python.exe"),
        store_aliases.join("py.exe"),
        manager_bin.join("python.exe"),
    ]
}

#[cfg(not(windows))]
fn install_locations() -> Vec<PathBuf> {
    vec![
        PathBuf::from("/usr/local/bin/python3"),
        PathBuf::from("/opt/homebrew/bin/python3"),
    ]
}

/// Builds an invocation with the same environment the sidecar gets, so what we
/// probe is what will actually run.
fn base_command(exe: &str) -> Command {
    let mut command = Command::new(exe);
    command
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUNBUFFERED", "1")
        .kill_on_drop(true);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    command
}

/// Runs [`PROBE`] against one interpreter.
async fn probe(exe: &str) -> Result<Probe, String> {
    let output = tokio::time::timeout(
        PROBE_TIMEOUT,
        base_command(exe)
            .arg("-c")
            .arg(PROBE)
            .stdin(Stdio::null())
            .output(),
    )
    .await
    .map_err(|_| "it didn't respond".to_string())?
    .map_err(|e| format!("couldn't launch it ({e})"))?;

    if !output.status.success() {
        // The Windows Store stub lands here: it spawns fine, prints its "Python
        // was not found" notice and exits non-zero.
        return Err(last_line(&output.stderr).unwrap_or_else(|| "it exited with an error".into()));
    }

    // A site hook or a deprecation warning can print ahead of us, so the JSON is
    // the last line rather than the whole of stdout.
    let line = last_line(&output.stdout).ok_or("it printed nothing")?;
    serde_json::from_str(&line).map_err(|_| "it gave an unreadable answer".to_string())
}

fn last_line(bytes: &[u8]) -> Option<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .rfind(|l| !l.trim().is_empty())
        .map(|l| l.trim().to_string())
}

/// Probes every candidate and reports the best outcome.
///
/// A fully working interpreter wins outright. Failing that, the first one that
/// is merely missing packages is remembered, because that is the one pip should
/// install into — and, since the sidecar walks the same list in the same order,
/// the one it will pick up afterwards.
async fn detect() -> PythonStatus {
    let mut fixable: Option<(String, Probe)> = None;
    let mut outdated: Option<(String, Probe)> = None;

    for exe in interpreter_candidates() {
        let Ok(found) = probe(&exe).await else { continue };

        if !found.is_supported() {
            outdated.get_or_insert((exe, found));
            continue;
        }
        if found.missing.is_empty() {
            return PythonStatus {
                interpreter: Some(exe),
                version: Some(found.version),
                missing: Vec::new(),
                ready: true,
                can_install: false,
                detail: None,
            };
        }
        fixable.get_or_insert((exe, found));
    }

    if let Some((exe, found)) = fixable {
        return PythonStatus {
            detail: Some(format!(
                "Python {} is installed, but the helper's packages are missing ({}).",
                found.version,
                found.missing.join(", ")
            )),
            interpreter: Some(exe),
            version: Some(found.version),
            missing: found.missing,
            ready: false,
            can_install: true,
        };
    }

    if let Some((_, found)) = outdated {
        return PythonStatus {
            detail: Some(format!(
                "Python {} is too old — Melodia needs 3.{MIN_MINOR} or newer.",
                found.version
            )),
            ..PythonStatus::default()
        };
    }

    PythonStatus {
        detail: Some("Python isn't installed, or isn't on this account's PATH.".into()),
        ..PythonStatus::default()
    }
}

/// Reports whether the Python side of the app is ready to run.
#[tauri::command]
pub async fn python_status() -> Result<PythonStatus, String> {
    Ok(detect().await)
}

/// Opens the recommended Python installer for this platform.
///
/// Windows gets the Store listing — no administrator rights, and it registers
/// the `python` command — with the web listing as a fallback for machines where
/// the Store app itself won't open. Everywhere else, python.org.
#[tauri::command]
pub async fn python_open_installer() -> Result<(), String> {
    #[cfg(windows)]
    let urls = [
        format!("ms-windows-store://pdp/?productid={STORE_PRODUCT_ID}"),
        format!("https://apps.microsoft.com/detail/{STORE_PRODUCT_ID}"),
    ];
    #[cfg(not(windows))]
    let urls = ["https://www.python.org/downloads/".to_string()];

    let mut last = String::new();
    for url in urls {
        match tauri_plugin_opener::open_url(url, None::<&str>) {
            Ok(()) => return Ok(()),
            Err(e) => last = e.to_string(),
        }
    }
    Err(format!("couldn't open the installer page ({last})"))
}

/// Installs `sidecar/requirements.txt` into the detected interpreter.
///
/// Always runs pip, even when the packages already look present — this is the
/// button a user reaches for when something is wrong that the check can't see,
/// and refusing to do anything would leave them nowhere to go. pip itself is
/// idempotent, so the cost of a needless run is a few "already satisfied" lines.
///
/// Streams pip's output to the frontend as [`LOG_EVENT`] so a multi-minute
/// download looks like progress rather than a hang, and returns the re-checked
/// status so the caller never has to guess whether it worked.
#[tauri::command]
pub async fn python_install_packages(
    app: AppHandle,
    setup: State<'_, PythonSetup>,
) -> Result<PythonStatus, String> {
    // Not a lock: a second install would fight the first over the same files,
    // so the right answer is to refuse, not to queue.
    if setup.installing.swap(true, Ordering::SeqCst) {
        return Err("an install is already running.".into());
    }
    let result = match setup.requirements() {
        Ok(requirements) => install(&app, &requirements).await,
        Err(e) => Err(e),
    };
    setup.installing.store(false, Ordering::SeqCst);
    result
}

async fn install(app: &AppHandle, requirements: &Path) -> Result<PythonStatus, String> {
    let exe = detect()
        .await
        .interpreter
        .ok_or("no usable Python was found to install into.")?;

    let requirements = requirements.to_string_lossy().into_owned();
    log(app, &format!("Using {exe}"));

    // Some Linux distributions split pip out of the standard library, and a
    // Python built without it can't install anything. ensurepip is the
    // supported way back, and is a no-op when pip is already there.
    if run(app, &exe, &["-m", "pip", "--version"]).await.is_err() {
        log(app, "pip is missing — bootstrapping it with ensurepip…");
        run(app, &exe, &["-m", "ensurepip", "--upgrade"]).await?;
    }

    let args = vec![
        "-m",
        "pip",
        "install",
        "--upgrade",
        "--disable-pip-version-check",
        "--no-input",
        "--no-warn-script-location",
        "-r",
        &requirements,
    ];

    if let Err(system_error) = run(app, &exe, &args).await {
        // A system-wide interpreter (Program Files, /usr/lib) refuses to be
        // written to without elevation, which we deliberately don't ask for.
        // A per-user install needs no privileges and is still on the import
        // path for the sidecar, so it's the natural second attempt.
        log(app, "That failed — retrying as a per-user install…");
        let mut user_args = args.clone();
        user_args.push("--user");
        run(app, &exe, &user_args)
            .await
            .map_err(|user_error| format!("{system_error}\n\nRetried per-user: {user_error}"))?;
    }

    log(app, "Checking the install…");
    let status = detect().await;
    if status.ready {
        log(app, "Done — the Python helper is ready.");
        return Ok(status);
    }

    Err(status.detail.unwrap_or_else(|| {
        "pip finished, but the helper's packages still aren't importable.".into()
    }))
}

fn log(app: &AppHandle, line: &str) {
    let _ = app.emit(LOG_EVENT, line);
}

/// Runs one command to completion, streaming its output to the UI.
///
/// On failure the error carries the tail of that output: pip's actual complaint
/// (no network, a wheel that won't build) is the only thing that makes a failed
/// install diagnosable, and it is never on the last line alone.
async fn run(app: &AppHandle, exe: &str, args: &[&str]) -> Result<(), String> {
    log(app, &format!("$ {exe} {}", args.join(" ")));

    let mut child = base_command(exe)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("couldn't run {exe} ({e})"))?;

    // Both streams are drained concurrently: pip writes progress to stdout and
    // warnings to stderr, and a full pipe on either one blocks the process.
    let out = child.stdout.take().map(|s| pump(app.clone(), s));
    let err = child.stderr.take().map(|s| pump(app.clone(), s));
    let out = out.map(tauri::async_runtime::spawn);
    let err = err.map(tauri::async_runtime::spawn);

    let status = tokio::time::timeout(INSTALL_TIMEOUT, child.wait())
        .await
        .map_err(|_| format!("{exe} took too long and was stopped."))?
        .map_err(|e| format!("{exe} couldn't be waited on ({e})"))?;

    let mut tail = Vec::new();
    for handle in [out, err].into_iter().flatten() {
        tail.extend(handle.await.unwrap_or_default());
    }

    if status.success() {
        return Ok(());
    }
    let detail = tail.join("\n");
    Err(if detail.is_empty() {
        format!("{exe} failed ({status}).")
    } else {
        detail
    })
}

/// Forwards one stream line by line, keeping the tail for error reporting.
async fn pump<R>(app: AppHandle, reader: R) -> Vec<String>
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let mut lines = BufReader::new(reader).lines();
    let mut tail: Vec<String> = Vec::new();
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim_end().to_string();
        if line.is_empty() {
            continue;
        }
        let _ = app.emit(LOG_EVENT, &line);
        if tail.len() == TAIL_LINES {
            tail.remove(0);
        }
        tail.push(line);
    }
    tail
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidates_start_with_the_path_names() {
        let candidates = interpreter_candidates();
        for (i, name) in PATH_CANDIDATES.iter().enumerate() {
            assert_eq!(&candidates[i], name);
        }
    }

    /// The compiled-in copy is only useful if it is the real thing.
    #[test]
    fn embedded_requirements_match_the_shipped_file() {
        let shipped = sidecar_file(None, "requirements.txt");
        let shipped = std::fs::read_to_string(&shipped)
            .unwrap_or_else(|e| panic!("{}: {e}", shipped.display()));
        assert_eq!(shipped, EMBEDDED_REQUIREMENTS);
        assert!(EMBEDDED_REQUIREMENTS.contains("ytmusicapi"));
    }

    /// An install that shipped without the resource must still be repairable.
    #[test]
    fn requirements_are_rebuilt_when_the_resource_is_missing() {
        let data_dir = std::env::temp_dir().join("melodia-requirements-test");
        let _ = std::fs::remove_dir_all(&data_dir);
        let setup = PythonSetup {
            requirements: data_dir.join("does-not-exist.txt"),
            data_dir: data_dir.clone(),
            installing: AtomicBool::new(false),
        };

        let path = setup.requirements().unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            EMBEDDED_REQUIREMENTS
        );

        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[test]
    fn last_line_ignores_trailing_noise() {
        assert_eq!(last_line(b"warning\n{\"a\":1}\n\n").unwrap(), "{\"a\":1}");
        assert_eq!(last_line(b"   \n"), None);
    }

    /// End-to-end on a workstation that is already set up: `cargo test --
    /// --ignored`. A failure here is the same thing the setup step would show
    /// the user, so it's the quickest way to check a machine that reports
    /// helper trouble.
    #[test]
    #[ignore = "requires Python 3 with the sidecar's packages installed"]
    fn detects_a_ready_python() {
        tauri::async_runtime::block_on(async {
            let status = detect().await;
            assert!(status.ready, "{:?}", status.detail);
            assert!(status.interpreter.is_some());
        });
    }

    /// The probe has to survive being handed to a real interpreter — a syntax
    /// error in it would otherwise look exactly like "Python isn't installed".
    #[test]
    #[ignore = "requires a Python 3 on PATH"]
    fn probe_answers_from_a_real_interpreter() {
        tauri::async_runtime::block_on(async {
            let mut errors = Vec::new();
            for exe in interpreter_candidates() {
                match probe(&exe).await {
                    Ok(found) => {
                        assert_eq!(found.major, 3, "{}", found.version);
                        return;
                    }
                    Err(e) => errors.push(format!("{exe}: {e}")),
                }
            }
            panic!("no interpreter answered the probe: {}", errors.join("; "));
        });
    }
}
