import { invoke } from "@tauri-apps/api/core";
import type { Collection, PlaylistPrivacy, Track } from "./types";

/** Every id this module hands out is stamped with this prefix, mirroring the
 * `local:` convention in `playerStore.ts` — it's how the rest of the app
 * tells a SoundCloud track/collection apart from a bare YouTube videoId. */
export const SC_ID_PREFIX = "sc:";

// ---- raw invoke wrappers ---------------------------------------------

export type ScAuthStatus = "signed_out" | "signed_in";

export async function authStatus(): Promise<{ status: ScAuthStatus }> {
  return invoke("sc_auth_status");
}

/** Hands a captured or manually-pasted SoundCloud token to the sidecar, which
 * validates it before persisting. */
export async function setAuth(token: string): Promise<{ ok: boolean; username: string | null }> {
  return invoke("sc_set_auth", { token });
}

/** Opens SoundCloud's real sign-in page; resolves once the window is up, not signed in. */
export async function startLogin(): Promise<void> {
  await invoke("soundcloud_login_start");
}

/** Closes the SoundCloud sign-in window, if open. */
export async function cancelLogin(): Promise<void> {
  await invoke("soundcloud_login_cancel");
}

export async function signOut(): Promise<void> {
  await invoke("sc_sign_out");
}

export type ScAccountInfo = {
  username: string | null;
  permalinkUrl: string | null;
  avatarUrl: string | null;
};

export async function getAccountInfo(): Promise<ScAccountInfo> {
  const res = await invoke<Partial<ScAccountInfo>>("sc_get_account_info");
  return {
    username: res.username ?? null,
    permalinkUrl: res.permalinkUrl ?? null,
    avatarUrl: res.avatarUrl ?? null,
  };
}

async function rawGetHome(): Promise<{ sections: { title: string; items: unknown[] }[] }> {
  return invoke("sc_get_home");
}
async function rawGetLibraryPlaylists(): Promise<unknown[]> {
  return invoke("sc_get_library_playlists");
}
async function rawGetLibraryLikes(): Promise<unknown[]> {
  return invoke("sc_get_library_likes");
}
async function rawGetLibraryFollowings(): Promise<unknown[]> {
  return invoke("sc_get_library_followings");
}
async function rawGetPlaylist(playlistId: string): Promise<Record<string, unknown>> {
  return invoke("sc_get_playlist", { playlistId });
}
async function rawSearch(query: string): Promise<unknown[]> {
  return invoke("sc_search", { query });
}

// ---- normalization: raw SoundCloud API JSON -> our Track / Collection ----

/** SoundCloud's default artwork crop tops out small; ask for a bigger one. */
function bestArtwork(url: unknown, fallback: unknown): string | undefined {
  const src = (typeof url === "string" && url) || (typeof fallback === "string" && fallback) || undefined;
  if (!src) return undefined;
  return src.replace("-large.", "-t500x500.");
}

export function mapTrack(raw: Record<string, unknown>): Track {
  const user = (raw.user as Record<string, unknown> | undefined) ?? {};
  const durationMs = typeof raw.duration === "number" ? raw.duration : 0;
  return {
    id: `${SC_ID_PREFIX}${raw.id}`,
    title: (raw.title as string) ?? "Unknown title",
    artist: (user.username as string) ?? "Unknown artist",
    album: "",
    duration: Math.round(durationMs / 1000),
    thumbnail: bestArtwork(raw.artwork_url, user.avatar_url),
    permalinkUrl: typeof raw.permalink_url === "string" ? raw.permalink_url : undefined,
  };
}

export function mapCollection(raw: Record<string, unknown>): Collection {
  const trackCount = typeof raw.track_count === "number" ? raw.track_count : undefined;
  const user = (raw.user as Record<string, unknown> | undefined) ?? {};
  return {
    id: `${SC_ID_PREFIX}${raw.id}`,
    title: (raw.title as string) ?? "Untitled",
    subtitle: trackCount !== undefined ? `${trackCount} songs` : ((user.username as string) ?? "Playlist"),
    kind: raw.is_album ? "album" : "playlist",
    trackIds: [],
    thumbnail: bestArtwork(raw.artwork_url, user.avatar_url),
  };
}

export type HomeSection = { title: string; items: Collection[] };
export type HomeResult = { sections: HomeSection[]; tracks: Record<string, Track> };

/** Maps /me/stream and /charts's mixed shelves (tracks and playlists) into
 * uniform Collection cards, matching ytmusic.ts's mapHomeResponse. Bare
 * tracks become a synthetic single-track "sc:song-<id>" collection so the
 * card grid doesn't need a separate code path for them. */
export function mapHomeResponse(raw: { sections: { title: string; items: unknown[] }[] }): HomeResult {
  const tracks: Record<string, Track> = {};
  const sections: HomeSection[] = [];

  for (const shelf of raw.sections ?? []) {
    const items: Collection[] = [];
    for (const entry of shelf.items ?? []) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      if (item.kind === "playlist" || item.tracks !== undefined) {
        items.push(mapCollection(item));
      } else {
        const track = mapTrack(item);
        tracks[track.id] = track;
        items.push({
          id: `${SC_ID_PREFIX}song-${item.id}`,
          title: track.title,
          subtitle: track.artist,
          kind: "playlist",
          trackIds: [track.id],
          thumbnail: track.thumbnail,
        });
      }
    }
    if (items.length > 0) sections.push({ title: shelf.title, items });
  }

  return { sections, tracks };
}

export async function getHome(): Promise<HomeResult> {
  return mapHomeResponse(await rawGetHome());
}

export async function getLibraryPlaylists(): Promise<Collection[]> {
  const raw = await rawGetLibraryPlaylists();
  return raw.filter((r): r is Record<string, unknown> => Boolean(r)).map(mapCollection);
}

export async function getLibraryLikes(): Promise<Track[]> {
  const raw = await rawGetLibraryLikes();
  return raw.filter((r): r is Record<string, unknown> => Boolean(r)).map(mapTrack);
}

export type Following = { username: string; avatarUrl?: string; permalinkUrl?: string };

export async function getLibraryFollowings(): Promise<Following[]> {
  const raw = await rawGetLibraryFollowings();
  return raw
    .filter((r): r is Record<string, unknown> => Boolean(r))
    .map((r) => ({
      username: (r.username as string) ?? "Unknown",
      avatarUrl: bestArtwork(r.avatar_url, undefined),
      permalinkUrl: r.permalink_url as string | undefined,
    }));
}

export type PlaylistDetail = {
  id: string;
  title: string;
  description: string;
  privacy: PlaylistPrivacy;
  owned: boolean;
  thumbnail?: string;
  permalinkUrl?: string;
  tracks: Track[];
};

export async function getPlaylistDetail(playlistId: string): Promise<PlaylistDetail> {
  const rawId = playlistId.startsWith(SC_ID_PREFIX) ? playlistId.slice(SC_ID_PREFIX.length) : playlistId;
  const raw = await rawGetPlaylist(rawId);
  const rawTracks = Array.isArray(raw.tracks) ? raw.tracks : [];
  return {
    id: `${SC_ID_PREFIX}${raw.id ?? rawId}`,
    title: (raw.title as string) ?? "Untitled",
    description: (raw.description as string) ?? "",
    privacy: raw.privacy === "PUBLIC" ? "PUBLIC" : "PRIVATE",
    owned: raw.owned === true,
    thumbnail: raw.thumbnail as string | undefined,
    permalinkUrl: raw.permalinkUrl as string | undefined,
    tracks: rawTracks.filter((r): r is Record<string, unknown> => Boolean(r)).map(mapTrack),
  };
}

// ---- playlist mutations ------------------------------------------------

function stripPrefix(id: string): string {
  return id.startsWith(SC_ID_PREFIX) ? id.slice(SC_ID_PREFIX.length) : id;
}

export async function createPlaylist(
  title: string,
  trackIds: string[] = [],
  description = "",
  privacy: PlaylistPrivacy = "PRIVATE",
): Promise<string> {
  const res = await invoke<{ playlistId: string }>("sc_create_playlist", {
    title,
    description,
    trackIds: trackIds.map(stripPrefix),
    privacy,
  });
  return `${SC_ID_PREFIX}${res.playlistId}`;
}

export async function editPlaylist(
  playlistId: string,
  changes: { title?: string; description?: string; privacy?: PlaylistPrivacy },
): Promise<void> {
  await invoke("sc_edit_playlist", {
    playlistId: stripPrefix(playlistId),
    title: changes.title ?? null,
    description: changes.description ?? null,
    privacy: changes.privacy ?? null,
  });
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  await invoke("sc_delete_playlist", { playlistId: stripPrefix(playlistId) });
}

export async function addPlaylistItems(playlistId: string, trackIds: string[]): Promise<void> {
  await invoke("sc_add_playlist_items", {
    playlistId: stripPrefix(playlistId),
    trackIds: trackIds.map(stripPrefix),
  });
}

export async function removePlaylistItems(playlistId: string, trackIds: string[]): Promise<void> {
  await invoke("sc_remove_playlist_items", {
    playlistId: stripPrefix(playlistId),
    trackIds: trackIds.map(stripPrefix),
  });
}

export async function reorderPlaylistItems(playlistId: string, orderedTrackIds: string[]): Promise<void> {
  await invoke("sc_reorder_playlist_items", {
    playlistId: stripPrefix(playlistId),
    orderedTrackIds: orderedTrackIds.map(stripPrefix),
  });
}

export async function searchTracks(query: string): Promise<Track[]> {
  const raw = await rawSearch(query);
  return raw.filter((r): r is Record<string, unknown> => Boolean(r) && (r as Record<string, unknown>).id != null).map(mapTrack);
}
