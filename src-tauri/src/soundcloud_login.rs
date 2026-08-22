use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use url::Url;

const WINDOW_LABEL: &str = "soundcloud-login";

/// SoundCloud has no dedicated hosted sign-in page the way Google does — the
/// homepage itself surfaces a "Log in" button that opens the site's own
/// sign-in modal. Opening the homepage and letting the user click it
/// themselves is more robust than guessing a deep link into that modal.
const LOGIN_URL: &str = "https://soundcloud.com/";

/// Sentinel prefix the injected script writes into `document.title` once it
/// finds a usable token. `WebviewWindow::eval()` has no return channel, but
/// `.title()` is a synchronous getter Rust can poll, so the window's own
/// title doubles as the handoff — the same trick, applied to a different
/// observable, as `google_login.rs`'s cookie-jar poll.
const TITLE_SENTINEL: &str = "MELODIA_SC_TOKEN:";

/// How many 500ms polls Rust waits for the token before giving up on this
/// window. The injected script has its own shorter budget; this is a
/// backstop in case that script never runs at all (e.g. an unexpected
/// redirect). The frontend's own sign-in timeout is what actually protects
/// the user from waiting forever — this just keeps the window from polling
/// past all reasonable purpose.
const MAX_POLL_ATTEMPTS: u32 = 600; // 5 minutes at 500ms

/// Polls localStorage for the account's bearer token once the SPA has signed
/// the user in.
///
/// The exact key SoundCloud stores it under can't be verified without a live
/// browser, so this tries a short list of keys known to have been used by
/// SoundCloud's web client, then falls back to scanning every stored value
/// for one that's shaped like a token. If neither ever matches, this script
/// quietly gives up — the login window's own timeout expires and the app's
/// manual "paste your token" fallback still gets the user signed in.
const POLL_SCRIPT: &str = r#"
(function () {
  var CANDIDATE_KEYS = ["oauth_token", "access_token", "OAuthToken", "hOAuthToken"];
  var TOKEN_SHAPE = /^[A-Za-z0-9._-]{20,}$/;

  function findToken() {
    for (var i = 0; i < CANDIDATE_KEYS.length; i++) {
      var v = localStorage.getItem(CANDIDATE_KEYS[i]);
      if (v && TOKEN_SHAPE.test(v)) return v;
    }
    for (var j = 0; j < localStorage.length; j++) {
      var key = localStorage.key(j);
      var val = localStorage.getItem(key);
      if (val && TOKEN_SHAPE.test(val) && /token/i.test(key)) return val;
    }
    return null;
  }

  var attempts = 0;
  var timer = setInterval(function () {
    attempts++;
    var token = findToken();
    if (token) {
      clearInterval(timer);
      document.title = "MELODIA_SC_TOKEN:" + token;
    } else if (attempts > 600) {
      clearInterval(timer);
    }
  }, 300);
})();
"#;

fn extract_captured_token(app: &AppHandle) -> Option<String> {
    let window = app.get_webview_window(WINDOW_LABEL)?;
    let title = window.title().ok()?;
    title.strip_prefix(TITLE_SENTINEL).map(|s| s.to_string())
}

/// Opens SoundCloud's homepage in its own window so the user can sign in
/// through the site's real UI.
///
/// Emits `soundcloud-login:complete` with the captured token once the
/// injected script finds one, or `soundcloud-login:cancelled` if the user
/// closes the window first. The frontend hands the token to the sidecar,
/// which validates it before persisting — mirroring the Google flow's
/// "a premature capture fails loudly rather than half-signing-in."
#[tauri::command]
pub async fn soundcloud_login_start(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(WINDOW_LABEL) {
        let _ = existing.set_focus();
        return Ok(());
    }

    let url = Url::parse(LOGIN_URL).map_err(|e| e.to_string())?;

    // Shared between the poll loop and the close handler so whichever fires
    // first decides the outcome exactly once.
    let finished = Arc::new(AtomicBool::new(false));

    let window = WebviewWindowBuilder::new(&app, WINDOW_LABEL, WebviewUrl::External(url))
        .title("Sign in with SoundCloud")
        .inner_size(480.0, 720.0)
        .center()
        .focused(true)
        .initialization_script(POLL_SCRIPT)
        .build()
        .map_err(|e| e.to_string())?;

    let poll_app = app.clone();
    let poll_finished = finished.clone();
    tauri::async_runtime::spawn(async move {
        for _ in 0..MAX_POLL_ATTEMPTS {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if poll_finished.load(Ordering::SeqCst) {
                return; // the window closed, or another path already reported
            }
            if let Some(token) = extract_captured_token(&poll_app) {
                if poll_finished.swap(true, Ordering::SeqCst) {
                    return;
                }
                let _ = poll_app.emit("soundcloud-login:complete", token);
                if let Some(w) = poll_app.get_webview_window(WINDOW_LABEL) {
                    let _ = w.close();
                }
                return;
            }
        }
    });

    let close_app = app.clone();
    let close_finished = finished.clone();
    window.on_window_event(move |event| {
        // `CloseRequested` covers the user clicking the window's X; `Destroyed`
        // catches programmatic closes. Whichever lands first wins the swap, so
        // the cancel is reported exactly once.
        let closing = matches!(
            event,
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
        );
        if closing && !close_finished.swap(true, Ordering::SeqCst) {
            let _ = close_app.emit("soundcloud-login:cancelled", ());
        }
    });

    Ok(())
}

/// Closes the login window, used by the in-app Cancel button.
#[tauri::command]
pub fn soundcloud_login_cancel(app: AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.close();
    }
}
