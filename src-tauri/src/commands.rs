use serde_json::Value;
use tauri::State;

use crate::discord::Discord;
use crate::equalizer::BAND_COUNT;
use crate::playback::Playback;
use crate::sidecar::Sidecar;

#[tauri::command]
pub async fn ytm_auth_status(sidecar: State<'_, Sidecar>) -> Result<Value, String> {
    sidecar.call("auth_status", serde_json::json!({})).await
}

#[tauri::command]
pub async fn ytm_set_browser_auth(
    sidecar: State<'_, Sidecar>,
    cookie: String,
) -> Result<Value, String> {
    sidecar
        .call("set_browser_auth", serde_json::json!({ "cookie": cookie }))
        .await
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
pub async fn ytm_get_account_info(sidecar: State<'_, Sidecar>) -> Result<Value, String> {
    sidecar.call("get_account_info", serde_json::json!({})).await
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

#[tauri::command]
pub async fn playback_play(
    sidecar: State<'_, Sidecar>,
    playback: State<'_, Playback>,
    video_id: String,
) -> Result<(), String> {
    let data = sidecar
        .call("get_stream_url", serde_json::json!({ "videoId": video_id }))
        .await?;
    let url = data
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| "couldn't resolve an audio stream for this track".to_string())?
        .to_string();
    let headers = data
        .get("headers")
        .and_then(Value::as_object)
        .map(|obj| {
            obj.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                .collect()
        })
        .unwrap_or_default();
    playback.play(url, headers)
}

#[tauri::command]
pub fn playback_play_local(playback: State<'_, Playback>, path: String) -> Result<(), String> {
    playback.play_local(path)
}

#[tauri::command]
pub fn playback_pause(playback: State<'_, Playback>) -> Result<(), String> {
    playback.pause()
}

#[tauri::command]
pub fn playback_resume(playback: State<'_, Playback>) -> Result<(), String> {
    playback.resume()
}

#[tauri::command]
pub fn playback_seek(playback: State<'_, Playback>, seconds: f64) -> Result<(), String> {
    playback.seek(seconds)
}

#[tauri::command]
pub fn playback_set_volume(playback: State<'_, Playback>, volume: f32) -> Result<(), String> {
    playback.set_volume(volume)
}

#[tauri::command]
pub fn playback_set_fade_ms(playback: State<'_, Playback>, ms: u32) -> Result<(), String> {
    playback.set_fade_ms(ms)
}

#[tauri::command]
pub fn playback_set_eq(
    playback: State<'_, Playback>,
    bands: [f32; BAND_COUNT],
) -> Result<(), String> {
    playback.set_eq(bands)
}

#[tauri::command]
pub fn playback_stop(playback: State<'_, Playback>) -> Result<(), String> {
    playback.stop()
}
