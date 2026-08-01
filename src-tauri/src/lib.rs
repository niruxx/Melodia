mod analyzer;
mod artwork;
mod commands;
mod discord;
mod equalizer;
mod local_library;
mod network;
mod playback;
mod sidecar;

use discord::Discord;
use network::NetworkState;
use playback::Playback;
use sidecar::Sidecar;
use std::sync::Arc;
use tauri::{Emitter, Manager};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Binds the OS media keys to playback events the frontend listens for.
///
/// These are best-effort: another running media app may already own a key, in
/// which case registration fails for that one shortcut. That's not fatal, so
/// each is registered independently and failures are ignored rather than
/// aborting startup.
fn register_media_keys(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut};

    let bindings = [
        (Code::MediaPlayPause, "media:play-pause"),
        (Code::MediaTrackNext, "media:next"),
        (Code::MediaTrackPrevious, "media:prev"),
        (Code::MediaStop, "media:stop"),
    ];

    for (code, event) in bindings {
        let handle = app.clone();
        let shortcut = Shortcut::new(None, code);
        let _ = app.global_shortcut().on_shortcut(shortcut, move |_, _, ev| {
            // Fire once per physical press, not again on release.
            if ev.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                let _ = handle.emit(event, ());
            }
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            register_media_keys(app.handle());
            let data_dir = app.path().app_data_dir()?;
            let sidecar = Sidecar::spawn(data_dir).map_err(std::io::Error::other)?;
            app.manage(sidecar);
            app.manage(Discord::new());
            app.manage(Arc::new(NetworkState::new()));
            app.manage(Playback::spawn(app.handle().clone()));
            app.manage(artwork::ArtworkCache::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::ytm_auth_status,
            commands::ytm_set_credentials,
            commands::ytm_start_oauth,
            commands::ytm_poll_oauth,
            commands::ytm_sign_out,
            commands::ytm_get_home,
            commands::ytm_get_library_playlists,
            commands::ytm_get_library_albums,
            commands::ytm_get_history,
            commands::ytm_get_playlist,
            commands::ytm_search,
            commands::ytm_get_lyrics,
            commands::discord_connect,
            commands::discord_update_presence,
            commands::discord_disconnect,
            network::network_start,
            network::network_connect,
            network::network_respond_request,
            network::network_send_command,
            network::network_broadcast_state,
            network::network_disconnect,
            commands::playback_play,
            commands::playback_play_local,
            commands::playback_pause,
            commands::playback_resume,
            commands::playback_seek,
            commands::playback_set_volume,
            commands::playback_set_fade_ms,
            commands::playback_set_eq,
            commands::playback_stop,
            local_library::local_get_folder,
            local_library::local_set_folder,
            local_library::local_scan,
            artwork::artwork_palette,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
