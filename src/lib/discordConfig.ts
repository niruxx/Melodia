/**
 * Melodia's own Discord Application ID, used for Rich Presence.
 *
 * This is NOT a bot — it requires no bot token and no server permissions.
 * It's purely an identity tag Discord's Rich Presence protocol requires in
 * its connection handshake so it knows whose name/icon to display. Every
 * user of the built app shares this one ID; nobody has to create their own.
 *
 * To get one: https://discord.com/developers/applications -> New Application
 * -> name it "Melodia" -> copy the Application ID from General Information.
 * Takes under a minute, no approval needed.
 */
export const DISCORD_APP_ID = "REPLACE_WITH_MELODIA_DISCORD_APPLICATION_ID";
