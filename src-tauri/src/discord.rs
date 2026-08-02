use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;

/// Manages an optional connection to the local Discord desktop app's IPC
/// socket for Rich Presence. All Discord IPC calls are blocking, so they run
/// via `spawn_blocking`; a missing/closed Discord client surfaces as a
/// `Result::Err` rather than panicking.
///
/// Discord tears down the IPC pipe fairly freely — when it restarts, updates
/// itself, or drops an idle connection. On Windows the next write then fails
/// with "The pipe is being closed. (os error 232)". A single connection is
/// therefore not something that can be established once and relied on, so
/// failed updates reconnect and retry, and a client that stays broken is
/// discarded rather than kept for the next attempt to fail on too.
pub struct Discord {
    client: Mutex<Option<DiscordIpcClient>>,
    /// Retained so a dropped connection can be rebuilt without the frontend
    /// having to notice and call `connect` again.
    app_id: Mutex<Option<String>>,
}

fn connect_client(app_id: &str) -> Result<DiscordIpcClient, String> {
    let mut client = DiscordIpcClient::new(app_id).map_err(|e| e.to_string())?;
    client.connect().map_err(|e| e.to_string())?;
    Ok(client)
}

impl Discord {
    pub fn new() -> Self {
        Self {
            client: Mutex::new(None),
            app_id: Mutex::new(None),
        }
    }

    pub async fn connect(&self, app_id: String) -> Result<(), String> {
        // Stored before connecting, so that if Discord simply isn't running
        // yet a later update can establish the connection instead of being
        // permanently stuck with no id to retry with.
        *self.app_id.lock().unwrap() = Some(app_id.clone());

        let client =
            tauri::async_runtime::spawn_blocking(move || connect_client(&app_id))
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
        let Some(app_id) = self.app_id.lock().unwrap().clone() else {
            return Err("discord not connected".to_string());
        };
        let existing = self.client.lock().unwrap().take();

        let (client, result) = tauri::async_runtime::spawn_blocking(move || {
            // Rebuilt per attempt rather than cloned: `Activity` borrows the
            // strings it's given, so it can't outlive a single use.
            let build = || {
                let mut built = activity::Activity::new()
                    .details(&title)
                    .state(&artist)
                    .activity_type(activity::ActivityType::Listening);
                if let Some(url) = thumbnail.as_deref() {
                    built =
                        built.assets(activity::Assets::new().large_image(url).large_text(&title));
                }
                built
            };

            let mut client = match existing {
                Some(client) => client,
                // No live connection: the previous attempt discarded a broken
                // one, or Discord wasn't running when the user enabled this.
                None => match connect_client(&app_id) {
                    Ok(client) => client,
                    Err(e) => return (None, Err(e)),
                },
            };

            match client.set_activity(build()) {
                Ok(()) => (Some(client), Ok(())),
                Err(first) => {
                    // One reconnect covers the common case of Discord having
                    // restarted since the last update.
                    match client.reconnect().and_then(|()| client.set_activity(build())) {
                        Ok(()) => (Some(client), Ok(())),
                        // Deliberately drops the client: keeping a dead one
                        // means every later update fails on the same pipe.
                        Err(_) => (None, Err(first.to_string())),
                    }
                }
            }
        })
        .await
        .map_err(|e| e.to_string())?;

        *self.client.lock().unwrap() = client;
        result
    }

    pub async fn disconnect(&self) -> Result<(), String> {
        *self.app_id.lock().unwrap() = None;
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
