use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;

/// Manages an optional connection to the local Discord desktop app's IPC
/// socket for Rich Presence. All Discord IPC calls are blocking, so they run
/// via `spawn_blocking`; a missing/closed Discord client surfaces as a
/// `Result::Err` rather than panicking.
pub struct Discord {
    client: Mutex<Option<DiscordIpcClient>>,
}

impl Discord {
    pub fn new() -> Self {
        Self {
            client: Mutex::new(None),
        }
    }

    pub async fn connect(&self, app_id: String) -> Result<(), String> {
        let client = tauri::async_runtime::spawn_blocking(move || {
            let mut client = DiscordIpcClient::new(&app_id).map_err(|e| e.to_string())?;
            client.connect().map_err(|e| e.to_string())?;
            Ok::<_, String>(client)
        })
        .await
        .map_err(|e| e.to_string())??;

        *self.client.lock().unwrap() = Some(client);
        Ok(())
    }

    pub async fn update(
        &self,
        title: String,
        artist: String,
        thumbnail: Option<String>,
    ) -> Result<(), String> {
        let client = self.client.lock().unwrap().take();
        let Some(client) = client else {
            return Err("discord not connected".to_string());
        };

        let (client, result) = tauri::async_runtime::spawn_blocking(move || {
            let mut client = client;
            let mut built = activity::Activity::new()
                .details(&title)
                .state(&artist)
                .activity_type(activity::ActivityType::Listening);
            if let Some(url) = thumbnail.as_deref() {
                built = built.assets(activity::Assets::new().large_image(url).large_text(&title));
            }
            let result = client.set_activity(built).map_err(|e| e.to_string());
            (client, result)
        })
        .await
        .map_err(|e| e.to_string())?;

        *self.client.lock().unwrap() = Some(client);
        result
    }

    pub async fn disconnect(&self) -> Result<(), String> {
        let client = self.client.lock().unwrap().take();
        if let Some(client) = client {
            tauri::async_runtime::spawn_blocking(move || {
                let mut client = client;
                let _ = client.close();
            })
            .await
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
