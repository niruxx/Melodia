import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import * as ytmusic from "../lib/ytmusic";
import type { AuthMethod } from "../lib/ytmusic";

export type AuthState =
  | "checking"
  | "no_credentials"
  | "signed_out"
  | "pending"
  | "google_pending"
  | "signed_in";

type AuthStore = {
  state: AuthState;
  /** Which method the current session uses, once signed in. */
  method: AuthMethod;
  /** Whether an OAuth client is configured, gating the fallback flow. */
  oauthConfigured: boolean;
  /** True while the OAuth fallback UI is being shown deliberately. */
  showOAuthFallback: boolean;
  userCode: string | null;
  verificationUrl: string | null;
  error: string | null;
  isModalOpen: boolean;

  init: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  setShowOAuthFallback: (value: boolean) => void;
  saveCredentials: (clientId: string, clientSecret: string) => Promise<void>;
  beginSignIn: () => Promise<void>;
  cancelSignIn: () => void;
  doSignOut: () => Promise<void>;
  openModal: () => void;
  closeModal: () => void;
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
let googleTimeout: ReturnType<typeof setTimeout> | null = null;

/** How long to wait for the Google window before giving the user a way out. */
const GOOGLE_LOGIN_TIMEOUT_MS = 3 * 60_000;

function clearGoogleTimeout() {
  if (googleTimeout) {
    clearTimeout(googleTimeout);
    googleTimeout = null;
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  state: "checking",
  method: null,
  oauthConfigured: false,
  showOAuthFallback: false,
  userCode: null,
  verificationUrl: null,
  error: null,
  isModalOpen: false,

  openModal: () => set({ isModalOpen: true }),
  closeModal: () => set({ isModalOpen: false, showOAuthFallback: false }),
  setShowOAuthFallback: (value) => set({ showOAuthFallback: value, error: null }),

  init: async () => {
    try {
      const { status, method, oauthConfigured } = await ytmusic.authStatus();
      set({ state: status, method, oauthConfigured });
    } catch (e) {
      set({ state: "signed_out", error: String(e) });
    }

    // The Rust login window reports back here. Registered once at init so a
    // completed sign-in is captured even if the modal has been closed.
    listen<string>("google-login:complete", async (event) => {
      clearGoogleTimeout();
      try {
        await ytmusic.setBrowserAuth(event.payload);
        set({
          state: "signed_in",
          method: "browser",
          error: null,
          isModalOpen: false,
          showOAuthFallback: false,
        });
      } catch (e) {
        set({ state: "signed_out", error: String(e) });
      }
    });

    listen("google-login:cancelled", () => {
      clearGoogleTimeout();
      // Only downgrade if we were mid-flow; a cancel shouldn't clobber a
      // session established some other way.
      if (get().state === "google_pending") set({ state: "signed_out" });
    });
  },

  signInWithGoogle: async () => {
    set({ error: null, state: "google_pending" });
    try {
      await ytmusic.startGoogleLogin();
    } catch (e) {
      set({ state: "signed_out", error: String(e) });
      return;
    }

    // Failsafe: nothing else can rescue this state. If the window is dismissed
    // in a way that emits no event, or the post-login verification stalls (it
    // makes a network call with no timeout of its own), the UI would otherwise
    // sit on "Waiting for Google sign-in" forever with no explanation.
    if (googleTimeout) clearTimeout(googleTimeout);
    googleTimeout = setTimeout(() => {
      googleTimeout = null;
      if (get().state !== "google_pending") return;
      void ytmusic.cancelGoogleLogin();
      set({
        state: "signed_out",
        error: "Google sign-in timed out. Please try again.",
      });
    }, GOOGLE_LOGIN_TIMEOUT_MS);
  },

  saveCredentials: async (clientId, clientSecret) => {
    set({ error: null });
    await ytmusic.setCredentials(clientId, clientSecret);
    set({ state: "signed_out", oauthConfigured: true });
  },

  beginSignIn: async () => {
    set({ error: null });
    const { verificationUrl, userCode } = await ytmusic.startOAuth();
    set({ state: "pending", userCode, verificationUrl });

    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        const res = await ytmusic.pollOAuth();
        if (res.status === "success") {
          stopPolling();
          set({
            state: "signed_in",
            method: "oauth",
            userCode: null,
            verificationUrl: null,
            isModalOpen: false,
          });
        } else if (res.status === "error") {
          stopPolling();
          set({
            state: "signed_out",
            error: res.error ?? "Sign-in failed",
            userCode: null,
            verificationUrl: null,
          });
        }
      } catch (e) {
        stopPolling();
        set({ state: "signed_out", error: String(e), userCode: null, verificationUrl: null });
      }
    }, 3000);
  },

  cancelSignIn: () => {
    stopPolling();
    clearGoogleTimeout();
    // Also dismiss the Google window if that's the flow being cancelled, so
    // it can't linger after the app has moved on.
    if (get().state === "google_pending") void ytmusic.cancelGoogleLogin();
    set({ state: "signed_out", userCode: null, verificationUrl: null });
  },

  doSignOut: async () => {
    stopPolling();
    await ytmusic.signOut();
    set({
      state: "signed_out",
      method: null,
      userCode: null,
      verificationUrl: null,
      error: null,
    });
  },
}));
