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
use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let sidecar = Sidecar::spawn(data_dir).map_err(std::io::Error::other)?;
            app.manage(sidecar);
            app.manage(Discord::new());
            app.manage(Arc::new(NetworkState::new()));
            app.manage(Playback::spawn(app.handle().clone()));
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
