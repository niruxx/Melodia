import { create } from "zustand";

const THEME_KEY = "tunebox:ui-theme";
const ACCENT_KEY = "tunebox:ui-accent";
const GRADIENT_KEY = "tunebox:ui-gradient";

/**
 * Mirrors the `@theme` tokens declared in `src/index.css`. Tailwind v4 compiles
 * those to CSS custom properties on `:root`, so overriding them at runtime
 * re-skins every utility (`bg-surface`, `text-muted`, …) without touching the
 * components themselves.
 */
export type ThemeColors = {
  /** Backs `bg-black`, used for the sidebar and modal scrims — not literally
   * black, and light themes must lighten it or sidebar text disappears. */
  black: string;
  base: string;
  surface: string;
  surface2: string;
  surface3: string;
  border: string;
  fg: string;
  muted: string;
  accent: string;
  accent2: string;
};

export type UiTheme = {
  id: string;
  label: string;
  colors: ThemeColors;
  /** Light palettes need the ambient wash scaled back — the same alpha that
   * reads as a hint over near-black is a heavy stain over near-white. */
  isLight?: boolean;
};

export type GradientIntensity = "off" | "subtle" | "vivid";

export const GRADIENT_INTENSITIES: readonly { id: GradientIntensity; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "subtle", label: "Subtle" },
  { id: "vivid", label: "Vivid" },
];

const INTENSITY_SCALE: Record<GradientIntensity, number> = {
  off: 0,
  subtle: 0.55,
  vivid: 1,
};

export const UI_THEMES: readonly UiTheme[] = [
  {
    id: "midnight",
    label: "Midnight",
    colors: {
      black: "#000000",
      base: "#121212",
      surface: "#181818",
      surface2: "#242424",
      surface3: "#2f2f2f",
      border: "#2a2a2a",
      fg: "#ffffff",
      muted: "#a7a7a7",
      accent: "#7c5cff",
      accent2: "#ec4899",
    },
  },
  {
    id: "graphite",
    label: "Graphite",
    colors: {
      black: "#06080b",
      base: "#0f1115",
      surface: "#161920",
      surface2: "#1f232c",
      surface3: "#2b303b",
      border: "#262b35",
      fg: "#e8eaed",
      muted: "#9aa2b1",
      accent: "#38bdf8",
      accent2: "#818cf8",
    },
  },
  {
    id: "nocturne",
    label: "Nocturne",
    colors: {
      black: "#08060d",
      base: "#100e17",
      surface: "#171325",
      surface2: "#221b38",
      surface3: "#2d2447",
      border: "#271f40",
      fg: "#f2eaff",
      muted: "#a99cc4",
      accent: "#a855f7",
      accent2: "#ec4899",
    },
  },
  {
    id: "forest",
    label: "Forest",
    colors: {
      black: "#060b08",
      base: "#0c130f",
      surface: "#111a14",
      surface2: "#17251c",
      surface3: "#203026",
      border: "#1c2b21",
      fg: "#e9f5ec",
      muted: "#93ac9c",
      accent: "#22c55e",
      accent2: "#84cc16",
    },
  },
  {
    id: "ember",
    label: "Ember",
    colors: {
      black: "#0d0806",
      base: "#150f0c",
      surface: "#1d1512",
      surface2: "#2a1e19",
      surface3: "#372721",
      border: "#30231d",
      fg: "#fdeee6",
      muted: "#bda093",
      accent: "#f97316",
      accent2: "#ef4444",
    },
  },
  {
    id: "daylight",
    label: "Daylight",
    isLight: true,
    colors: {
      // Deliberately light: the sidebar and overlays paint with this token, so
      // a dark value here would swallow the dark foreground text.
      black: "#e9ebf0",
      base: "#f6f7f9",
      surface: "#ffffff",
      surface2: "#eef0f4",
      surface3: "#dfe3ea",
      border: "#d8dce4",
      fg: "#14161a",
      muted: "#5c6370",
      accent: "#6d28d9",
      accent2: "#db2777",
    },
  },
];

export const DEFAULT_THEME_ID = "midnight";

export type AccentPair = readonly [string, string];

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function themeById(id: string): UiTheme {
  return UI_THEMES.find((t) => t.id === id) ?? UI_THEMES[0];
}

/** Token name in `index.css` for each key of `ThemeColors`. */
const CSS_VARS: Record<keyof ThemeColors, string> = {
  black: "--color-black",
  base: "--color-base",
  surface: "--color-surface",
  surface2: "--color-surface-2",
  surface3: "--color-surface-3",
  border: "--color-border",
  fg: "--color-fg",
  muted: "--color-muted",
  accent: "--color-accent",
  accent2: "--color-accent-2",
};

export function resolveColors(themeId: string, accent: AccentPair | null): ThemeColors {
  const base = themeById(themeId).colors;
  return accent ? { ...base, accent: accent[0], accent2: accent[1] } : base;
}

function applyColors(colors: ThemeColors) {
  const root = document.documentElement;
  for (const [key, cssVar] of Object.entries(CSS_VARS)) {
    root.style.setProperty(cssVar, colors[key as keyof ThemeColors]);
  }
}

/** Resolved scalar the ambient-background CSS multiplies its alphas by. */
export function gradientStrength(themeId: string, intensity: GradientIntensity): number {
  const scale = INTENSITY_SCALE[intensity] ?? 1;
  return themeById(themeId).isLight ? scale * 0.5 : scale;
}

function applyGradient(themeId: string, intensity: GradientIntensity) {
  document.documentElement.style.setProperty(
    "--gradient-strength",
    String(gradientStrength(themeId, intensity)),
  );
}

type UiThemeStore = {
  themeId: string;
  /** Overrides the preset's accent pair when set. */
  accent: AccentPair | null;
  gradient: GradientIntensity;

  init: () => void;
  setTheme: (id: string) => void;
  setAccent: (index: 0 | 1, color: string) => void;
  resetAccent: () => void;
  setGradient: (intensity: GradientIntensity) => void;
  colors: () => ThemeColors;
};

export const useUiThemeStore = create<UiThemeStore>((set, get) => ({
  themeId: DEFAULT_THEME_ID,
  accent: null,
  gradient: "subtle",

  init: () => {
    const storedId = localStorage.getItem(THEME_KEY);
    const themeId = UI_THEMES.some((t) => t.id === storedId) ? storedId! : DEFAULT_THEME_ID;

    const rawGradient = localStorage.getItem(GRADIENT_KEY);
    const gradient = GRADIENT_INTENSITIES.some((g) => g.id === rawGradient)
      ? (rawGradient as GradientIntensity)
      : "subtle";

    let accent: AccentPair | null = null;
    const rawAccent = localStorage.getItem(ACCENT_KEY);
    if (rawAccent) {
      try {
        const parsed = JSON.parse(rawAccent);
        if (Array.isArray(parsed) && parsed.length === 2 && parsed.every(isHexColor)) {
          accent = [parsed[0], parsed[1]];
        }
      } catch {
        // corrupt value — fall back to the preset's own accent
      }
    }

    set({ themeId, accent, gradient });
    applyColors(resolveColors(themeId, accent));
    applyGradient(themeId, gradient);
  },

  setTheme: (id) => {
    if (!UI_THEMES.some((t) => t.id === id)) return;
    localStorage.setItem(THEME_KEY, id);
    // A custom accent is intentionally kept across theme changes: it's the
    // user's explicit choice, where the surfaces are the preset's.
    set({ themeId: id });
    applyColors(resolveColors(id, get().accent));
    // Re-applied because the light/dark scaling differs per theme.
    applyGradient(id, get().gradient);
  },

  setGradient: (intensity) => {
    localStorage.setItem(GRADIENT_KEY, intensity);
    set({ gradient: intensity });
    applyGradient(get().themeId, intensity);
  },

  setAccent: (index, color) => {
    if (!isHexColor(color)) return;
    const current = get().accent ?? [
      themeById(get().themeId).colors.accent,
      themeById(get().themeId).colors.accent2,
    ];
    const accent: AccentPair = index === 0 ? [color, current[1]] : [current[0], color];
    localStorage.setItem(ACCENT_KEY, JSON.stringify(accent));
    set({ accent });
    applyColors(resolveColors(get().themeId, accent));
  },

  resetAccent: () => {
    localStorage.removeItem(ACCENT_KEY);
    set({ accent: null });
    applyColors(resolveColors(get().themeId, null));
  },

  colors: () => resolveColors(get().themeId, get().accent),
}));
