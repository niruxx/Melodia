import { create } from "zustand";

const THEME_KEY = "melodia:visualizer-theme";
const CUSTOM_KEY = "melodia:visualizer-custom";

/** Bottom and top stop of the bars' vertical gradient. */
export type VisualizerColors = readonly [string, string];

export type VisualizerTheme = {
  id: string;
  label: string;
  /** null means "follow the album artwork palette" rather than a fixed pair. */
  colors: VisualizerColors | null;
};

export const ARTWORK_THEME_ID = "artwork";
export const CUSTOM_THEME_ID = "custom";

export const VISUALIZER_THEMES: readonly VisualizerTheme[] = [
  { id: ARTWORK_THEME_ID, label: "Album art", colors: null },
  { id: "aurora", label: "Aurora", colors: ["#22d3ee", "#a855f7"] },
  { id: "sunset", label: "Sunset", colors: ["#f97316", "#ec4899"] },
  { id: "ember", label: "Ember", colors: ["#dc2626", "#fbbf24"] },
  { id: "forest", label: "Forest", colors: ["#15803d", "#a3e635"] },
  { id: "ice", label: "Ice", colors: ["#1d4ed8", "#67e8f9"] },
  { id: "mono", label: "Mono", colors: ["#404040", "#fafafa"] },
];

export const DEFAULT_CUSTOM_COLORS: VisualizerColors = ["#7c5cff", "#ec4899"];

/** Canvas silently ignores a malformed fillStyle, so values are checked before
 * they're stored rather than debugging invisible bars later. */
function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function readStoredCustom(): VisualizerColors {
  const raw = localStorage.getItem(CUSTOM_KEY);
  if (!raw) return DEFAULT_CUSTOM_COLORS;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 2 && parsed.every(isHexColor)) {
      return [parsed[0], parsed[1]];
    }
  } catch {
    // corrupt value — fall through to the default pair
  }
  return DEFAULT_CUSTOM_COLORS;
}

type VisualizerStore = {
  themeId: string;
  custom: VisualizerColors;

  init: () => void;
  setTheme: (id: string) => void;
  setCustomColor: (index: 0 | 1, color: string) => void;
  resetCustom: () => void;

  /**
   * The pair the canvas should paint with, or null to follow the artwork
   * palette. Read imperatively from the render loop, so it must stay cheap.
   */
  activeColors: () => VisualizerColors | null;
};

export const useVisualizerStore = create<VisualizerStore>((set, get) => ({
  themeId: ARTWORK_THEME_ID,
  custom: DEFAULT_CUSTOM_COLORS,

  init: () => {
    const storedId = localStorage.getItem(THEME_KEY);
    const known =
      storedId === CUSTOM_THEME_ID || VISUALIZER_THEMES.some((t) => t.id === storedId);
    set({
      themeId: known && storedId ? storedId : ARTWORK_THEME_ID,
      custom: readStoredCustom(),
    });
  },

  setTheme: (id) => {
    localStorage.setItem(THEME_KEY, id);
    set({ themeId: id });
  },

  setCustomColor: (index, color) => {
    if (!isHexColor(color)) return;
    const custom: VisualizerColors = index === 0 ? [color, get().custom[1]] : [get().custom[0], color];
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom));
    // Picking a colour implies wanting to see it, so switch to the custom
    // theme rather than silently editing a palette that isn't active.
    localStorage.setItem(THEME_KEY, CUSTOM_THEME_ID);
    set({ custom, themeId: CUSTOM_THEME_ID });
  },

  resetCustom: () => {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(DEFAULT_CUSTOM_COLORS));
    set({ custom: DEFAULT_CUSTOM_COLORS });
  },

  activeColors: () => {
    const { themeId, custom } = get();
    if (themeId === CUSTOM_THEME_ID) return custom;
    return VISUALIZER_THEMES.find((t) => t.id === themeId)?.colors ?? null;
  },
}));
