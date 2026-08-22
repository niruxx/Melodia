import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import * as soundcloud from "../lib/soundcloud";

export type ScAuthState = "checking" | "signed_out" | "sc_pending" | "signed_in";

type ScAuthStore = {
  state: ScAuthState;
  error: string | null;
  isModalOpen: boolean;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  signInWithSoundCloud: () => Promise<void>;
  /** Manual fallback: the user pastes a token captured from their own browser
   * session instead of relying on the embedded window's auto-capture. */
  submitToken: (token: string) => Promise<void>;
  cancelSignIn: () => void;
  doSignOut: () => Promise<void>;
  openModal: () => void;
  closeModal: () => void;
};

let scPendingTimeout: ReturnType<typeof setTimeout> | null = null;

/** How long to wait for the SoundCloud window before giving the user a way
 * out. Mirrors authStore.ts's Google timeout — the automated capture here is
 * inherently less certain to succeed (see soundcloud_login.rs), so the manual
 * "paste your token" path is always available in the modal regardless. */
const SC_LOGIN_TIMEOUT_MS = 3 * 60_000;

function clearScTimeout() {
  if (scPendingTimeout) {
    clearTimeout(scPendingTimeout);
    scPendingTimeout = null;
  }
}

export const useScAuthStore = create<ScAuthStore>((set, get) => ({
  state: "checking",
  error: null,
  isModalOpen: false,

  openModal: () => set({ isModalOpen: true }),
  closeModal: () => set({ isModalOpen: false }),

  refresh: async () => {
    try {
      const { status } = await soundcloud.authStatus();
      set({ state: status });
    } catch (e) {
      set({ state: "signed_out", error: String(e) });
    }
  },

  init: async () => {
    await get().refresh();

    listen<string>("soundcloud-login:complete", async (event) => {
      clearScTimeout();
      try {
        await soundcloud.setAuth(event.payload);
        set({ state: "signed_in", error: null, isModalOpen: false });
      } catch (e) {
        set({ state: "signed_out", error: String(e) });
      }
    });

    listen("soundcloud-login:cancelled", () => {
      clearScTimeout();
      if (get().state === "sc_pending") set({ state: "signed_out" });
    });
  },

  signInWithSoundCloud: async () => {
    set({ error: null, state: "sc_pending" });
    try {
      await soundcloud.startLogin();
    } catch (e) {
      set({ state: "signed_out", error: String(e) });
      return;
    }

    clearScTimeout();
    scPendingTimeout = setTimeout(() => {
      scPendingTimeout = null;
      if (get().state !== "sc_pending") return;
      void soundcloud.cancelLogin();
      set({
        state: "signed_out",
        error: "Didn't detect a signed-in session. Try pasting your token instead.",
      });
    }, SC_LOGIN_TIMEOUT_MS);
  },

  submitToken: async (token) => {
    set({ error: null });
    const trimmed = token.trim();
    if (!trimmed) {
      set({ error: "Paste a token first." });
      return;
    }
    await soundcloud.setAuth(trimmed);
    clearScTimeout();
    set({ state: "signed_in", isModalOpen: false });
  },

  cancelSignIn: () => {
    clearScTimeout();
    if (get().state === "sc_pending") void soundcloud.cancelLogin();
    set({ state: "signed_out" });
  },

  doSignOut: async () => {
    await soundcloud.signOut();
    set({ state: "signed_out", error: null });
  },
}));
