use serde_json::Value;
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;

/// Backstop for a sidecar that is alive but wedged. The sidecar imposes its own
/// (much shorter) per-request timeout, and commands queue behind one another
/// there, so this is deliberately generous: it exists so a call can never hang
/// forever, not to bound normal latency.
const CALL_TIMEOUT: Duration = Duration::from_secs(180);

/// How long a freshly spawned interpreter gets to answer `ping`. An interpreter
/// that is simply *wrong* (the Microsoft Store stub, a missing package) exits
/// straight away and is detected the moment its stdout closes, so this only
/// bounds the pathological case of one that starts but never replies.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(20);

/// After a failed spawn, don't try again until this has passed. Without it a
/// machine with no working Python would re-probe every interpreter on every
/// call the UI makes.
const RESPAWN_COOLDOWN: Duration = Duration::from_secs(3);

/// Corrupt output costs us the line, not the process — but a genuinely broken
/// pipe must not spin. Consecutive read errors past this end the reader.
const MAX_READER_ERRORS: u32 = 8;

/// Kept small enough to stay diagnosable; truncated at spawn once it exceeds this.
const MAX_LOG_BYTES: u64 = 1 << 20;

/// Only reported after a restart *and* a retry have both failed.
///
/// Points at the setup step rather than a pip command: it diagnoses this exact
/// situation and can usually fix it without the user leaving the app.
const DEAD_SIDECAR_MSG: &str = "the Python helper stopped and couldn't be restarted. Open \
     Settings and choose \"Check the music service helper\".";

/// Commands that change something on the user's account. If the helper dies
/// after such a request reached it, we can't know whether YouTube applied it,
/// so the automatic retry is skipped rather than risk doing it twice.
const MUTATIONS: &[&str] = &[
    "create_playlist",
    "edit_playlist",
    "delete_playlist",
    "add_playlist_items",
    "remove_playlist_items",
    "move_playlist_item",
];

const MUTATION_INTERRUPTED_MSG: &str =
    "the Python helper restarted while that change was in flight, so it may not have been \
     applied. Refresh and try again.";

/// `CREATE_NO_WINDOW`. `python.exe` is a console-subsystem binary, so Windows
/// hands it a console of its own — which shows up as a stray cmd window
/// alongside the app. The sidecar only ever talks over piped stdio, so it has
/// no use for one.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// One running helper process.
///
/// Deliberately separate from [`Sidecar`]: the supervisor outlives any number
/// of these, and replacing a dead one is just swapping the value in a slot.
struct Proc {
    stdin: Mutex<ChildStdin>,
    pending: PendingMap,
    /// Cleared when the process exits or is retired. Every waiter is woken.
    alive: Arc<AtomicBool>,
    child: Arc<Mutex<Child>>,
}

impl Proc {
    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    /// Marks the process unusable and makes sure it is actually gone. Safe to
    /// call twice — a retired `Proc` is never revived, only replaced.
    async fn retire(&self) {
        self.alive.store(false, Ordering::SeqCst);
        let _ = self.child.lock().await.start_kill();
        // Dropping the senders wakes every waiting caller with an error —
        // without this they would await a response forever, which surfaces in
        // the UI as a spinner that never resolves.
        self.pending.lock().await.clear();
    }
}

/// Why a single attempt at a request failed, as far as the supervisor cares.
enum Failure {
    /// The helper is gone. `sent` records whether the request reached it, which
    /// decides if retrying is safe for a mutating command.
    Dead { sent: bool },
    Wedged,
}

/// Supervises the long-lived Python sidecar process wrapping ytmusicapi and
/// correlates line-delimited JSON requests/responses over its stdio.
///
/// The process is started lazily and restarted on demand, so neither a missing
/// Python at launch nor a helper that dies mid-session is terminal: the next
/// call brings a new one up, and installing Python fixes a broken machine
/// without restarting the app.
pub struct Sidecar {
    inner: Arc<Supervisor>,
}

struct Supervisor {
    script: PathBuf,
    data_dir: PathBuf,
    log_path: PathBuf,
    /// The interpreter that last worked, tried first on every respawn so a
    /// restart doesn't re-probe candidates that already failed.
    known_good: Mutex<Option<String>>,
    proc: Mutex<Option<Arc<Proc>>>,
    /// Reason and time of the last failed spawn, for [`RESPAWN_COOLDOWN`].
    cooldown: Mutex<Option<(Instant, String)>>,
    next_id: AtomicU64,
}

impl Sidecar {
    pub fn new(data_dir: PathBuf, resource_dir: Option<PathBuf>) -> Self {
        let log_path = data_dir.join("sidecar.log");
        Self {
            inner: Arc::new(Supervisor {
                script: crate::python::sidecar_file(resource_dir.as_deref(), "main.py"),
                data_dir,
                log_path,
                known_good: Mutex::new(None),
                proc: Mutex::new(None),
                cooldown: Mutex::new(None),
                next_id: AtomicU64::new(1),
            }),
        }
    }

    /// Starts the helper in the background so the first real call doesn't pay
    /// for the interpreter's startup. Failure is not reported: it will be, with
    /// a better message, on whichever call needs it first.
    pub fn warm(&self) {
        let inner = self.inner.clone();
        tauri::async_runtime::spawn(async move {
            let _ = inner.ensure().await;
        });
    }

    pub async fn call(&self, cmd: &str, args: Value) -> Result<Value, String> {
        self.inner.call(cmd, args).await
    }
}

impl Supervisor {
    async fn call(&self, cmd: &str, args: Value) -> Result<Value, String> {
        // Two attempts: the first may land on a process that has already died
        // without us having noticed yet, the second on a guaranteed-fresh one.
        for attempt in 0..2 {
            let proc = self.ensure().await?;
            let id = self.next_id.fetch_add(1, Ordering::SeqCst);

            match request(&proc, id, cmd, args.clone()).await {
                Ok(response) => return unwrap_response(response),
                Err(Failure::Wedged) => {
                    // Alive but not answering. Retiring it means the *next*
                    // call gets a clean process instead of queueing behind
                    // whatever is stuck.
                    self.retire(&proc).await;
                    return Err(format!(
                        "the music service didn't respond within {}s. Please try again.",
                        CALL_TIMEOUT.as_secs()
                    ));
                }
                Err(Failure::Dead { sent }) => {
                    self.retire(&proc).await;
                    if attempt == 1 {
                        return Err(DEAD_SIDECAR_MSG.to_string());
                    }
                    if sent && MUTATIONS.contains(&cmd) {
                        return Err(MUTATION_INTERRUPTED_MSG.to_string());
                    }
                }
            }
        }
        Err(DEAD_SIDECAR_MSG.to_string())
    }

    /// Returns a live helper, starting one if there isn't one.
    ///
    /// Holding the slot lock across the spawn is intentional: concurrent
    /// callers queue on it and all receive the same new process rather than
    /// racing to start several.
    async fn ensure(&self) -> Result<Arc<Proc>, String> {
        let mut slot = self.proc.lock().await;
        if let Some(proc) = slot.as_ref() {
            if proc.is_alive() {
                return Ok(proc.clone());
            }
        }

        {
            let cooldown = self.cooldown.lock().await;
            if let Some((at, err)) = cooldown.as_ref() {
                if at.elapsed() < RESPAWN_COOLDOWN {
                    return Err(err.clone());
                }
            }
        }

        match self.start().await {
            Ok(proc) => {
                *slot = Some(proc.clone());
                *self.cooldown.lock().await = None;
                Ok(proc)
            }
            Err(e) => {
                *slot = None;
                *self.cooldown.lock().await = Some((Instant::now(), e.clone()));
                Err(e)
            }
        }
    }

    /// Kills `proc` and clears it from the slot, unless it has already been
    /// replaced by a newer one.
    async fn retire(&self, proc: &Arc<Proc>) {
        proc.retire().await;
        let mut slot = self.proc.lock().await;
        if slot.as_ref().is_some_and(|current| Arc::ptr_eq(current, proc)) {
            *slot = None;
        }
    }

    /// Tries each interpreter until one starts *and* answers the handshake.
    async fn start(&self) -> Result<Arc<Proc>, String> {
        if !self.script.is_file() {
            return Err(format!(
                "the Python helper script is missing ({}). Reinstall Melodia.",
                self.script.display()
            ));
        }

        // The same list the setup flow probes and installs into, so an
        // interpreter provisioned there is one this can find.
        let mut candidates: Vec<String> = Vec::new();
        if let Some(good) = self.known_good.lock().await.clone() {
            candidates.push(good);
        }
        for name in crate::python::interpreter_candidates() {
            if !candidates.contains(&name) {
                candidates.push(name);
            }
        }

        let mut errors = Vec::new();
        for exe in candidates {
            match self.try_start(&exe).await {
                Ok(proc) => {
                    *self.known_good.lock().await = Some(exe);
                    return Ok(proc);
                }
                Err(e) => errors.push(format!("{exe}: {e}")),
            }
        }

        // The known-good interpreter is tried first, so it heads this list and
        // its reason is the one that matters most.
        Err(format!(
            "couldn't start the Python helper. {} (details in {})",
            errors.join("; "),
            self.log_path.display()
        ))
    }

    /// Spawns one interpreter and proves it can actually serve requests.
    async fn try_start(&self, exe: &str) -> Result<Arc<Proc>, String> {
        let mut child = self
            .command(exe)
            .spawn()
            .map_err(|e| format!("couldn't launch it ({e})"))?;

        let stdin = child.stdin.take().ok_or("stdin was not piped")?;
        let stdout = child.stdout.take().ok_or("stdout was not piped")?;

        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let alive = Arc::new(AtomicBool::new(true));
        let child = Arc::new(Mutex::new(child));

        let proc = Arc::new(Proc {
            stdin: Mutex::new(stdin),
            pending: pending.clone(),
            alive: alive.clone(),
            child: child.clone(),
        });

        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            let mut errors = 0u32;
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        errors = 0;
                        let Ok(value) = serde_json::from_str::<Value>(&line) else {
                            continue; // not ours — ignore rather than give up
                        };
                        let Some(id) = value.get("id").and_then(Value::as_u64) else {
                            continue;
                        };
                        if let Some(tx) = pending.lock().await.remove(&id) {
                            let _ = tx.send(value);
                        }
                    }
                    // stdout closed: the process is gone.
                    Ok(None) => break,
                    // One unreadable line (bad UTF-8, a transient error) is not
                    // a reason to declare a healthy helper dead — that used to
                    // strand it as a live process nobody would talk to again.
                    Err(_) => {
                        errors += 1;
                        if errors >= MAX_READER_ERRORS {
                            break;
                        }
                    }
                }
            }

            alive.store(false, Ordering::SeqCst);
            let _ = child.lock().await.start_kill();
            pending.lock().await.clear();
        });

        match handshake(&proc).await {
            Ok(()) => Ok(proc),
            Err(e) => {
                proc.retire().await;
                Err(e)
            }
        }
    }

    /// Builds the interpreter invocation, consistently across every candidate.
    fn command(&self, exe: &str) -> Command {
        let mut command = Command::new(exe);
        command
            .arg(&self.script)
            .arg(&self.data_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // UTF-8 both ways, regardless of the machine's locale. Python
            // otherwise decodes stdin with the ANSI code page on Windows, and
            // the app sends raw UTF-8: a search or playlist title containing
            // non-Latin text or an emoji then killed the helper outright on any
            // workstation whose code page couldn't represent those bytes.
            .env("PYTHONUTF8", "1")
            .env("PYTHONIOENCODING", "utf-8")
            // So a traceback reaches the log before the process dies.
            .env("PYTHONUNBUFFERED", "1")
            .kill_on_drop(true);

        // A bundled app has no console, so inherited stderr goes nowhere and
        // startup failures are invisible. The log is the only account of why a
        // given workstation can't start the helper.
        match self.open_log(exe) {
            Some(file) => command.stderr(Stdio::from(file)),
            None => command.stderr(Stdio::inherit()),
        };

        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        command
    }

    fn open_log(&self, exe: &str) -> Option<std::fs::File> {
        let _ = std::fs::create_dir_all(&self.data_dir);
        // Appended to across restarts — the previous crash's traceback is
        // exactly what's worth keeping — but capped so it can't grow forever.
        if std::fs::metadata(&self.log_path).is_ok_and(|m| m.len() > MAX_LOG_BYTES) {
            let _ = std::fs::remove_file(&self.log_path);
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
            .ok()?;
        let stamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(file, "\n--- starting sidecar with `{exe}` (t={stamp}) ---");
        Some(file)
    }
}

/// Proves a freshly spawned interpreter is usable before anything is entrusted
/// to it.
///
/// Both failure modes this catches spawn successfully and so used to be
/// indistinguishable from a working helper: the Windows Store `python.exe`
/// shim, which exits at once, and an interpreter that lacks the sidecar's
/// packages. Reporting either as a candidate failure lets `start()` move on to
/// the next interpreter — often `py`, which does have them.
///
/// Id 0 is reserved for this; real requests are numbered from 1.
async fn handshake(proc: &Proc) -> Result<(), String> {
    let (tx, rx) = oneshot::channel();
    proc.pending.lock().await.insert(0, tx);

    {
        let mut stdin = proc.stdin.lock().await;
        let line = "{\"id\":0,\"cmd\":\"ping\",\"args\":{}}\n";
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("couldn't write to it ({e})"))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("couldn't write to it ({e})"))?;
    }

    let response = match tokio::time::timeout(HANDSHAKE_TIMEOUT, rx).await {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => return Err("it exited immediately".to_string()),
        Err(_) => return Err(format!("it didn't respond within {}s", HANDSHAKE_TIMEOUT.as_secs())),
    };

    let data = unwrap_response(response)?;
    match data.get("startupError").and_then(Value::as_str) {
        Some(err) => Err(err.to_string()),
        None => Ok(()),
    }
}

/// Sends one request to one process and waits for its reply.
async fn request(proc: &Proc, id: u64, cmd: &str, args: Value) -> Result<Value, Failure> {
    if !proc.is_alive() {
        return Err(Failure::Dead { sent: false });
    }

    let (tx, rx) = oneshot::channel();
    proc.pending.lock().await.insert(id, tx);

    let request = serde_json::json!({ "id": id, "cmd": cmd, "args": args });
    let mut line = request.to_string();
    line.push('\n');

    {
        let mut stdin = proc.stdin.lock().await;
        // A write that fails means the pipe is broken, i.e. the process is
        // already gone and never saw the request — so retrying it is safe even
        // for a mutation.
        if stdin.write_all(line.as_bytes()).await.is_err() || stdin.flush().await.is_err() {
            proc.pending.lock().await.remove(&id);
            return Err(Failure::Dead { sent: false });
        }
    }

    match tokio::time::timeout(CALL_TIMEOUT, rx).await {
        Ok(Ok(response)) => Ok(response),
        // Sender dropped — the reader task saw the process exit.
        Ok(Err(_)) => Err(Failure::Dead { sent: true }),
        Err(_) => {
            proc.pending.lock().await.remove(&id);
            Err(Failure::Wedged)
        }
    }
}

fn unwrap_response(response: Value) -> Result<Value, String> {
    if response.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(response.get("data").cloned().unwrap_or(Value::Null))
    } else {
        Err(response
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("unknown sidecar error")
            .to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stand-in helper that can be made to die on command, so the supervisor's
    /// recovery can be exercised without depending on ytmusicapi.
    const FAKE_HELPER: &str = r#"
import json, sys
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req = json.loads(line)
    cmd = req.get("cmd")
    if cmd in ("boom", "create_playlist"):
        sys.exit(1)
    data = {"startupError": None} if cmd == "ping" else {"echo": cmd}
    print(json.dumps({"id": req["id"], "ok": True, "data": data}), flush=True)
"#;

    fn fake_sidecar(name: &str) -> (Sidecar, PathBuf) {
        let root = std::env::temp_dir().join(format!("melodia-sidecar-test-{name}"));
        let dir = root.join("sidecar");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("main.py"), FAKE_HELPER).unwrap();
        (
            Sidecar::new(root.join("data"), Some(root.clone())),
            root,
        )
    }

    #[test]
    fn recovers_from_a_helper_that_dies() {
        let (sidecar, root) = fake_sidecar("recovers");

        tauri::async_runtime::block_on(async {
            assert!(sidecar.call("echo", serde_json::json!({})).await.is_ok());

            // Kills the helper on arrival, and kills the retry's helper too, so
            // the caller is told rather than left hanging.
            let err = sidecar.call("boom", serde_json::json!({})).await.unwrap_err();
            assert!(err.contains("stopped and couldn't be restarted"), "{err}");

            // The next call must transparently bring up a fresh process.
            let after = sidecar.call("echo", serde_json::json!({})).await;
            assert_eq!(after.unwrap()["echo"], "echo");
        });

        let _ = std::fs::remove_dir_all(root);
    }

    /// End-to-end against the real `sidecar/main.py`, so it needs Python 3 with
    /// `sidecar/requirements.txt` installed: `cargo test -- --ignored`. Worth
    /// running on a workstation that reports helper trouble — a failure here
    /// names the cause, and `sidecar.log` in the temp data dir has the rest.
    #[test]
    #[ignore = "requires Python 3 with the sidecar's packages installed"]
    fn real_helper_answers() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let data = std::env::temp_dir().join("melodia-sidecar-test-real");
        let _ = std::fs::remove_dir_all(&data);
        let sidecar = Sidecar::new(data.clone(), Some(repo));

        tauri::async_runtime::block_on(async {
            let status = sidecar
                .call("auth_status", serde_json::json!({}))
                .await
                .expect("the real helper should answer auth_status");
            assert!(status.get("status").is_some(), "{status}");
        });

        assert!(data.join("sidecar.log").is_file(), "stderr should be logged");
        let _ = std::fs::remove_dir_all(data);
    }

    #[test]
    fn does_not_retry_a_mutation_that_reached_the_helper() {
        let (sidecar, root) = fake_sidecar("mutation");

        tauri::async_runtime::block_on(async {
            let err = sidecar
                .call("create_playlist", serde_json::json!({ "title": "x" }))
                .await
                .unwrap_err();
            assert!(err.contains("may not have been applied"), "{err}");

            // Still recovers for everything after it.
            assert!(sidecar.call("echo", serde_json::json!({})).await.is_ok());
        });

        let _ = std::fs::remove_dir_all(root);
    }
}
