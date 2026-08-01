/**
 * The user-facing release name, shown in Settings.
 *
 * Hand-maintained so the displayed name can carry a `v` prefix, which the
 * bundler manifests can't. When bumping, keep it in step with the `version`
 * fields in `package.json`, `src-tauri/Cargo.toml`, and
 * `src-tauri/tauri.conf.json`.
 *
 * Those three must be strict semver (no `v` prefix, core is MAJOR.MINOR.PATCH)
 * *and* satisfy the Windows MSI bundler, which is stricter still: a
 * pre-release identifier must be numeric-only and <= 65535. So `0.3.0-1` is
 * fine but `0.3.0-PRE` fails `tauri build` with
 * "optional pre-release identifier in app version must be numeric-only".
 * Prefer a plain `MAJOR.MINOR.PATCH` and keep any wording in this constant.
 */
export const APP_VERSION = "v0.3.0";
