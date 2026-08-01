import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "./playerStore";
import { toast } from "./toastStore";

const FADE_MS_KEY = "tunebox:fade-ms";
const EQ_BANDS_KEY = "tunebox:eq-bands";
const DEFAULT_FADE_MS = 400;

/** Must match `BAND_FREQS_HZ` in `src-tauri/src/equalizer.rs`. */
export const EQ_BAND_FREQS_HZ = [60, 250, 1000, 4000, 12000] as const;
export const EQ_BAND_COUNT = EQ_BAND_FREQS_HZ.length;
const FLAT_EQ = new Array(EQ_BAND_COUNT).fill(0);

type AudioSettingsStore = {
  fadeMs: number;
  eqBands: number[];
  /** Epoch ms at which playback should pause, or null when no timer is set. */
  sleepTimerEndsAt: number | null;
  init: () => void;
  setFadeMs: (ms: number) => void;
  setEqBand: (index: number, db: number) => void;
  resetEq: () => void;
  startSleepTimer: (minutes: number) => void;
  cancelSleepTimer: () => void;
};

let sleepTimeout: ReturnType<typeof setTimeout> | null = null;

export const useAudioSettingsStore = create<AudioSettingsStore>((set, get) => ({
  fadeMs: DEFAULT_FADE_MS,
  eqBands: FLAT_EQ,
  sleepTimerEndsAt: null,

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

    set({ fadeMs, eqBands });
    invoke("playback_set_fade_ms", { ms: fadeMs }).catch(() => {});
    invoke("playback_set_eq", { bands: eqBands }).catch(() => {});
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

  resetEq: () => {
    localStorage.setItem(EQ_BANDS_KEY, JSON.stringify(FLAT_EQ));
    set({ eqBands: FLAT_EQ });
    invoke("playback_set_eq", { bands: FLAT_EQ }).catch(() => {});
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
