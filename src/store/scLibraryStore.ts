import { create } from "zustand";
import * as soundcloud from "../lib/soundcloud";
import type { Following, HomeSection, PlaylistDetail } from "../lib/soundcloud";
import type { Collection, PlaylistPrivacy, Track } from "../lib/types";

type Section<T> = { data: T | null; loading: boolean; error: string | null };

function loadingSection<T>(): Section<T> {
  return { data: null, loading: true, error: null };
}

function emptySection<T>(): Section<T> {
  return { data: null, loading: false, error: null };
}

/** Same "which track moved" logic as libraryStore.ts's findMovedIndex —
 * duplicated rather than shared, since the two providers' reorder wire
 * formats differ (setVideoId handles vs. a full replacement array) even
 * though the drag-and-drop math they feed is identical. */
function findMovedIndex(prev: Track[], next: Track[]): number | null {
  if (prev.length !== next.length) return null;

  let first = -1;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i] !== next[i]) {
      first = i;
      break;
    }
  }
  if (first === -1) return null;

  let last = prev.length - 1;
  while (last > first && prev[last] === next[last]) last--;

  return next[first] === prev[last] ? first : last;
}

export type ScPlaylistChanges = {
  title?: string;
  description?: string;
  privacy?: PlaylistPrivacy;
};

type ScLibraryStore = {
  home: Section<HomeSection[]>;
  playlists: Section<Collection[]>;
  likes: Section<Track[]>;
  followings: Section<Following[]>;
  trackCache: Record<string, Track>;
  playlistCache: Record<string, PlaylistDetail>;
  arrivedId: string | null;

  fetchAll: () => void;
  clearArrived: () => void;
  refreshPlaylists: () => Promise<void>;
  getPlaylistDetail: (id: string, opts?: { force?: boolean }) => Promise<PlaylistDetail | null>;
  getPlaylistTracks: (id: string) => Promise<Track[]>;
  findCollection: (id: string) => Collection | undefined;

  createPlaylist: (title: string, trackIds?: string[], description?: string, privacy?: PlaylistPrivacy) => Promise<string>;
  editPlaylist: (id: string, changes: ScPlaylistChanges) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  addTracksToPlaylist: (id: string, tracks: Track[]) => Promise<void>;
  removeTrackFromPlaylist: (id: string, track: Track) => Promise<void>;
  reorderPlaylistTracks: (id: string, tracks: Track[]) => Promise<void>;

  reset: () => void;
};

export const useScLibraryStore = create<ScLibraryStore>((set, get) => ({
  home: emptySection(),
  playlists: emptySection(),
  likes: emptySection(),
  followings: emptySection(),
  trackCache: {},
  playlistCache: {},
  arrivedId: null,

  clearArrived: () => set({ arrivedId: null }),

  fetchAll: () => {
    set({
      home: loadingSection(),
      playlists: loadingSection(),
      likes: loadingSection(),
      followings: loadingSection(),
    });

    soundcloud
      .getHome()
      .then(({ sections, tracks }) => {
        set((s) => ({
          home: { data: sections, loading: false, error: null },
          trackCache: { ...s.trackCache, ...tracks },
        }));
      })
      .catch((e) => set({ home: { data: null, loading: false, error: String(e) } }));

    soundcloud
      .getLibraryPlaylists()
      .then((data) => set({ playlists: { data, loading: false, error: null } }))
      .catch((e) => set({ playlists: { data: null, loading: false, error: String(e) } }));

    soundcloud
      .getLibraryLikes()
      .then((data) =>
        set((s) => ({
          likes: { data, loading: false, error: null },
          trackCache: { ...s.trackCache, ...Object.fromEntries(data.map((t) => [t.id, t])) },
        })),
      )
      .catch((e) => set({ likes: { data: null, loading: false, error: String(e) } }));

    soundcloud
      .getLibraryFollowings()
      .then((data) => set({ followings: { data, loading: false, error: null } }))
      .catch((e) => set({ followings: { data: null, loading: false, error: String(e) } }));
  },

  refreshPlaylists: async () => {
    try {
      const data = await soundcloud.getLibraryPlaylists();
      set({ playlists: { data, loading: false, error: null } });
    } catch (e) {
      set({ playlists: { data: null, loading: false, error: String(e) } });
    }
  },

  /** Null for the synthetic "sc:song-<id>" collections, which aren't real playlists. */
  getPlaylistDetail: async (id, opts) => {
    if (id.startsWith(`${soundcloud.SC_ID_PREFIX}song-`)) return null;
    if (!opts?.force) {
      const cached = get().playlistCache[id];
      if (cached) return cached;
    }
    const detail = await soundcloud.getPlaylistDetail(id);
    set((s) => ({ playlistCache: { ...s.playlistCache, [id]: detail } }));
    return detail;
  },

  getPlaylistTracks: async (id) => {
    if (id.startsWith(`${soundcloud.SC_ID_PREFIX}song-`)) {
      const track = get().trackCache[id.slice(`${soundcloud.SC_ID_PREFIX}song-`.length)];
      return track ? [track] : [];
    }
    const detail = await get().getPlaylistDetail(id);
    return detail?.tracks ?? [];
  },

  findCollection: (id) => {
    const state = get();
    const songPrefix = `${soundcloud.SC_ID_PREFIX}song-`;
    if (id.startsWith(songPrefix)) {
      const track = state.trackCache[id.slice(songPrefix.length)];
      if (!track) return undefined;
      return {
        id,
        title: track.title,
        subtitle: track.artist,
        kind: "playlist",
        trackIds: [track.id],
        thumbnail: track.thumbnail,
      };
    }

    let base: Collection | undefined = state.playlists.data?.find((c) => c.id === id);
    if (!base) {
      for (const section of state.home.data ?? []) {
        const found = section.items.find((c) => c.id === id);
        if (found) {
          base = found;
          break;
        }
      }
    }

    const detail = state.playlistCache[id];
    if (!detail) return base;
    return {
      id,
      title: detail.title || base?.title || "Untitled",
      subtitle: base?.subtitle ?? detail.description,
      kind: base?.kind ?? "playlist",
      trackIds: base?.trackIds ?? [],
      thumbnail: detail.thumbnail ?? base?.thumbnail,
      owned: detail.owned,
      description: detail.description,
      privacy: detail.privacy,
    };
  },

  createPlaylist: async (title, trackIds = [], description = "", privacy = "PRIVATE") => {
    const id = await soundcloud.createPlaylist(title, trackIds, description, privacy);
    set({ arrivedId: id });
    await get().refreshPlaylists();
    return id;
  },

  editPlaylist: async (id, changes) => {
    await soundcloud.editPlaylist(id, changes);
    set((s) => {
      const detail = s.playlistCache[id];
      return {
        playlistCache: detail ? { ...s.playlistCache, [id]: { ...detail, ...changes } } : s.playlistCache,
        playlists: {
          ...s.playlists,
          data:
            s.playlists.data?.map((c) =>
              c.id === id ? { ...c, ...changes, title: changes.title ?? c.title } : c,
            ) ?? null,
        },
      };
    });
  },

  deletePlaylist: async (id) => {
    await soundcloud.deletePlaylist(id);
    set((s) => {
      const { [id]: _removed, ...playlistCache } = s.playlistCache;
      return {
        playlistCache,
        playlists: { ...s.playlists, data: s.playlists.data?.filter((c) => c.id !== id) ?? null },
      };
    });
  },

  addTracksToPlaylist: async (id, tracks) => {
    await soundcloud.addPlaylistItems(
      id,
      tracks.map((t) => t.id),
    );
    await get().getPlaylistDetail(id, { force: true });
  },

  removeTrackFromPlaylist: async (id, track) => {
    await soundcloud.removePlaylistItems(id, [track.id]);
    set((s) => {
      const detail = s.playlistCache[id];
      if (!detail) return {};
      return {
        playlistCache: {
          ...s.playlistCache,
          [id]: { ...detail, tracks: detail.tracks.filter((t) => t.id !== track.id) },
        },
      };
    });
  },

  /**
   * Commits a drag-reorder. The new order is applied to the cache up front so
   * the list doesn't snap back while the request is in flight, and rolled
   * back if SoundCloud rejects it.
   */
  reorderPlaylistTracks: async (id, tracks) => {
    const detail = get().playlistCache[id];
    if (!detail) return;

    const previous = detail.tracks;
    const movedIndex = findMovedIndex(previous, tracks);
    if (movedIndex === null) return;

    const applyOrder = (ordered: Track[]) =>
      set((s) => {
        const current = s.playlistCache[id];
        if (!current) return {};
        return { playlistCache: { ...s.playlistCache, [id]: { ...current, tracks: ordered } } };
      });

    applyOrder(tracks);
    try {
      await soundcloud.reorderPlaylistItems(
        id,
        tracks.map((t) => t.id),
      );
    } catch (e) {
      applyOrder(previous);
      throw e;
    }
  },

  reset: () =>
    set({
      home: emptySection(),
      playlists: emptySection(),
      likes: emptySection(),
      followings: emptySection(),
      trackCache: {},
      playlistCache: {},
      arrivedId: null,
    }),
}));
