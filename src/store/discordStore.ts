import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { DISCORD_APP_ID } from "../lib/discordConfig";

const STORAGE_KEY = "melodia:discord-enabled";

type DiscordStore = {
  enabled: boolean;
  connected: boolean;
  error: string | null;
  isSettingsOpen: boolean;

  init: () => Promise<void>;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  updatePresence: (title: string, artist: string, thumbnail?: string) => Promise<void>;
  openSettings: () => void;
  closeSettings: () => void;
};

export const useDiscordStore = create<DiscordStore>((set, get) => ({
  enabled: false,
  connected: false,
  error: null,
  isSettingsOpen: false,

  openSettings: () => set({ isSettingsOpen: true }),
  closeSettings: () => set({ isSettingsOpen: false }),

  init: async () => {
    const wasEnabled = localStorage.getItem(STORAGE_KEY) === "true";
    set({ enabled: wasEnabled });
    if (wasEnabled) {
      try {
        await invoke("discord_connect", { appId: DISCORD_APP_ID });
        set({ connected: true, error: null });
      } catch (e) {
        set({ connected: false, error: String(e) });
      }
    }
  },

  enable: async () => {
    set({ error: null });
    try {
      await invoke("discord_connect", { appId: DISCORD_APP_ID });
      localStorage.setItem(STORAGE_KEY, "true");
      set({ enabled: true, connected: true });
    } catch (e) {
      set({ enabled: false, connected: false, error: String(e) });
    }
  },

  disable: async () => {
    await invoke("discord_disconnect").catch(() => {});
    localStorage.setItem(STORAGE_KEY, "false");
    set({ enabled: false, connected: false });
  },

  updatePresence: async (title, artist, thumbnail) => {
    if (!get().enabled || !get().connected) return;
    try {
      await invoke("discord_update_presence", { title, artist, thumbnail: thumbnail ?? null });
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
