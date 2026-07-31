import { create } from "zustand";
import * as ytmusic from "../lib/ytmusic";

export type AuthState = "checking" | "no_credentials" | "signed_out" | "pending" | "signed_in";

type AuthStore = {
  state: AuthState;
  userCode: string | null;
  verificationUrl: string | null;
  error: string | null;
  isModalOpen: boolean;

  init: () => Promise<void>;
  saveCredentials: (clientId: string, clientSecret: string) => Promise<void>;
  beginSignIn: () => Promise<void>;
  cancelSignIn: () => void;
  doSignOut: () => Promise<void>;
  openModal: () => void;
  closeModal: () => void;
};

let pollTimer: ReturnType<typeof setInterval> | null = null;

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export const useAuthStore = create<AuthStore>((set) => ({
  state: "checking",
  userCode: null,
  verificationUrl: null,
  error: null,
  isModalOpen: false,

  openModal: () => set({ isModalOpen: true }),
  closeModal: () => set({ isModalOpen: false }),

  init: async () => {
    try {
      const status = await ytmusic.authStatus();
      set({ state: status });
    } catch (e) {
      set({ state: "no_credentials", error: String(e) });
    }
  },

  saveCredentials: async (clientId, clientSecret) => {
    set({ error: null });
    await ytmusic.setCredentials(clientId, clientSecret);
    set({ state: "signed_out" });
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
          set({ state: "signed_in", userCode: null, verificationUrl: null, isModalOpen: false });
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
    set({ state: "signed_out", userCode: null, verificationUrl: null });
  },

  doSignOut: async () => {
    stopPolling();
    await ytmusic.signOut();
    set({ state: "signed_out", userCode: null, verificationUrl: null, error: null });
  },
}));
