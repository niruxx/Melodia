import { create } from "zustand";
import * as soundcloud from "../lib/soundcloud";
import type { ScAccountInfo } from "../lib/soundcloud";

type ScAccountStore = {
  info: ScAccountInfo | null;
  loading: boolean;
  fetch: () => Promise<void>;
  reset: () => void;
};

export const useScAccountStore = create<ScAccountStore>((set) => ({
  info: null,
  loading: false,

  fetch: async () => {
    set({ loading: true });
    try {
      set({ info: await soundcloud.getAccountInfo(), loading: false });
    } catch {
      // Non-fatal: callers fall back to a generic greeting rather than
      // blocking the page on a missing display name.
      set({ info: null, loading: false });
    }
  },

  reset: () => set({ info: null, loading: false }),
}));
