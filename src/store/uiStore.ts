import { create } from "zustand";

/** Transient, app-wide overlay state that isn't owned by any one feature store. */
type UiStore = {
  isPaletteOpen: boolean;
  isShortcutsOpen: boolean;
  setPaletteOpen: (value: boolean) => void;
  setShortcutsOpen: (value: boolean) => void;
};

export const useUiStore = create<UiStore>((set) => ({
  isPaletteOpen: false,
  isShortcutsOpen: false,
  setPaletteOpen: (value) => set({ isPaletteOpen: value }),
  setShortcutsOpen: (value) => set({ isShortcutsOpen: value }),
}));
