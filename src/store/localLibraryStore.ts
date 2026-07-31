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
  const byAlbum = new Map<string, Track[]>();
  for (const track of tracks) {
    const key = track.album || "Unknown Album";
    const list = byAlbum.get(key) ?? [];
    list.push(track);
    byAlbum.set(key, list);
  }
  return Array.from(byAlbum.entries()).map(([album, albumTracks]) => ({
    id: `local-album:${album}`,
    title: album,
    subtitle: albumTracks[0]?.artist ?? "",
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
