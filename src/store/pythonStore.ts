import { create } from "zustand";
import {
  checkPython,
  installPythonPackages,
  onPythonSetupLog,
  openPythonInstaller,
  type PythonStatus,
} from "../lib/pythonSetup";
import { getVersion } from "@tauri-apps/api/app";
import { useAuthStore } from "./authStore";
import { useSetupStore } from "./setupStore";
import { APP_VERSION } from "../lib/version";

/** Most recent lines kept from an install — enough to see what pip did. */
const MAX_LOG_LINES = 300;

/** The build that last ran on this machine, to spot an upgrade. */
const LAST_VERSION_KEY = "melodia:last-run-version";

type PythonPhase =
  /** Nothing asked yet. */
  | "unknown"
  | "checking"
  | "installing"
  /** Interpreter and packages are both present. */
  | "ready"
  /** Something is missing; `status.detail` says what. */
  | "missing";

type PythonStore = {
  phase: PythonPhase;
  status: PythonStatus | null;
  /** Output of the running (or last) install. */
  log: string[];
  /** Why the last install attempt failed, if it did. */
  error: string | null;
  /** Set once the installer page has been opened, so the UI can nudge. */
  installerOpened: boolean;
  /** True while this run of pip is the automatic post-upgrade one, so the
   *  setup step can say why it opened by itself. */
  afterUpgrade: boolean;

  check: () => Promise<PythonStatus | null>;
  install: () => Promise<void>;
  openInstaller: () => Promise<void>;
  verifyAfterUpgrade: () => Promise<void>;
};

/** Registered lazily and exactly once, however many components are watching. */
let logSubscription: Promise<() => void> | null = null;

function subscribeToLog() {
  if (logSubscription) return;
  logSubscription = onPythonSetupLog((line) =>
    usePythonStore.setState((s) => ({ log: [...s.log, line].slice(-MAX_LOG_LINES) })),
  );
}

/**
 * The state of the Python the YouTube Music helper runs on.
 *
 * Sign-in, search and playlists all go through that helper, so a machine
 * without it can only play local files — which used to surface as sign-in
 * simply failing. This backs the setup step that fixes it instead.
 */
export const usePythonStore = create<PythonStore>((set, get) => ({
  phase: "unknown",
  status: null,
  log: [],
  error: null,
  installerOpened: false,
  afterUpgrade: false,

  check: async () => {
    // An install runs its own check when it finishes; racing it would report
    // a half-installed state as the truth.
    if (get().phase === "installing") return get().status;
    set({ phase: "checking" });
    try {
      const status = await checkPython();
      // An install may have started while the probe was out — its own final
      // check is the authoritative one, so don't stamp a stale phase over it.
      if (get().phase !== "checking") return get().status;
      set({ status, phase: status.ready ? "ready" : "missing" });
      // The sidecar restarts itself on the next call, so a machine that was
      // broken at launch works from here without one — but the auth state read
      // at startup is stale, and only a re-read clears "signed out".
      if (status.ready) void useAuthStore.getState().refresh();
      return status;
    } catch (e) {
      if (get().phase !== "checking") return get().status;
      set({
        phase: "missing",
        status: {
          interpreter: null,
          version: null,
          missing: [],
          ready: false,
          canInstall: false,
          detail: String(e),
        },
      });
      return get().status;
    }
  },

  install: async () => {
    if (get().phase === "installing") return;
    subscribeToLog();
    set({ phase: "installing", error: null, log: [] });
    try {
      const status = await installPythonPackages();
      set({ status, phase: status.ready ? "ready" : "missing" });
      if (status.ready) void useAuthStore.getState().refresh();
    } catch (e) {
      set({ error: String(e), phase: "missing" });
      // Whatever pip managed to do, the status on screen is now out of date.
      void get().check();
    }
  },

  /**
   * On the first launch after the app's version changes, has pip re-apply
   * `requirements.txt`.
   *
   * The probe can't answer this on its own: it proves the packages *import*,
   * not that they satisfy the version ranges a new release ships. pip resolves
   * those properly, and does nothing when they're already met — so this is
   * cheap when nothing changed and correct when something did.
   *
   * It runs in the open, in the setup step, because it can take minutes on a
   * release that bumps yt-dlp.
   */
  verifyAfterUpgrade: async () => {
    // The binary's own version, not the hand-maintained display string: this
    // decides whether pip runs at all, so it mustn't depend on someone
    // remembering to bump a fourth file.
    const current = await getVersion().catch(() => APP_VERSION);
    const previous = localStorage.getItem(LAST_VERSION_KEY);
    localStorage.setItem(LAST_VERSION_KEY, current);
    // No record means a first launch, not an upgrade — the setup guide already
    // covers that, and running pip underneath it would be noise.
    if (!previous || previous === current) return;

    set({ afterUpgrade: true });
    useSetupStore.getState().openStep("python");
    await get().install();
    set({ afterUpgrade: false });
  },

  openInstaller: async () => {
    try {
      await openPythonInstaller();
      set({ installerOpened: true, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
