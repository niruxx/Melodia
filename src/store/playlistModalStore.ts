import { create } from "zustand";
import type { Collection, Track } from "../lib/types";

/** Create mode can carry tracks to drop into the playlist right after it exists. */
export type PlaylistForm =
  | { mode: "create"; tracks: Track[] }
  | { mode: "edit"; collection: Collection };

type PlaylistModalStore = {
  form: PlaylistForm | null;
  /** Tracks waiting for the user to pick a destination playlist. */
  pendingAdd: Track[] | null;

  openCreate: (tracks?: Track[]) => void;
  openEdit: (collection: Collection) => void;
  closeForm: () => void;

  openAddTo: (tracks: Track[]) => void;
  closeAddTo: () => void;
};

export const usePlaylistModalStore = create<PlaylistModalStore>((set) => ({
  form: null,
  pendingAdd: null,

  openCreate: (tracks = []) => set({ form: { mode: "create", tracks }, pendingAdd: null }),
  openEdit: (collection) => set({ form: { mode: "edit", collection } }),
  closeForm: () => set({ form: null }),

  openAddTo: (tracks) => set({ pendingAdd: tracks }),
  closeAddTo: () => set({ pendingAdd: null }),
}));
