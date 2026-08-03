import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

type StreamAuth = { enabled: boolean; available: boolean };

/**
 * Errors that mean YouTube has noticed the cookies and objected.
 *
 * Deliberately narrow. "Sign in to confirm your age" is *not* here: that's the
 * problem this feature solves, and treating it as a reason to switch off would
 * tell people to disable the thing they need. These are the opposite case —
 * the request was authenticated and that authentication is what drew fire.
 */
const SUSPECT_PATTERNS = [
  /confirm you'?re not a bot/i,
  /cookies are no longer valid/i,
  /HTTP Error 429/i,
  /too many requests/i,
  /account has been terminated/i,
];

type StreamAuthStore = {
  enabled: boolean;
  /** False when there's no cookie session to lend — an OAuth sign-in has no
   *  browser cookies, and neither does being signed out. */
  available: boolean;
  busy: boolean;
  error: string | null;
  /** The error that prompted the warning, while it's showing. */
  warning: string | null;
  /** So one bad afternoon doesn't produce the same dialog ten times. */
  warned: boolean;

  init: () => Promise<void>;
  setEnabled: (value: boolean) => Promise<void>;
  /** Called with any playback/stream failure. Raises the warning when the
   *  failure looks like the cost of having this switched on. */
  reportFailure: (message: string) => void;
  dismissWarning: () => void;
};

export const useStreamAuthStore = create<StreamAuthStore>((set, get) => ({
  enabled: false,
  available: false,
  busy: false,
  error: null,
  warning: null,
  warned: false,

  init: async () => {
    try {
      const auth = await invoke<StreamAuth>("ytm_get_stream_auth");
      set({ enabled: auth.enabled, available: auth.available });
    } catch {
      // The helper may not be up yet — the setting is re-read whenever
      // Settings is opened, so there's nothing to report here.
    }
  },

  setEnabled: async (value) => {
    set({ busy: true, error: null });
    try {
      const auth = await invoke<StreamAuth>("ytm_set_stream_auth", { enabled: value });
      // Turning it off is also the fix the warning suggests, so clear the
      // warning state with it rather than nagging again this session.
      set({
        enabled: auth.enabled,
        available: auth.available,
        busy: false,
        warning: null,
        warned: value ? get().warned : false,
      });
    } catch (e) {
      set({ error: String(e), busy: false });
    }
  },

  reportFailure: (message) => {
    const { enabled, warned } = get();
    if (!enabled || warned) return;
    if (!SUSPECT_PATTERNS.some((pattern) => pattern.test(message))) return;
    set({ warning: message, warned: true });
  },

  dismissWarning: () => set({ warning: null }),
}));
