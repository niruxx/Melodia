const LEGACY_PREFIX = "tunebox:";
const PREFIX = "melodia:";

/**
 * Carries settings across the TuneBox → Melodia rename.
 *
 * Every store keys its persisted state by prefix, so renaming the app would
 * otherwise silently reset themes, EQ, audio output, and the first-run flag —
 * the values would still be on disk, just under names nothing reads any more.
 *
 * Must run before any store's `init()`, and is safe to run repeatedly: it only
 * copies keys that don't already exist under the new prefix, so a value the
 * user has since changed is never overwritten by its stale predecessor.
 */
export function migrateLegacyStorage(): void {
  let migrated = 0;
  try {
    const legacyKeys = Object.keys(localStorage).filter((k) => k.startsWith(LEGACY_PREFIX));
    for (const legacyKey of legacyKeys) {
      const key = PREFIX + legacyKey.slice(LEGACY_PREFIX.length);
      if (localStorage.getItem(key) === null) {
        const value = localStorage.getItem(legacyKey);
        if (value !== null) {
          localStorage.setItem(key, value);
          migrated++;
        }
      }
      localStorage.removeItem(legacyKey);
    }
  } catch {
    // A storage failure here must not stop the app booting; the stores all
    // fall back to their defaults when a key is absent.
    return;
  }
  if (migrated > 0) {
    console.info(`Melodia: migrated ${migrated} setting(s) from the previous app name.`);
  }
}
