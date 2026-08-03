mod analyzer;
mod artwork;
mod background;
mod commands;
mod discord;
mod equalizer;
mod google_login;
mod local_library;
mod network;
mod playback;
mod python;
mod sidecar;
mod update;

use background::BackgroundMode;
use discord::Discord;
use network::NetworkState;
use playback::Playback;
use sidecar::Sidecar;
use std::sync::Arc;
use tauri::{Emitter, Manager, WindowEvent};

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
            let resource_dir = app.path().resource_dir().ok();
            // Started in the background rather than here: a workstation with no
            // usable Python should still get an app it can use for local files
            // and a real explanation in the UI, not a launch that fails.
            let sidecar = Sidecar::new(data_dir.clone(), resource_dir.clone());
            sidecar.warm();
            app.manage(sidecar);
            app.manage(python::PythonSetup::new(resource_dir.as_deref(), data_dir));
            app.manage(Discord::new());
            app.manage(Arc::new(NetworkState::new()));
            app.manage(Playback::spawn(app.handle().clone()));
            app.manage(artwork::ArtworkCache::new());
            app.manage(BackgroundMode::new());
            background::build_tray(app.handle())?;

            // Closing the main window hides it instead of quitting while
            // background mode is on, so playback (which lives on its own
            // thread) keeps running. The tray's Quit item is the way out.
            if let Some(main) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                main.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        let mode = handle.state::<BackgroundMode>();
                        if mode.is_enabled() && !mode.is_quitting() {
                            api.prevent_close();
                            if let Some(w) = handle.get_webview_window("main") {
                                let _ = w.hide();
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::ytm_auth_status,
            commands::ytm_set_browser_auth,
            commands::ytm_set_credentials,
            commands::ytm_start_oauth,
            commands::ytm_poll_oauth,
            commands::ytm_sign_out,
            commands::ytm_get_stream_auth,
            commands::ytm_set_stream_auth,
            commands::ytm_get_home,
            commands::ytm_get_library_playlists,
            commands::ytm_get_library_albums,
            commands::ytm_get_history,
            commands::ytm_get_playlist,
            commands::ytm_create_playlist,
            commands::ytm_edit_playlist,
            commands::ytm_delete_playlist,
            commands::ytm_add_playlist_items,
            commands::ytm_remove_playlist_items,
            commands::ytm_move_playlist_item,
            commands::ytm_search,
            commands::ytm_get_account_info,
            commands::ytm_get_lyrics,
            commands::ytm_get_comments,
            commands::ytm_get_video_url,
            commands::app_relaunch,
            python::python_status,
            python::python_open_installer,
            python::python_install_packages,
            update::check_for_update,
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
            commands::playback_list_outputs,
            commands::playback_set_output,
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
            google_login::google_login_start,
            google_login::google_login_cancel,
            background::set_background_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
