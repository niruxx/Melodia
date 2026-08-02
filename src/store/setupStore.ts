import { create } from "zustand";

const COMPLETED_KEY = "melodia:setup-complete";

/** Ordered steps of the first-launch wizard.
 *
 * "python" comes first because it's the only step that can block the others:
 * signing in needs the helper it provisions.
 */
export const SETUP_STEPS = ["welcome", "python", "theme", "audio", "account"] as const;
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
  /** Jumps straight to one step, opening the wizard if it is closed. */
  openStep: (step: SetupStep) => void;
  /** As `openStep`, but yields to a wizard that is already running — a
   *  first launch visits every step anyway. */
  requireStep: (step: SetupStep) => void;
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

  openStep: (step) => set({ isOpen: true, stepIndex: Math.max(0, SETUP_STEPS.indexOf(step)) }),

  requireStep: (step) => {
    if (get().isOpen) return;
    get().openStep(step);
  },
}));
