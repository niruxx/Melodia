/**
 * The user-facing release name, shown in Settings.
 *
 * Hand-maintained so the displayed name can carry a `v` prefix and any
 * decoration a release calls for, which the bundler manifests can't. When
 * bumping, keep it in step with the `version` fields in `package.json`,
 * `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` — those must stay
 * strict semver (no `v`, and the core must be MAJOR.MINOR.PATCH).
 */
export const APP_VERSION = "v0.3.0-PRE";
