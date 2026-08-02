import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Mirrors `PythonStatus` in `src-tauri/src/python.rs`. */
export type PythonStatus = {
  /** The interpreter the sidecar will use, or that packages go into. */
  interpreter: string | null;
  version: string | null;
  /** Imports the helper needs that failed. */
  missing: string[];
  /** True only when the sidecar can actually run. */
  ready: boolean;
  /** Whether the gap is one we can close with pip, rather than an install. */
  canInstall: boolean;
  /** Human-readable reason it isn't ready. Null when it is. */
  detail: string | null;
};

/** Probes the machine's Python. Slow enough (seconds) to want a spinner. */
export function checkPython(): Promise<PythonStatus> {
  return invoke<PythonStatus>("python_status");
}

/** Opens the platform's recommended Python installer page. */
export function openPythonInstaller(): Promise<void> {
  return invoke("python_open_installer");
}

/** Runs pip against the bundled requirements, resolving with a fresh status. */
export function installPythonPackages(): Promise<PythonStatus> {
  return invoke<PythonStatus>("python_install_packages");
}

/** Subscribes to the install's output, a line at a time. */
export function onPythonSetupLog(handler: (line: string) => void) {
  return listen<string>("python-setup:log", (event) => handler(event.payload));
}
