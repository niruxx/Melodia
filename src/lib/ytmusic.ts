import { invoke } from "@tauri-apps/api/core";
import type { Collection, PlaylistPrivacy, Track } from "./types";

// ---- raw invoke wrappers -------------------------------------------------

export type AuthStatus = "no_credentials" | "signed_out" | "signed_in";
export type AuthMethod = "browser" | "oauth" | null;

export async function authStatus(): Promise<{
  status: AuthStatus;
  method: AuthMethod;
  oauthConfigured: boolean;
}> {
  const res = await invoke<{
    status: AuthStatus;
    method?: AuthMethod;
    oauthConfigured?: boolean;
  }>("ytm_auth_status");
  return {
    status: res.status,
    method: res.method ?? null,
    oauthConfigured: res.oauthConfigured ?? false,
  };
}

/** Hands a captured Google session cookie to the sidecar, which validates it. */
export async function setBrowserAuth(cookie: string): Promise<void> {
  await invoke("ytm_set_browser_auth", { cookie });
}

/** Opens Google's sign-in window; resolves once the window is up, not signed in. */
export async function startGoogleLogin(): Promise<void> {
  await invoke("google_login_start");
}

/** Closes the Google sign-in window, if open. */
export async function cancelGoogleLogin(): Promise<void> {
  await invoke("google_login_cancel");
}

export async function setCredentials(clientId: string, clientSecret: string): Promise<void> {
  await invoke("ytm_set_credentials", { clientId, clientSecret });
}

export async function startOAuth(): Promise<{
  verificationUrl: string;
  userCode: string;
  expiresIn: number;
}> {
  const res = await invoke<{ verification_url: string; user_code: string; expires_in: number }>(
    "ytm_start_oauth",
  );
  return {
    verificationUrl: res.verification_url,
    userCode: res.user_code,
    expiresIn: res.expires_in,
  };
}

export async function pollOAuth(): Promise<{ status: "pending" | "success" | "error"; error?: string }> {
  return invoke("ytm_poll_oauth");
}

export type AccountInfo = {
  accountName: string | null;
  channelHandle: string | null;
  accountPhotoUrl: string | null;
};

export async function getAccountInfo(): Promise<AccountInfo> {
  const res = await invoke<Partial<AccountInfo>>("ytm_get_account_info");
  return {
    accountName: res.accountName ?? null,
    channelHandle: res.channelHandle ?? null,
    accountPhotoUrl: res.accountPhotoUrl ?? null,
  };
}

export async function signOut(): Promise<void> {
  await invoke("ytm_sign_out");
}

async function rawGetHome(): Promise<unknown[]> {
  return invoke("ytm_get_home");
}
async function rawGetLibraryPlaylists(): Promise<unknown[]> {
  return invoke("ytm_get_library_playlists");
}
async function rawGetLibraryAlbums(): Promise<unknown[]> {
  return invoke("ytm_get_library_albums");
}
async function rawGetHistory(): Promise<unknown[]> {
  return invoke("ytm_get_history");
}
async function rawGetPlaylist(playlistId: string): Promise<Record<string, unknown>> {
  return invoke("ytm_get_playlist", { playlistId });
}
async function rawSearch(query: string): Promise<unknown[]> {
  return invoke("ytm_search", { query });
}

// ---- normalization: raw ytmusicapi JSON -> our Track / Collection --------

type Thumbnail = { url: string; width?: number; height?: number };

function bestThumbnail(thumbnails: unknown): string | undefined {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return undefined;
  const list = thumbnails as Thumbnail[];
  return list[list.length - 1]?.url;
}

function mapArtists(artists: unknown, fallback = "Unknown Artist"): string {
  if (!Array.isArray(artists) || artists.length === 0) return fallback;
  const names = artists
    .map((a) => (a && typeof a === "object" ? (a as { name?: string }).name : undefined))
    .filter((n): n is string => Boolean(n));
  return names.length > 0 ? names.join(", ") : fallback;
}

function parseDurationSeconds(raw: Record<string, unknown>): number {
  if (typeof raw.duration_seconds === "number") return raw.duration_seconds;
  const text = raw.duration;
  if (typeof text === "string" && text.includes(":")) {
    const parts = text.split(":").map(Number);
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  return 0;
}

function albumName(raw: Record<string, unknown>): string {
  const album = raw.album;
  if (album && typeof album === "object") return (album as { name?: string }).name ?? "";
  if (typeof album === "string") return album;
  return "";
}

export function mapTrack(raw: Record<string, unknown>): Track {
  const id = (raw.videoId as string) ?? (raw.id as string) ?? crypto.randomUUID();
  return {
    id,
    title: (raw.title as string) ?? "Unknown title",
    artist: mapArtists(raw.artists),
    album: albumName(raw),
    duration: parseDurationSeconds(raw),
    thumbnail: bestThumbnail(raw.thumbnails),
    setVideoId: typeof raw.setVideoId === "string" ? raw.setVideoId : undefined,
  };
}

function mapCollection(raw: Record<string, unknown>, kind: "playlist" | "album"): Collection {
  const id = (raw.playlistId as string) ?? (raw.browseId as string) ?? (raw.id as string);
  const subtitle =
    kind === "album"
      ? mapArtists(raw.artists, "")
      : ((raw.description as string) || (raw.author as { name?: string } | undefined)?.name) ??
        (typeof raw.count === "number" ? `${raw.count} songs` : "Playlist");
  return {
    id,
    title: (raw.title as string) ?? "Untitled",
    subtitle: subtitle || "",
    kind,
    trackIds: [],
    thumbnail: bestThumbnail(raw.thumbnails),
  };
}

export type HomeSection = { title: string; items: Collection[] };

export type HomeResult = { sections: HomeSection[]; tracks: Record<string, Track> };

/** Maps get_home()'s mixed shelves (playlists/albums/bare songs) into
 * uniform Collection cards. Bare songs (no playlistId/browseId) become a
 * synthetic single-track "song-<videoId>" collection so the rest of the UI
 * (Card -> /playlist/:id) doesn't need a separate code path. */
export function mapHomeResponse(raw: unknown[]): HomeResult {
  const tracks: Record<string, Track> = {};
  const sections: HomeSection[] = [];

  for (const shelf of raw) {
    if (!shelf || typeof shelf !== "object") continue;
    const shelfObj = shelf as Record<string, unknown>;
    const contents = Array.isArray(shelfObj.contents) ? shelfObj.contents : [];
    const items: Collection[] = [];

    for (const entry of contents) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      if (item.playlistId) {
        items.push(mapCollection(item, "playlist"));
      } else if (item.browseId) {
        items.push(mapCollection(item, "album"));
      } else if (item.videoId) {
        const track = mapTrack(item);
        tracks[track.id] = track;
        items.push({
          id: `song-${track.id}`,
          title: track.title,
          subtitle: track.artist,
          kind: "playlist",
          trackIds: [track.id],
          thumbnail: track.thumbnail,
        });
      }
    }

    if (items.length > 0) {
      sections.push({ title: (shelfObj.title as string) ?? "", items });
    }
  }

  return { sections, tracks };
}

export async function getHome(): Promise<HomeResult> {
  return mapHomeResponse(await rawGetHome());
}

export async function getLibraryPlaylists(): Promise<Collection[]> {
  const raw = await rawGetLibraryPlaylists();
  return raw
    .filter((r): r is Record<string, unknown> => Boolean(r))
    .map((r) => mapCollection(r, "playlist"));
}

export async function getLibraryAlbums(): Promise<Collection[]> {
  const raw = await rawGetLibraryAlbums();
  return raw
    .filter((r): r is Record<string, unknown> => Boolean(r))
    .map((r) => mapCollection(r, "album"));
}

export async function getHistory(): Promise<Track[]> {
  const raw = await rawGetHistory();
  return raw.filter((r): r is Record<string, unknown> => Boolean(r)).map(mapTrack);
}

export type PlaylistDetail = {
  id: string;
  title: string;
  description: string;
  privacy: PlaylistPrivacy;
  owned: boolean;
  thumbnail?: string;
  tracks: Track[];
};

function asPrivacy(raw: unknown): PlaylistPrivacy {
  return raw === "PUBLIC" || raw === "UNLISTED" ? raw : "PRIVATE";
}

export async function getPlaylistDetail(playlistId: string): Promise<PlaylistDetail> {
  const raw = await rawGetPlaylist(playlistId);
  const rawTracks = Array.isArray(raw.tracks) ? raw.tracks : [];
  return {
    id: (raw.id as string) ?? playlistId,
    title: (raw.title as string) ?? "Untitled",
    description: (raw.description as string) ?? "",
    privacy: asPrivacy(raw.privacy),
    owned: raw.owned === true,
    thumbnail: bestThumbnail(raw.thumbnails),
    tracks: rawTracks.filter((r): r is Record<string, unknown> => Boolean(r)).map(mapTrack),
  };
}

// ---- playlist mutations --------------------------------------------------

export async function createPlaylist(
  title: string,
  description = "",
  privacy: PlaylistPrivacy = "PRIVATE",
): Promise<string> {
  const res = await invoke<{ playlistId: string }>("ytm_create_playlist", {
    title,
    description,
    privacy,
  });
  return res.playlistId;
}

export async function editPlaylist(
  playlistId: string,
  changes: { title?: string; description?: string; privacy?: PlaylistPrivacy },
): Promise<void> {
  await invoke("ytm_edit_playlist", {
    playlistId,
    title: changes.title ?? null,
    description: changes.description ?? null,
    privacy: changes.privacy ?? null,
  });
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  await invoke("ytm_delete_playlist", { playlistId });
}

export async function addPlaylistItems(
  playlistId: string,
  videoIds: string[],
  allowDuplicates = false,
): Promise<void> {
  await invoke("ytm_add_playlist_items", { playlistId, videoIds, allowDuplicates });
}

export async function removePlaylistItems(
  playlistId: string,
  items: { videoId: string; setVideoId: string }[],
): Promise<void> {
  await invoke("ytm_remove_playlist_items", { playlistId, items });
}

/** Moves `setVideoId` before `beforeSetVideoId`, or to the end when it's null. */
export async function movePlaylistItem(
  playlistId: string,
  setVideoId: string,
  beforeSetVideoId: string | null,
): Promise<void> {
  await invoke("ytm_move_playlist_item", { playlistId, setVideoId, beforeSetVideoId });
}

/** A timed lyric line. `lines` is empty when only unsynced text is available. */
export type LyricLine = { startMs: number; text: string };

export async function getLyrics(
  videoId: string,
): Promise<{ lyrics: string | null; source: string | null; lines: LyricLine[] }> {
  const res = await invoke<{
    lyrics: string | null;
    source: string | null;
    lines?: LyricLine[];
  }>("ytm_get_lyrics", { videoId });
  // An older sidecar predates timestamps and omits the field entirely.
  return { ...res, lines: res.lines ?? [] };
}

/** Reads a local file's lyrics: a sidecar `.lrc` first, then its own tags. */
export async function getLocalLyrics(
  path: string,
): Promise<{ lines: LyricLine[]; plain: string | null }> {
  return invoke("local_read_lyrics", { path });
}

export async function searchTracks(query: string): Promise<Track[]> {
  const raw = await rawSearch(query);
  return raw
    .filter((r): r is Record<string, unknown> => Boolean(r) && Boolean((r as Record<string, unknown>).videoId))
    .map(mapTrack);
}
