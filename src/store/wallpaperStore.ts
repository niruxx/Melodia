import { create } from "zustand";

const ENABLED_KEY = "melodia:wallpaper";

type WallpaperStore = {
  /** Off unless deliberately switched on — it changes the look of everything. */
  enabled: boolean;
  init: () => void;
  setEnabled: (value: boolean) => void;
};

export const useWallpaperStore = create<WallpaperStore>((set) => ({
  enabled: false,

  // Only an explicit "true" counts, so a missing or junk value stays off.
  init: () => set({ enabled: localStorage.getItem(ENABLED_KEY) === "true" }),

  setEnabled: (value) => {
    localStorage.setItem(ENABLED_KEY, String(value));
    set({ enabled: value });
  },
}));
