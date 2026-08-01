use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Whether closing the main window should keep the app alive in the tray
/// instead of quitting. Owned here rather than read from the frontend at close
/// time because the close handler must decide synchronously.
pub struct BackgroundMode {
    enabled: AtomicBool,
    /// Set only by the tray's Quit item, so the close handler knows to let a
    /// deliberate exit through instead of hiding the window again.
    quitting: AtomicBool,
}

impl BackgroundMode {
    pub fn new() -> Self {
        Self {
            enabled: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
        }
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    pub fn begin_quit(&self) {
        self.quitting.store(true, Ordering::SeqCst);
    }

    pub fn is_quitting(&self) -> bool {
        self.quitting.load(Ordering::SeqCst)
    }
}

/// Pushed from the frontend whenever the setting changes (and once at startup).
#[tauri::command]
pub fn set_background_mode(app: AppHandle, enabled: bool) {
    app.state::<BackgroundMode>().set_enabled(enabled);
}

/// Brings the main window back from the tray.
fn restore_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Builds the tray icon and its menu.
///
/// The menu doubles as transport controls so playback is still usable while
/// the window is hidden — the click handlers emit the same `media:*` events the
/// OS media keys already use, so no new frontend wiring is needed.
pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "tray_show", "Show TuneBox", true, None::<&str>)?;
    let play_pause = MenuItem::with_id(app, "tray_play_pause", "Play / Pause", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "tray_next", "Next", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, "tray_prev", "Previous", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray_quit", "Quit TuneBox", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[&show, &sep, &prev, &play_pause, &next, &sep, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id("tunebox-tray")
        .menu(&menu)
        .tooltip("TuneBox")
        // Windows convention: left-click restores, right-click opens the menu.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_show" => restore_main_window(app),
            "tray_play_pause" => {
                let _ = app.emit("media:play-pause", ());
            }
            "tray_next" => {
                let _ = app.emit("media:next", ());
            }
            "tray_prev" => {
                let _ = app.emit("media:prev", ());
            }
            "tray_quit" => {
                app.state::<BackgroundMode>().begin_quit();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                restore_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}
