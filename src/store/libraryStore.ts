import { create } from "zustand";
import * as ytmusic from "../lib/ytmusic";
import type { HomeSection, PlaylistDetail } from "../lib/ytmusic";
import type { Collection, PlaylistPrivacy, Track } from "../lib/types";

type Section<T> = { data: T | null; loading: boolean; error: string | null };

function loadingSection<T>(): Section<T> {
  return { data: null, loading: true, error: null };
}

function emptySection<T>(): Section<T> {
  return { data: null, loading: false, error: null };
}

/**
 * Given two orderings of the same tracks, returns where the dragged track
 * landed in `next` — or null if nothing actually moved.
 *
 * A single move leaves the array untouched outside one contiguous run, so the
 * first and last differing indices bracket it: the moved track is at whichever
 * end of that run it wasn't at before. An adjacent swap is ambiguous (either
 * track can be called the mover), but both readings reproduce the same final
 * order, so either answer is correct.
 */
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

export type PlaylistChanges = {
  title?: string;
  description?: string;
  privacy?: PlaylistPrivacy;
};

type LibraryStore = {
  home: Section<HomeSection[]>;
  playlists: Section<Collection[]>;
  albums: Section<Collection[]>;
  history: Section<Track[]>;
  trackCache: Record<string, Track>;
  playlistCache: Record<string, PlaylistDetail>;

  fetchAll: () => void;
  refreshPlaylists: () => Promise<void>;
  getPlaylistDetail: (id: string, opts?: { force?: boolean }) => Promise<PlaylistDetail | null>;
  getPlaylistTracks: (id: string) => Promise<Track[]>;
  findCollection: (id: string) => Collection | undefined;

  createPlaylist: (title: string, description?: string, privacy?: PlaylistPrivacy) => Promise<string>;
  editPlaylist: (id: string, changes: PlaylistChanges) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  addTracksToPlaylist: (id: string, tracks: Track[]) => Promise<void>;
  removeTrackFromPlaylist: (id: string, track: Track) => Promise<void>;
  reorderPlaylistTracks: (id: string, tracks: Track[]) => Promise<void>;

  reset: () => void;
};

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  home: emptySection(),
  playlists: emptySection(),
  albums: emptySection(),
  history: emptySection(),
  trackCache: {},
  playlistCache: {},

  fetchAll: () => {
    set({
      home: loadingSection(),
      playlists: loadingSection(),
      albums: loadingSection(),
      history: loadingSection(),
    });

    ytmusic
      .getHome()
      .then(({ sections, tracks }) => {
        set((s) => ({
          home: { data: sections, loading: false, error: null },
          trackCache: { ...s.trackCache, ...tracks },
        }));
      })
      .catch((e) => set({ home: { data: null, loading: false, error: String(e) } }));

    ytmusic
      .getLibraryPlaylists()
      .then((data) => set({ playlists: { data, loading: false, error: null } }))
      .catch((e) => set({ playlists: { data: null, loading: false, error: String(e) } }));

    ytmusic
      .getLibraryAlbums()
      .then((data) => set({ albums: { data, loading: false, error: null } }))
      .catch((e) => set({ albums: { data: null, loading: false, error: String(e) } }));

    ytmusic
      .getHistory()
      .then((data) =>
        set((s) => ({
          history: { data, loading: false, error: null },
          trackCache: { ...s.trackCache, ...Object.fromEntries(data.map((t) => [t.id, t])) },
        })),
      )
      .catch((e) => set({ history: { data: null, loading: false, error: String(e) } }));
  },

  refreshPlaylists: async () => {
    try {
      const data = await ytmusic.getLibraryPlaylists();
      set({ playlists: { data, loading: false, error: null } });
    } catch (e) {
      set({ playlists: { data: null, loading: false, error: String(e) } });
    }
  },

  /** Null for the synthetic `song-<videoId>` collections, which aren't real playlists. */
  getPlaylistDetail: async (id, opts) => {
    if (id.startsWith("song-")) return null;
    if (!opts?.force) {
      const cached = get().playlistCache[id];
      if (cached) return cached;
    }
    const detail = await ytmusic.getPlaylistDetail(id);
    set((s) => ({ playlistCache: { ...s.playlistCache, [id]: detail } }));
    return detail;
  },

  getPlaylistTracks: async (id) => {
    if (id.startsWith("song-")) {
      const track = get().trackCache[id.slice("song-".length)];
      return track ? [track] : [];
    }
    const detail = await get().getPlaylistDetail(id);
    return detail?.tracks ?? [];
  },

  findCollection: (id) => {
    const state = get();
    if (id.startsWith("song-")) {
      const track = state.trackCache[id.slice("song-".length)];
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

    let base: Collection | undefined =
      state.playlists.data?.find((c) => c.id === id) ?? state.albums.data?.find((c) => c.id === id);
    if (!base) {
      for (const section of state.home.data ?? []) {
        const found = section.items.find((c) => c.id === id);
        if (found) {
          base = found;
          break;
        }
      }
    }

    // The detail fetch is the only source of `owned`/privacy, and it also
    // carries the freshest title after an edit — so it wins where present.
    const detail = state.playlistCache[id];
    if (!detail) return base;
    return {
      id,
      // Radio mixes come back unnamed, so the card's own title stands in.
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

  createPlaylist: async (title, description = "", privacy = "PRIVATE") => {
    const id = await ytmusic.createPlaylist(title, description, privacy);
    await get().refreshPlaylists();
    return id;
  },

  editPlaylist: async (id, changes) => {
    await ytmusic.editPlaylist(id, changes);
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
    await ytmusic.deletePlaylist(id);
    set((s) => {
      const { [id]: _removed, ...playlistCache } = s.playlistCache;
      return {
        playlistCache,
        playlists: { ...s.playlists, data: s.playlists.data?.filter((c) => c.id !== id) ?? null },
      };
    });
  },

  addTracksToPlaylist: async (id, tracks) => {
    await ytmusic.addPlaylistItems(
      id,
      tracks.map((t) => t.id),
    );
    // The new entries' setVideoIds only come from the server, so re-fetch
    // rather than appending locally — otherwise they can't be removed again.
    await get().getPlaylistDetail(id, { force: true });
  },

  removeTrackFromPlaylist: async (id, track) => {
    if (!track.setVideoId) throw new Error("this song can't be removed from the playlist");
    await ytmusic.removePlaylistItems(id, [{ videoId: track.id, setVideoId: track.setVideoId }]);
    set((s) => {
      const detail = s.playlistCache[id];
      if (!detail) return {};
      return {
        playlistCache: {
          ...s.playlistCache,
          [id]: {
            ...detail,
            tracks: detail.tracks.filter((t) => t.setVideoId !== track.setVideoId),
          },
        },
      };
    });
  },

  /**
   * Commits a drag-reorder. The new order is applied to the cache up front so
   * the list doesn't snap back while the request is in flight, and rolled back
   * if YouTube rejects it.
   */
  reorderPlaylistTracks: async (id, tracks) => {
    const detail = get().playlistCache[id];
    if (!detail) return;

    const previous = detail.tracks;
    const movedIndex = findMovedIndex(previous, tracks);
    if (movedIndex === null) return;

    const moved = tracks[movedIndex];
    if (!moved.setVideoId) throw new Error("this song can't be reordered");

    const applyOrder = (ordered: Track[]) =>
      set((s) => {
        const current = s.playlistCache[id];
        if (!current) return {};
        return { playlistCache: { ...s.playlistCache, [id]: { ...current, tracks: ordered } } };
      });

    applyOrder(tracks);
    try {
      // A null successor means "move to the end"; setVideoIds identify the
      // playlist entry rather than its slot, so they survive the move.
      await ytmusic.movePlaylistItem(id, moved.setVideoId, tracks[movedIndex + 1]?.setVideoId ?? null);
    } catch (e) {
      applyOrder(previous);
      throw e;
    }
  },

  reset: () =>
    set({
      home: emptySection(),
      playlists: emptySection(),
      albums: emptySection(),
      history: emptySection(),
      trackCache: {},
      playlistCache: {},
    }),
}));
