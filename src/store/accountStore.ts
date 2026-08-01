import { create } from "zustand";
import * as ytmusic from "../lib/ytmusic";
import type { AccountInfo } from "../lib/ytmusic";

type AccountStore = {
  info: AccountInfo | null;
  loading: boolean;
  fetch: () => Promise<void>;
  reset: () => void;
};

export const useAccountStore = create<AccountStore>((set) => ({
  info: null,
  loading: false,

  fetch: async () => {
    set({ loading: true });
    try {
      set({ info: await ytmusic.getAccountInfo(), loading: false });
    } catch {
      // Non-fatal: callers fall back to a generic greeting rather than
      // blocking the page on a missing display name.
      set({ info: null, loading: false });
    }
  },

  reset: () => set({ info: null, loading: false }),
}));
