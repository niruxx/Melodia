import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

const ENABLED_KEY = "tunebox:video-mode";

export type VideoSource = {
  url: string;
  width: number | null;
  height: number | null;
};

type VideoStore = {
  /** Show the music video behind the now-playing view instead of artwork. */
  enabled: boolean;
  /** Resolved source for the current track, or null while off/unavailable. */
  source: VideoSource | null;
  loadingFor: string | null;
  error: string | null;

  init: () => void;
  setEnabled: (value: boolean) => void;
  load: (videoId: string) => Promise<void>;
  clear: () => void;
};

export const useVideoStore = create<VideoStore>((set, get) => ({
  enabled: false,
  source: null,
  loadingFor: null,
  error: null,

  init: () => set({ enabled: localStorage.getItem(ENABLED_KEY) === "true" }),

  setEnabled: (value) => {
    localStorage.setItem(ENABLED_KEY, String(value));
    set({ enabled: value });
    if (!value) get().clear();
  },

  load: async (videoId) => {
    if (get().loadingFor === videoId) return;
    set({ loadingFor: videoId, error: null, source: null });
    try {
      const res = await invoke<{ url: string; width: number | null; height: number | null }>(
        "ytm_get_video_url",
        { videoId, maxHeight: 1080 },
      );
      // The track changed while this was resolving.
      if (get().loadingFor !== videoId) return;
      if (!res.url) throw new Error("no video stream for this track");
      set({ source: { url: res.url, width: res.width, height: res.height }, loadingFor: null });
    } catch (e) {
      if (get().loadingFor !== videoId) return;
      set({ loadingFor: null, source: null, error: String(e) });
    }
  },

  clear: () => set({ source: null, loadingFor: null, error: null }),
}));
