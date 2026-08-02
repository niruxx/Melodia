import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "./playerStore";
import { toast } from "./toastStore";

const FADE_MS_KEY = "melodia:fade-ms";
const EQ_BANDS_KEY = "melodia:eq-bands";
const BACKGROUND_KEY = "melodia:run-in-background";
const QUALITY_KEY = "melodia:stream-quality";
const OUTPUT_KEY = "melodia:output-device";
const DEFAULT_FADE_MS = 400;

/** Must match `BAND_FREQS_HZ` in `src-tauri/src/equalizer.rs`. */
export const EQ_BAND_FREQS_HZ = [60, 250, 1000, 4000, 12000] as const;
export const EQ_BAND_COUNT = EQ_BAND_FREQS_HZ.length;
const FLAT_EQ = new Array(EQ_BAND_COUNT).fill(0);

/** Gains in dB, one per band in `EQ_BAND_FREQS_HZ` order. */
export const EQ_PRESETS: readonly { name: string; gains: readonly number[] }[] = [
  { name: "Flat", gains: [0, 0, 0, 0, 0] },
  { name: "Bass boost", gains: [6, 3, 0, 0, 1] },
  { name: "Treble boost", gains: [0, 0, 0, 4, 6] },
  { name: "Vocal", gains: [-2, 0, 4, 3, 0] },
  { name: "Rock", gains: [4, 2, -1, 3, 4] },
  { name: "Electronic", gains: [5, 2, -1, 2, 5] },
  { name: "Podcast", gains: [-3, 1, 5, 3, -1] },
  { name: "Late night", gains: [-4, 0, 3, 1, -2] },
];

/**
 * YouTube Music has no lossless tier — its best is roughly 256 kbps AAC/Opus.
 * These trade bandwidth against fidelity within that ceiling; true lossless is
 * only reachable through the local library.
 */
export type StreamQuality = "best" | "high" | "low";

export const STREAM_QUALITIES: readonly { id: StreamQuality; label: string; hint: string }[] = [
  // A free account tops out near 130 kbps, so "Best" and "Balanced" resolve to
  // the same stream there; the cap only bites on Premium's 256 kbps tier.
  { id: "best", label: "Best", hint: "Highest available (~130, or ~256 with Premium)" },
  { id: "high", label: "Balanced", hint: "Caps at 160 kbps" },
  { id: "low", label: "Data saver", hint: "Caps at 70 kbps" },
];

export type OutputDevice = { id: string; name: string; isDefault: boolean };

/** What the engine actually served for the current track. */
export type StreamFormat = { ext: string | null; abr: number | null; acodec: string | null };

type AudioSettingsStore = {
  fadeMs: number;
  eqBands: number[];
  /** Epoch ms at which playback should pause, or null when no timer is set. */
  sleepTimerEndsAt: number | null;
  /** Keep running (and playing) in the tray when the window is closed. */
  runInBackground: boolean;

  streamQuality: StreamQuality;
  /** cpal device id, or null to follow the system default. */
  outputDeviceId: string | null;
  outputDevices: OutputDevice[];

  init: () => void;
  setFadeMs: (ms: number) => void;
  setEqBand: (index: number, db: number) => void;
  applyEqPreset: (gains: readonly number[]) => void;
  resetEq: () => void;
  setRunInBackground: (value: boolean) => void;
  setStreamQuality: (quality: StreamQuality) => void;
  refreshOutputDevices: () => Promise<void>;
  setOutputDevice: (id: string | null) => Promise<void>;
  startSleepTimer: (minutes: number) => void;
  cancelSleepTimer: () => void;
};

let sleepTimeout: ReturnType<typeof setTimeout> | null = null;

export const useAudioSettingsStore = create<AudioSettingsStore>((set, get) => ({
  fadeMs: DEFAULT_FADE_MS,
  eqBands: FLAT_EQ,
  sleepTimerEndsAt: null,
  runInBackground: false,
  streamQuality: "best",
  outputDeviceId: null,
  outputDevices: [],

  init: () => {
    const rawFade = localStorage.getItem(FADE_MS_KEY);
    const storedFade = rawFade === null ? NaN : Number(rawFade);
    const fadeMs = Number.isFinite(storedFade) && storedFade >= 0 ? storedFade : DEFAULT_FADE_MS;

    let eqBands = FLAT_EQ;
    const rawEq = localStorage.getItem(EQ_BANDS_KEY);
    if (rawEq) {
      try {
        const parsed = JSON.parse(rawEq);
        if (Array.isArray(parsed) && parsed.length === EQ_BAND_COUNT && parsed.every((n) => Number.isFinite(n))) {
          eqBands = parsed;
        }
      } catch {
        // ignore corrupt value, fall back to flat
      }
    }

    const runInBackground = localStorage.getItem(BACKGROUND_KEY) === "true";

    const rawQuality = localStorage.getItem(QUALITY_KEY);
    const streamQuality = STREAM_QUALITIES.some((q) => q.id === rawQuality)
      ? (rawQuality as StreamQuality)
      : "best";
    const outputDeviceId = localStorage.getItem(OUTPUT_KEY);

    set({ fadeMs, eqBands, runInBackground, streamQuality, outputDeviceId });
    invoke("playback_set_fade_ms", { ms: fadeMs }).catch(() => {});
    invoke("playback_set_eq", { bands: eqBands }).catch(() => {});
    // Rust owns this at close time, so it must be told the stored value even
    // when nothing has changed this session.
    invoke("set_background_mode", { enabled: runInBackground }).catch(() => {});

    if (outputDeviceId) {
      // A saved device may have been unplugged since; fall back to the system
      // default rather than leaving playback pointed at something absent.
      invoke("playback_set_output", { deviceId: outputDeviceId }).catch(() => {
        localStorage.removeItem(OUTPUT_KEY);
        set({ outputDeviceId: null });
        toast.info("Your saved audio output isn't available — using the system default.");
      });
    }
    void get().refreshOutputDevices();
  },

  setFadeMs: (ms) => {
    const clamped = Math.min(3000, Math.max(0, Math.round(ms)));
    localStorage.setItem(FADE_MS_KEY, String(clamped));
    set({ fadeMs: clamped });
    invoke("playback_set_fade_ms", { ms: clamped }).catch(() => {});
  },

  setEqBand: (index, db) => {
    const clamped = Math.min(12, Math.max(-12, db));
    const eqBands = get().eqBands.slice();
    eqBands[index] = clamped;
    localStorage.setItem(EQ_BANDS_KEY, JSON.stringify(eqBands));
    set({ eqBands });
    invoke("playback_set_eq", { bands: eqBands }).catch(() => {});
  },

  applyEqPreset: (gains) => {
    if (gains.length !== EQ_BAND_COUNT) return;
    const eqBands = gains.map((g) => Math.min(12, Math.max(-12, g)));
    localStorage.setItem(EQ_BANDS_KEY, JSON.stringify(eqBands));
    set({ eqBands });
    invoke("playback_set_eq", { bands: eqBands }).catch(() => {});
  },

  resetEq: () => {
    localStorage.setItem(EQ_BANDS_KEY, JSON.stringify(FLAT_EQ));
    set({ eqBands: FLAT_EQ });
    invoke("playback_set_eq", { bands: FLAT_EQ }).catch(() => {});
  },

  setStreamQuality: (quality) => {
    localStorage.setItem(QUALITY_KEY, quality);
    set({ streamQuality: quality });
  },

  refreshOutputDevices: async () => {
    try {
      const devices = await invoke<{ id: string; name: string; is_default: boolean }[]>(
        "playback_list_outputs",
      );
      set({
        outputDevices: devices.map((d) => ({
          id: d.id,
          name: d.name,
          isDefault: d.is_default,
        })),
      });
    } catch {
      set({ outputDevices: [] });
    }
  },

  setOutputDevice: async (id) => {
    if (id) {
      localStorage.setItem(OUTPUT_KEY, id);
    } else {
      localStorage.removeItem(OUTPUT_KEY);
    }
    set({ outputDeviceId: id });
    try {
      await invoke("playback_set_output", { deviceId: id });
    } catch (e) {
      toast.error(String(e));
    }
  },

  setRunInBackground: (value) => {
    localStorage.setItem(BACKGROUND_KEY, String(value));
    set({ runInBackground: value });
    invoke("set_background_mode", { enabled: value }).catch(() => {});
  },

  startSleepTimer: (minutes) => {
    if (sleepTimeout) clearTimeout(sleepTimeout);
    const ms = Math.max(1, minutes) * 60_000;
    set({ sleepTimerEndsAt: Date.now() + ms });
    sleepTimeout = setTimeout(() => {
      sleepTimeout = null;
      set({ sleepTimerEndsAt: null });
      // Deliberately routed through the store's own pause path so the
      // configured fade-out applies instead of cutting the audio dead.
      const player = usePlayerStore.getState();
      if (player.isPlaying) player.togglePlay();
      toast.info("Sleep timer ended — playback paused");
    }, ms);
  },

  cancelSleepTimer: () => {
    if (sleepTimeout) clearTimeout(sleepTimeout);
    sleepTimeout = null;
    set({ sleepTimerEndsAt: null });
  },
}));
