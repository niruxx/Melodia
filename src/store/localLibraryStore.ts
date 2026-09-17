import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Collection, Track } from "../lib/types";

type LocalLibraryStore = {
  folder: string | null;
  tracks: Track[];
  albums: Collection[];
  loading: boolean;
  error: string | null;

  init: () => Promise<void>;
  pickFolder: () => Promise<void>;
  scan: () => Promise<void>;
};

function groupIntoAlbums(tracks: Track[]): Collection[] {
  // Keyed by album artist as well as title: "Greatest Hits" and "Live" are
  // common enough that grouping on the title alone merges unrelated albums
  // into one. Falling back to the track artist keeps untagged files working.
  const byAlbum = new Map<string, { album: string; artist: string; tracks: Track[] }>();
  for (const track of tracks) {
    const album = track.album || "Unknown Album";
    const artist = track.albumArtist || track.artist || "";
    // JSON rather than a joined string so an artist or album containing the
    // separator can't collide with a different pair.
    const key = JSON.stringify([artist.toLowerCase(), album.toLowerCase()]);
    const entry = byAlbum.get(key) ?? { album, artist, tracks: [] };
    entry.tracks.push(track);
    byAlbum.set(key, entry);
  }
  return Array.from(byAlbum.entries()).map(([key, { album, artist, tracks: albumTracks }]) => ({
    id: `local-album:${key}`,
    title: album,
    subtitle: artist,
    kind: "album" as const,
    trackIds: albumTracks.map((t) => t.id),
    thumbnail: albumTracks.find((t) => t.thumbnail)?.thumbnail,
  }));
}

export const useLocalLibraryStore = create<LocalLibraryStore>((set, get) => ({
  folder: null,
  tracks: [],
  albums: [],
  loading: false,
  error: null,

  init: async () => {
    try {
      const folder = await invoke<string | null>("local_get_folder");
      set({ folder });
      if (folder) await get().scan();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  pickFolder: async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    await invoke("local_set_folder", { folder: selected });
    set({ folder: selected });
    await get().scan();
  },

  scan: async () => {
    set({ loading: true, error: null });
    try {
      const tracks = await invoke<Track[]>("local_scan");
      set({ tracks, albums: groupIntoAlbums(tracks), loading: false });
    } catch (e) {
      set({ error: String(e), loading: false, tracks: [], albums: [] });
    }
  },
}));
