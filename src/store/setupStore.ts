import { create } from "zustand";

const COMPLETED_KEY = "tunebox:setup-complete";

/** Ordered steps of the first-launch wizard. */
export const SETUP_STEPS = ["welcome", "theme", "audio", "account"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

type SetupStore = {
  /** Null until `init()` has decided — avoids flashing the wizard on reload. */
  isOpen: boolean | null;
  stepIndex: number;

  init: () => void;
  next: () => void;
  back: () => void;
  finish: () => void;
  /** Lets the wizard be replayed from Settings. */
  restart: () => void;
};

export const useSetupStore = create<SetupStore>((set, get) => ({
  isOpen: null,
  stepIndex: 0,

  init: () => set({ isOpen: localStorage.getItem(COMPLETED_KEY) !== "true", stepIndex: 0 }),

  next: () => {
    const next = get().stepIndex + 1;
    if (next >= SETUP_STEPS.length) {
      get().finish();
      return;
    }
    set({ stepIndex: next });
  },

  back: () => set({ stepIndex: Math.max(0, get().stepIndex - 1) }),

  // Recorded on finish *and* on skip: a wizard that reappears every launch is
  // worse than one the user can reopen deliberately from Settings.
  finish: () => {
    localStorage.setItem(COMPLETED_KEY, "true");
    set({ isOpen: false, stepIndex: 0 });
  },

  restart: () => set({ isOpen: true, stepIndex: 0 }),
}));
