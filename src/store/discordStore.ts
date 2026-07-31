import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

const STORAGE_KEY = "tunebox:discord";

type StoredSettings = { enabled: boolean; appId: string };

function loadSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoredSettings;
  } catch {
    // ignore malformed storage
  }
  return { enabled: false, appId: "" };
}

function saveSettings(settings: StoredSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

type DiscordStore = {
  enabled: boolean;
  appId: string;
  connected: boolean;
  error: string | null;
  isSettingsOpen: boolean;

  init: () => Promise<void>;
  enable: (appId: string) => Promise<void>;
  disable: () => Promise<void>;
  updatePresence: (title: string, artist: string, thumbnail?: string) => Promise<void>;
  openSettings: () => void;
  closeSettings: () => void;
};

export const useDiscordStore = create<DiscordStore>((set, get) => ({
  enabled: false,
  appId: "",
  connected: false,
  error: null,
  isSettingsOpen: false,

  openSettings: () => set({ isSettingsOpen: true }),
  closeSettings: () => set({ isSettingsOpen: false }),

  init: async () => {
    const settings = loadSettings();
    set({ enabled: settings.enabled, appId: settings.appId });
    if (settings.enabled && settings.appId) {
      try {
        await invoke("discord_connect", { appId: settings.appId });
        set({ connected: true, error: null });
      } catch (e) {
        set({ connected: false, error: String(e) });
      }
    }
  },

  enable: async (appId) => {
    set({ error: null });
    await invoke("discord_connect", { appId });
    saveSettings({ enabled: true, appId });
    set({ enabled: true, appId, connected: true });
  },

  disable: async () => {
    await invoke("discord_disconnect").catch(() => {});
    saveSettings({ enabled: false, appId: get().appId });
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
