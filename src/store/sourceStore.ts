import { create } from "zustand";

export type MusicSource = "youtube" | "local";

const STORAGE_KEY = "tunebox:active-source";

type SourceStore = {
  active: MusicSource;
  init: () => void;
  setActive: (source: MusicSource) => void;
};

function isSource(value: string | null): value is MusicSource {
  return value === "youtube" || value === "local";
}

export const useSourceStore = create<SourceStore>((set) => ({
  active: "youtube",

  init: () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isSource(stored)) set({ active: stored });
  },

  setActive: (source) => {
    localStorage.setItem(STORAGE_KEY, source);
    set({ active: source });
  },
}));
