import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { hashSeed } from "../lib/format";

export type Palette = {
  primary: string;
  secondary: string;
  isDark: boolean;
};

const BRAND: Palette = { primary: "#7c5cff", secondary: "#ec4899", isDark: true };

type ThemeStore = {
  palette: Palette;
  /** Pull colours from a track's artwork; falls back to a seeded hue when absent. */
  applyForTrack: (seed: string, artworkSrc?: string) => void;
  reset: () => void;
};

function writeCssVars(palette: Palette) {
  const root = document.documentElement;
  root.style.setProperty("--accent-dynamic-1", palette.primary);
  root.style.setProperty("--accent-dynamic-2", palette.secondary);
}

/** Deterministic stand-in matching `coverGradient`'s hues, for art-less tracks. */
function seededPalette(seed: string): Palette {
  const hash = hashSeed(seed);
  const hueA = hash % 360;
  const hueB = (hueA + 55 + (hash % 40)) % 360;
  return {
    primary: `hsl(${hueA} 65% 55%)`,
    secondary: `hsl(${hueB} 60% 48%)`,
    isDark: true,
  };
}

// Guards against a slow palette request for a previous track landing after a
// newer one has already been applied.
let requestToken = 0;

export const useThemeStore = create<ThemeStore>((set) => ({
  palette: BRAND,

  applyForTrack: (seed, artworkSrc) => {
    const token = ++requestToken;

    if (!artworkSrc) {
      const palette = seededPalette(seed);
      set({ palette });
      writeCssVars(palette);
      return;
    }

    invoke<{ primary: string; secondary: string; is_dark: boolean }>("artwork_palette", {
      source: artworkSrc,
    })
      .then((res) => {
        if (token !== requestToken) return;
        const palette: Palette = {
          primary: res.primary,
          secondary: res.secondary,
          isDark: res.is_dark,
        };
        set({ palette });
        writeCssVars(palette);
      })
      .catch(() => {
        if (token !== requestToken) return;
        // Extraction failed (unreachable URL, unsupported codec) — the seeded
        // hue still looks intentional, so don't leave the last track's colour.
        const palette = seededPalette(seed);
        set({ palette });
        writeCssVars(palette);
      });
  },

  reset: () => {
    requestToken++;
    set({ palette: BRAND });
    writeCssVars(BRAND);
  },
}));
