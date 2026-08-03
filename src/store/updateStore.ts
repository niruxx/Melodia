import { create } from "zustand";
import { checkForUpdate, type ReleaseInfo } from "../lib/appUpdate";

/** Off means Melodia never contacts GitHub unless the user asks it to. */
const AUTO_CHECK_KEY = "melodia:update-auto-check";
/** A version the user has said they don't want to hear about again. */
const SKIPPED_KEY = "melodia:update-skipped-version";

type UpdateStore = {
  release: ReleaseInfo | null;
  checking: boolean;
  /** Only ever shown where a check was asked for; never in the banner. */
  error: string | null;
  /** When the last successful check finished. */
  checkedAt: number | null;
  autoCheck: boolean;
  skippedVersion: string | null;
  /** Closed for this session only — it comes back on the next launch. */
  dismissed: boolean;
  notesOpen: boolean;

  init: () => void;
  check: (manual?: boolean) => Promise<void>;
  setAutoCheck: (value: boolean) => void;
  skip: () => void;
  dismiss: () => void;
  openNotes: () => void;
  closeNotes: () => void;
};

/**
 * Whether the banner should be showing.
 *
 * Three separate ways to say no, because being told about the same release on
 * every launch is how an update prompt trains people to ignore it: the version
 * has to be newer, not skipped outright, and not waved away this session.
 */
export function hasUpdateBanner(s: UpdateStore): boolean {
  return (
    !!s.release?.isNewer && !s.dismissed && s.release.version !== s.skippedVersion
  );
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  release: null,
  checking: false,
  error: null,
  checkedAt: null,
  autoCheck: true,
  skippedVersion: null,
  dismissed: false,
  notesOpen: false,

  init: () => {
    // Absent means "not yet asked", which defaults to on; only an explicit
    // "false" turns it off.
    const autoCheck = localStorage.getItem(AUTO_CHECK_KEY) !== "false";
    set({ autoCheck, skippedVersion: localStorage.getItem(SKIPPED_KEY) });
    if (autoCheck) void get().check();
  },

  check: async (manual = false) => {
    if (get().checking) return;
    set({ checking: true, error: null });
    try {
      const release = await checkForUpdate();
      // A manual check is a request to be shown the answer, so it undoes a
      // dismissal — but not a skip, which was a decision about this release.
      set({
        release,
        checkedAt: Date.now(),
        checking: false,
        dismissed: manual ? false : get().dismissed,
      });
    } catch (e) {
      // Offline, behind a proxy, rate-limited: none of that is the user's
      // problem unless they went looking for it.
      set({ error: String(e), checking: false });
    }
  },

  setAutoCheck: (value) => {
    localStorage.setItem(AUTO_CHECK_KEY, String(value));
    set({ autoCheck: value });
  },

  skip: () => {
    const version = get().release?.version;
    if (!version) return;
    localStorage.setItem(SKIPPED_KEY, version);
    set({ skippedVersion: version, notesOpen: false });
  },

  dismiss: () => set({ dismissed: true }),
  openNotes: () => set({ notesOpen: true }),
  closeNotes: () => set({ notesOpen: false }),
}));
