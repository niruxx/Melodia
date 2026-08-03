import { invoke } from "@tauri-apps/api/core";

/** Mirrors `ReleaseInfo` in `src-tauri/src/update.rs`. */
export type ReleaseInfo = {
  /** The published version, without a `v` prefix. */
  version: string;
  /** What it was compared against — this build's version. */
  currentVersion: string;
  name: string;
  /** Markdown, as written on the GitHub release. */
  notes: string;
  /** The release page. */
  url: string;
  /** The installer for this platform, when the release ships one. */
  downloadUrl: string | null;
  publishedAt: string | null;
  isNewer: boolean;
};

/** Asks GitHub for the latest published release. Rejects when it can't be reached. */
export function checkForUpdate(): Promise<ReleaseInfo> {
  return invoke<ReleaseInfo>("check_for_update");
}
