import { create } from "zustand";
import * as ytmusic from "../lib/ytmusic";
import type { HomeSection } from "../lib/ytmusic";
import type { Collection, Track } from "../lib/types";

type Section<T> = { data: T | null; loading: boolean; error: string | null };

function loadingSection<T>(): Section<T> {
  return { data: null, loading: true, error: null };
}

function emptySection<T>(): Section<T> {
  return { data: null, loading: false, error: null };
}

type LibraryStore = {
  home: Section<HomeSection[]>;
  playlists: Section<Collection[]>;
  albums: Section<Collection[]>;
  history: Section<Track[]>;
  trackCache: Record<string, Track>;
  playlistTracksCache: Record<string, Track[]>;

  fetchAll: () => void;
  getPlaylistTracks: (id: string) => Promise<Track[]>;
  findCollection: (id: string) => Collection | undefined;
  reset: () => void;
};

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  home: emptySection(),
  playlists: emptySection(),
  albums: emptySection(),
  history: emptySection(),
  trackCache: {},
  playlistTracksCache: {},

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

  getPlaylistTracks: async (id) => {
    if (id.startsWith("song-")) {
      const track = get().trackCache[id.slice("song-".length)];
      return track ? [track] : [];
    }
    const cached = get().playlistTracksCache[id];
    if (cached) return cached;
    const tracks = await ytmusic.getPlaylistTracks(id);
    set((s) => ({ playlistTracksCache: { ...s.playlistTracksCache, [id]: tracks } }));
    return tracks;
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
    const fromPlaylists = state.playlists.data?.find((c) => c.id === id);
    if (fromPlaylists) return fromPlaylists;
    const fromAlbums = state.albums.data?.find((c) => c.id === id);
    if (fromAlbums) return fromAlbums;
    for (const section of state.home.data ?? []) {
      const found = section.items.find((c) => c.id === id);
      if (found) return found;
    }
    return undefined;
  },

  reset: () =>
    set({
      home: emptySection(),
      playlists: emptySection(),
      albums: emptySection(),
      history: emptySection(),
      trackCache: {},
      playlistTracksCache: {},
    }),
}));
