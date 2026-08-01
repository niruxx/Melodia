use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;

/// Backstop for a sidecar that is alive but wedged. The sidecar imposes its own
/// (much shorter) per-request timeout, and commands queue behind one another
/// there, so this is deliberately generous: it exists so a call can never hang
/// forever, not to bound normal latency.
const CALL_TIMEOUT: Duration = Duration::from_secs(180);

const DEAD_SIDECAR_MSG: &str =
    "the Python helper stopped running. Restart TuneBox, and check that Python 3 is installed.";

/// Manages the long-lived Python sidecar process wrapping ytmusicapi and
/// correlates line-delimited JSON requests/responses over its stdio.
pub struct Sidecar {
    stdin: Mutex<ChildStdin>,
    pending: PendingMap,
    next_id: AtomicU64,
    /// Cleared when the sidecar's stdout closes, i.e. the process has exited.
    alive: Arc<AtomicBool>,
    _child: Mutex<Child>,
}

/// Interpreter names to try, in order.
///
/// macOS and most Linux distros ship only `python3` — a bare `python` either
/// doesn't exist or (on Windows) may be the Microsoft Store shim that exits
/// immediately. Trying several keeps one build working everywhere.
#[cfg(windows)]
const PYTHON_CANDIDATES: &[&str] = &["python", "python3", "py"];
#[cfg(not(windows))]
const PYTHON_CANDIDATES: &[&str] = &["python3", "python"];

impl Sidecar {
    /// Locates `sidecar/main.py`.
    ///
    /// In a bundled app it ships as a Tauri resource; in development it sits
    /// next to the crate. `CARGO_MANIFEST_DIR` alone is a build-machine path,
    /// so relying on it would break every installed copy.
    fn script_path(resource_dir: Option<PathBuf>) -> PathBuf {
        if let Some(dir) = resource_dir {
            let bundled = dir.join("sidecar").join("main.py");
            if bundled.is_file() {
                return bundled;
            }
        }
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("sidecar")
            .join("main.py")
    }

    pub fn spawn(data_dir: PathBuf, resource_dir: Option<PathBuf>) -> Result<Self, String> {
        let script = Self::script_path(resource_dir);

        let mut last_err = None;
        let mut spawned = None;
        for exe in PYTHON_CANDIDATES {
            match Command::new(exe)
                .arg(&script)
                .arg(&data_dir)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .kill_on_drop(true)
                .spawn()
            {
                Ok(child) => {
                    spawned = Some(child);
                    break;
                }
                Err(e) => last_err = Some(e),
            }
        }

        let mut child = spawned.ok_or_else(|| {
            format!(
                "couldn't start the Python sidecar ({}). Tried {}. Is Python 3 installed and on PATH? Last error: {}",
                script.display(),
                PYTHON_CANDIDATES.join(", "),
                last_err
                    .map(|e| e.to_string())
                    .unwrap_or_else(|| "unknown".into()),
            )
        })?;

        let stdin = child.stdin.take().expect("sidecar stdin not piped");
        let stdout = child.stdout.take().expect("sidecar stdout not piped");

        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let pending_reader = pending.clone();
        let alive = Arc::new(AtomicBool::new(true));
        let alive_reader = alive.clone();

        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        let Ok(value) = serde_json::from_str::<Value>(&line) else {
                            continue;
                        };
                        let Some(id) = value.get("id").and_then(Value::as_u64) else {
                            continue;
                        };
                        if let Some(tx) = pending_reader.lock().await.remove(&id) {
                            let _ = tx.send(value);
                        }
                    }
                    _ => break,
                }
            }

            // stdout closed: the sidecar is gone and no reply is ever coming.
            // Dropping the senders wakes every waiting caller with an error —
            // without this they would await a response forever, which surfaces
            // in the UI as a spinner that never resolves.
            alive_reader.store(false, Ordering::SeqCst);
            pending_reader.lock().await.clear();
        });

        Ok(Self {
            stdin: Mutex::new(stdin),
            pending,
            next_id: AtomicU64::new(1),
            alive,
            _child: Mutex::new(child),
        })
    }

    pub async fn call(&self, cmd: &str, args: Value) -> Result<Value, String> {
        if !self.alive.load(Ordering::SeqCst) {
            return Err(DEAD_SIDECAR_MSG.to_string());
        }

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        let request = serde_json::json!({ "id": id, "cmd": cmd, "args": args });
        let mut line = request.to_string();
        line.push('\n');

        {
            let mut stdin = self.stdin.lock().await;
            stdin
                .write_all(line.as_bytes())
                .await
                .map_err(|e| e.to_string())?;
            stdin.flush().await.map_err(|e| e.to_string())?;
        }

        let response = match tokio::time::timeout(CALL_TIMEOUT, rx).await {
            Ok(Ok(response)) => response,
            // Sender dropped — the reader task saw the sidecar exit.
            Ok(Err(_)) => return Err(DEAD_SIDECAR_MSG.to_string()),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                return Err(format!(
                    "the music service didn't respond within {}s. Please try again.",
                    CALL_TIMEOUT.as_secs()
                ));
            }
        };
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
}
