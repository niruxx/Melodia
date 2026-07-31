use serde_json::Value;
use tauri::State;

use crate::discord::Discord;
use crate::sidecar::Sidecar;

#[tauri::command]
pub async fn ytm_auth_status(sidecar: State<'_, Sidecar>) -> Result<Value, String> {
    sidecar.call("auth_status", serde_json::json!({})).await
}

#[tauri::command]
pub async fn ytm_set_credentials(
    sidecar: State<'_, Sidecar>,
    client_id: String,
    client_secret: String,
) -> Result<Value, String> {
    sidecar
        .call(
            "set_credentials",
            serde_json::json!({ "clientId": client_id, "clientSecret": client_secret }),
        )
        .await
}

#[tauri::command]
pub async fn ytm_start_oauth(sidecar: State<'_, Sidecar>) -> Result<Value, String> {
    sidecar.call("start_oauth", serde_json::json!({})).await
}

#[tauri::command]
pub async fn ytm_poll_oauth(sidecar: State<'_, Sidecar>) -> Result<Value, String> {
    sidecar.call("poll_oauth", serde_json::json!({})).await
}

#[tauri::command]
pub async fn ytm_sign_out(sidecar: State<'_, Sidecar>) -> Result<Value, String> {
    sidecar.call("sign_out", serde_json::json!({})).await
}

#[tauri::command]
pub async fn ytm_get_home(sidecar: State<'_, Sidecar>) -> Result<Value, String> {
    sidecar.call("get_home", serde_json::json!({})).await
}

#[tauri::command]
pub async fn ytm_get_library_playlists(sidecar: State<'_, Sidecar>) -> Result<Value, String> {
    sidecar
        .call("get_library_playlists", serde_json::json!({}))
        .await
}

#[tauri::command]
pub async fn ytm_get_library_albums(sidecar: State<'_, Sidecar>) -> Result<Value, String> {
    sidecar
        .call("get_library_albums", serde_json::json!({}))
        .await
}

#[tauri::command]
pub async fn ytm_get_history(sidecar: State<'_, Sidecar>) -> Result<Value, String> {
    sidecar.call("get_history", serde_json::json!({})).await
}

#[tauri::command]
pub async fn ytm_get_playlist(
    sidecar: State<'_, Sidecar>,
    playlist_id: String,
) -> Result<Value, String> {
    sidecar
        .call("get_playlist", serde_json::json!({ "playlistId": playlist_id }))
        .await
}

#[tauri::command]
pub async fn ytm_search(sidecar: State<'_, Sidecar>, query: String) -> Result<Value, String> {
    sidecar
        .call("search", serde_json::json!({ "query": query }))
        .await
}

#[tauri::command]
pub async fn ytm_get_lyrics(sidecar: State<'_, Sidecar>, video_id: String) -> Result<Value, String> {
    sidecar
        .call("get_lyrics", serde_json::json!({ "videoId": video_id }))
        .await
}

#[tauri::command]
pub async fn discord_connect(discord: State<'_, Discord>, app_id: String) -> Result<(), String> {
    discord.connect(app_id).await
}

#[tauri::command]
pub async fn discord_update_presence(
    discord: State<'_, Discord>,
    title: String,
    artist: String,
    thumbnail: Option<String>,
) -> Result<(), String> {
    discord.update(title, artist, thumbnail).await
}

#[tauri::command]
pub async fn discord_disconnect(discord: State<'_, Discord>) -> Result<(), String> {
    discord.disconnect().await
}
