/**
 * The user-facing release name, shown in Settings.
 *
 * Kept as a hand-maintained constant rather than read from `package.json` /
 * `tauri.conf.json`, because those must hold strict semver for the bundler
 * while release names here can carry suffixes like `a-PRE`. Bump this when
 * cutting a release.
 */
export const APP_VERSION = "v0.2.0a-PRE";
