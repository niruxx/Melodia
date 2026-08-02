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
pub async fn ytm_create_playlist(
    sidecar: State<'_, Sidecar>,
    title: String,
    description: Option<String>,
    privacy: Option<String>,
) -> Result<Value, String> {
    sidecar
        .call(
            "create_playlist",
            serde_json::json!({
                "title": title,
                "description": description,
                "privacy": privacy,
            }),
        )
        .await
}

#[tauri::command]
pub async fn ytm_edit_playlist(
    sidecar: State<'_, Sidecar>,
    playlist_id: String,
    title: Option<String>,
    description: Option<String>,
    privacy: Option<String>,
) -> Result<Value, String> {
    sidecar
        .call(
            "edit_playlist",
            serde_json::json!({
                "playlistId": playlist_id,
                "title": title,
                "description": description,
                "privacy": privacy,
            }),
        )
        .await
}

#[tauri::command]
pub async fn ytm_delete_playlist(
    sidecar: State<'_, Sidecar>,
    playlist_id: String,
) -> Result<Value, String> {
    sidecar
        .call(
            "delete_playlist",
            serde_json::json!({ "playlistId": playlist_id }),
        )
        .await
}

#[tauri::command]
pub async fn ytm_add_playlist_items(
    sidecar: State<'_, Sidecar>,
    playlist_id: String,
    video_ids: Vec<String>,
    allow_duplicates: Option<bool>,
) -> Result<Value, String> {
    sidecar
        .call(
            "add_playlist_items",
            serde_json::json!({
                "playlistId": playlist_id,
                "videoIds": video_ids,
                "allowDuplicates": allow_duplicates.unwrap_or(false),
            }),
        )
        .await
}

/// `items` are `{ videoId, setVideoId }` pairs, passed through to ytmusicapi
/// unchanged — both keys are required for a removal to be accepted.
#[tauri::command]
pub async fn ytm_remove_playlist_items(
    sidecar: State<'_, Sidecar>,
    playlist_id: String,
    items: Vec<Value>,
) -> Result<Value, String> {
    sidecar
        .call(
            "remove_playlist_items",
            serde_json::json!({ "playlistId": playlist_id, "items": items }),
        )
        .await
}

#[tauri::command]
pub async fn ytm_move_playlist_item(
    sidecar: State<'_, Sidecar>,
    playlist_id: String,
    set_video_id: String,
    before_set_video_id: Option<String>,
) -> Result<Value, String> {
    sidecar
        .call(
            "move_playlist_item",
            serde_json::json!({
                "playlistId": playlist_id,
                "setVideoId": set_video_id,
                "beforeSetVideoId": before_set_video_id,
            }),
        )
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
pub async fn ytm_get_video_url(
    sidecar: State<'_, Sidecar>,
    video_id: String,
    max_height: Option<u32>,
) -> Result<Value, String> {
    sidecar
        .call(
            "get_video_url",
            serde_json::json!({ "videoId": video_id, "maxHeight": max_height.unwrap_or(1080) }),
        )
        .await
}

#[tauri::command]
pub async fn ytm_get_comments(
    sidecar: State<'_, Sidecar>,
    video_id: String,
    limit: Option<u32>,
    sort: Option<String>,
    replies_per_thread: Option<u32>,
) -> Result<Value, String> {
    sidecar
        .call(
            "get_comments",
            serde_json::json!({
                "videoId": video_id,
                "limit": limit.unwrap_or(50),
                "sort": sort.unwrap_or_else(|| "top".into()),
                "repliesPerThread": replies_per_thread.unwrap_or(0),
            }),
        )
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

/// Restarts the app. Never returns — the current process is replaced.
#[tauri::command]
pub fn app_relaunch(app: tauri::AppHandle) {
    // Exits the background-mode close guard deliberately: a relaunch should
    // actually tear the process down rather than hide to the tray.
    app.restart()
}

#[tauri::command]
pub fn playback_list_outputs() -> Vec<crate::playback::OutputDevice> {
    crate::playback::list_output_devices()
}

#[tauri::command]
pub fn playback_set_output(
    playback: State<'_, Playback>,
    device_id: Option<String>,
) -> Result<(), String> {
    playback.set_output_device(device_id)
}

#[tauri::command]
pub async fn playback_play(
    sidecar: State<'_, Sidecar>,
    playback: State<'_, Playback>,
    video_id: String,
    quality: Option<String>,
) -> Result<Value, String> {
    let data = sidecar
        .call(
            "get_stream_url",
            serde_json::json!({
                "videoId": video_id,
                "quality": quality.unwrap_or_else(|| "best".into()),
            }),
        )
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
    playback.play(url, headers)?;

    // Hand back what was actually served, which isn't always what was asked
    // for — a track with no stream at the requested codec/bitrate falls back.
    Ok(serde_json::json!({
        "ext": data.get("ext").cloned().unwrap_or(Value::Null),
        "abr": data.get("abr").cloned().unwrap_or(Value::Null),
        "acodec": data.get("acodec").cloned().unwrap_or(Value::Null),
    }))
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
