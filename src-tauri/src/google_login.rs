use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use url::Url;

const WINDOW_LABEL: &str = "google-login";

/// Where we send the user to sign in. Landing back on music.youtube.com is what
/// tells us the flow finished.
const LOGIN_URL: &str =
    "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F";

/// Cookies are read for this origin — the same one ytmusicapi sends requests to.
const COOKIE_URL: &str = "https://music.youtube.com";

/// The cookie ytmusicapi derives the SAPISIDHASH authorization header from.
/// Without it the session is useless, so it doubles as our "is login complete"
/// signal.
const REQUIRED_COOKIE: &str = "__Secure-3PAPISID";

fn collect_cookie_header(app: &AppHandle) -> Option<String> {
    let window = app.get_webview_window(WINDOW_LABEL)?;
    let url = Url::parse(COOKIE_URL).ok()?;
    let cookies = window.cookies_for_url(url).ok()?;

    let mut pairs = Vec::new();
    let mut has_required = false;
    for cookie in cookies {
        if cookie.name() == REQUIRED_COOKIE {
            has_required = true;
        }
        pairs.push(format!("{}={}", cookie.name(), cookie.value()));
    }

    if !has_required || pairs.is_empty() {
        return None;
    }
    Some(pairs.join("; "))
}

/// Opens Google's sign-in page in its own window.
///
/// Emits `google-login:complete` with the assembled cookie header once the
/// session is usable, or `google-login:cancelled` if the user closes the window
/// first. The frontend hands the cookie to the sidecar, which validates it
/// before persisting — so a premature capture fails loudly rather than
/// half-signing-in.
#[tauri::command]
pub async fn google_login_start(app: AppHandle) -> Result<(), String> {
    // Reuse an already-open window instead of stacking duplicates.
    if let Some(existing) = app.get_webview_window(WINDOW_LABEL) {
        let _ = existing.set_focus();
        return Ok(());
    }

    let url = Url::parse(LOGIN_URL).map_err(|e| e.to_string())?;

    // Shared between the navigation hook and the close handler so whichever
    // fires first decides the outcome exactly once.
    let finished = Arc::new(AtomicBool::new(false));

    let nav_app = app.clone();
    let nav_finished = finished.clone();

    let window = WebviewWindowBuilder::new(&app, WINDOW_LABEL, WebviewUrl::External(url))
        .title("Sign in with Google")
        .inner_size(520.0, 680.0)
        .center()
        .focused(true)
        .on_navigation(move |url| {
            // Google bounces through several intermediate URLs; only a landing
            // on music.youtube.com means the session is actually established.
            if url.host_str().is_some_and(|h| h.ends_with("music.youtube.com"))
                && !nav_finished.load(Ordering::SeqCst)
            {
                let app = nav_app.clone();
                let finished = nav_finished.clone();
                // The cookie jar is only populated once the response has been
                // processed, so read it just after navigation is allowed.
                tauri::async_runtime::spawn(async move {
                    for _ in 0..20 {
                        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                        if let Some(cookie) = collect_cookie_header(&app) {
                            if finished.swap(true, Ordering::SeqCst) {
                                return; // another path already reported
                            }
                            let _ = app.emit("google-login:complete", cookie);
                            if let Some(w) = app.get_webview_window(WINDOW_LABEL) {
                                let _ = w.close();
                            }
                            return;
                        }
                    }
                });
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())?;

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
            // Closed before we ever saw a usable session.
            let _ = close_app.emit("google-login:cancelled", ());
        }
    });

    Ok(())
}

/// Closes the login window, used by the in-app Cancel button.
#[tauri::command]
pub fn google_login_cancel(app: AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.close();
    }
}
