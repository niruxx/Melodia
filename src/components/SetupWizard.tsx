import { useEffect, useRef, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Circle,
  Download,
  Loader2,
  Speaker,
  Sparkles,
  Terminal,
} from "lucide-react";
import { AppIcon } from "./AppIcon";
import clsx from "clsx";
import { useSetupStore, SETUP_STEPS } from "../store/setupStore";
import { useAudioSettingsStore } from "../store/audioSettingsStore";
import { useVisualizerStore, VISUALIZER_THEMES } from "../store/visualizerStore";
import { UI_THEMES, useUiThemeStore } from "../store/uiThemeStore";
import { useAuthStore } from "../store/authStore";
import { usePythonStore } from "../store/pythonStore";

/**
 * First-launch guide covering the choices that are awkward to discover later:
 * the visualiser palette, which speakers to use, and signing in — plus the one
 * thing that isn't a choice at all, the Python helper YouTube Music runs on.
 *
 * Every step is skippable and each choice is also reachable from Settings —
 * this only front-loads them, it isn't the sole route to any of them. Skipping
 * the Python step leaves a working app for local files, and it reopens here on
 * the next launch for as long as the helper can't run.
 */
export function SetupWizard() {
  const isOpen = useSetupStore((s) => s.isOpen);
  const stepIndex = useSetupStore((s) => s.stepIndex);
  const next = useSetupStore((s) => s.next);
  const back = useSetupStore((s) => s.back);
  const finish = useSetupStore((s) => s.finish);

  const themeId = useVisualizerStore((s) => s.themeId);
  const setTheme = useVisualizerStore((s) => s.setTheme);
  const uiThemeId = useUiThemeStore((s) => s.themeId);
  const setUiTheme = useUiThemeStore((s) => s.setTheme);

  const outputDevices = useAudioSettingsStore((s) => s.outputDevices);
  const outputDeviceId = useAudioSettingsStore((s) => s.outputDeviceId);
  const setOutputDevice = useAudioSettingsStore((s) => s.setOutputDevice);
  const refreshOutputDevices = useAudioSettingsStore((s) => s.refreshOutputDevices);

  const authState = useAuthStore((s) => s.state);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);

  const step = SETUP_STEPS[stepIndex];
  const isSignedIn = authState === "signed_in";

  // Devices can change between launches, so re-read them when the step opens
  // rather than trusting whatever was enumerated at startup.
  useEffect(() => {
    if (isOpen && step === "audio") void refreshOutputDevices();
  }, [isOpen, step, refreshOutputDevices]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.2 }}
            className="fixed left-1/2 top-1/2 z-[60] flex max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-surface-2 shadow-2xl"
          >
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-8">
              {step === "welcome" && (
                <div className="flex flex-col items-center gap-4 text-center">
                  <AppIcon className="h-16 w-16 rounded-2xl" />
                  <h2 className="text-2xl font-bold">Welcome to Melodia</h2>
                  <p className="max-w-sm text-sm text-muted">
                    A few quick steps and you're set. You can change any of them later in
                    Settings.
                  </p>
                </div>
              )}

              {step === "python" && <PythonStep />}

              {step === "theme" && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <Sparkles size={20} className="text-accent" />
                    <h2 className="text-xl font-bold">Choose a look</h2>
                  </div>

                  <p className="text-sm text-muted">App colours — changes apply instantly.</p>
                  <div className="grid grid-cols-3 gap-2">
                    {UI_THEMES.map((theme) => (
                      <button
                        key={theme.id}
                        onClick={() => setUiTheme(theme.id)}
                        aria-pressed={uiThemeId === theme.id}
                        className={clsx(
                          "flex flex-col items-center gap-1.5 rounded-lg border p-1.5 transition-colors",
                          uiThemeId === theme.id
                            ? "border-accent bg-surface-3"
                            : "border-transparent bg-surface-3/40 hover:bg-surface-3",
                        )}
                      >
                        <span
                          className="flex h-9 w-full items-end gap-1 rounded p-1"
                          style={{
                            backgroundColor: theme.colors.base,
                            border: `1px solid ${theme.colors.border}`,
                          }}
                        >
                          <span
                            className="h-full w-1/3 rounded-sm"
                            style={{ backgroundColor: theme.colors.black }}
                          />
                          <span
                            className="h-2/3 flex-1 rounded-sm"
                            style={{ backgroundColor: theme.colors.surface2 }}
                          />
                          <span
                            className="h-3 w-3 shrink-0 self-center rounded-full"
                            style={{
                              backgroundImage: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent2})`,
                            }}
                          />
                        </span>
                        <span className="text-[10px] font-semibold">{theme.label}</span>
                      </button>
                    ))}
                  </div>

                  <p className="text-sm text-muted">
                    Visualizer bars — "Album art" re-tints them to match whatever is playing.
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {VISUALIZER_THEMES.map((theme) => (
                      <button
                        key={theme.id}
                        onClick={() => setTheme(theme.id)}
                        aria-pressed={themeId === theme.id}
                        className={clsx(
                          "flex flex-col items-center gap-1.5 rounded-lg border p-1.5 transition-colors",
                          themeId === theme.id
                            ? "border-accent bg-surface-3"
                            : "border-transparent bg-surface-3/40 hover:bg-surface-3",
                        )}
                      >
                        <span
                          className="h-8 w-full rounded"
                          style={{
                            backgroundImage: theme.colors
                              ? `linear-gradient(to top, ${theme.colors[0]}, ${theme.colors[1]})`
                              : "linear-gradient(to top, var(--accent-dynamic-1), var(--accent-dynamic-2))",
                          }}
                        />
                        <span className="text-[10px] font-semibold">{theme.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === "audio" && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <Speaker size={20} className="text-accent" />
                    <h2 className="text-xl font-bold">Choose your audio output</h2>
                  </div>
                  <p className="text-sm text-muted">
                    Leave this on the system default unless you want Melodia pinned to specific
                    speakers or a DAC.
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <button
                      onClick={() => void setOutputDevice(null)}
                      className={clsx(
                        "flex items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                        outputDeviceId === null
                          ? "bg-surface-3 text-fg"
                          : "bg-surface-3/40 text-muted hover:bg-surface-3",
                      )}
                    >
                      <span className="font-medium">System default</span>
                      {outputDeviceId === null && <Check size={16} className="text-accent" />}
                    </button>
                    {outputDevices.map((device) => (
                      <button
                        key={device.id}
                        onClick={() => void setOutputDevice(device.id)}
                        className={clsx(
                          "flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                          outputDeviceId === device.id
                            ? "bg-surface-3 text-fg"
                            : "bg-surface-3/40 text-muted hover:bg-surface-3",
                        )}
                      >
                        <span className="min-w-0 truncate font-medium">{device.name}</span>
                        {outputDeviceId === device.id && (
                          <Check size={16} className="shrink-0 text-accent" />
                        )}
                      </button>
                    ))}
                    {outputDevices.length === 0 && (
                      <p className="py-3 text-center text-xs text-muted">
                        No output devices reported — the system default will be used.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {step === "account" && (
                <div className="flex flex-col items-center gap-4 text-center">
                  <AppIcon className="h-14 w-14 rounded-2xl" />
                  <h2 className="text-xl font-bold">
                    {isSignedIn ? "You're signed in" : "Connect YouTube Music"}
                  </h2>
                  <p className="max-w-sm text-sm text-muted">
                    {isSignedIn
                      ? "Your playlists and library are ready to go."
                      : "Sign in to load your playlists, library and history. You can also skip this and play local files instead."}
                  </p>
                  {!isSignedIn &&
                    (authState === "google_pending" ? (
                      <div className="flex items-center gap-2 text-sm text-muted">
                        <Loader2 size={16} className="animate-spin text-accent" />
                        Waiting for the Google window…
                      </div>
                    ) : (
                      <button
                        onClick={() => void signInWithGoogle()}
                        className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
                      >
                        Sign in with Google
                      </button>
                    ))}
                  {isSignedIn && <Check size={28} className="text-accent" />}
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-8 py-4">
              <div className="flex gap-1.5">
                {SETUP_STEPS.map((s, i) => (
                  <span
                    key={s}
                    className={clsx(
                      "h-1.5 rounded-full transition-all",
                      i === stepIndex ? "w-5 bg-accent" : "w-1.5 bg-surface-3",
                    )}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                {stepIndex > 0 && (
                  <button
                    onClick={back}
                    className="rounded-full px-4 py-2 text-sm font-semibold text-muted hover:text-fg"
                  >
                    Back
                  </button>
                )}
                <button
                  onClick={finish}
                  className="rounded-full px-4 py-2 text-sm font-semibold text-muted hover:text-fg"
                >
                  Skip
                </button>
                <button
                  onClick={next}
                  className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-black transition-transform hover:scale-105"
                >
                  {stepIndex === SETUP_STEPS.length - 1 ? "Finish" : "Next"}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * Gets the Python helper working: detect it, send the user to an installer if
 * there isn't one, and run pip for them if there is.
 *
 * The pip half is the point — everything about signing in worked already
 * *except* that `pip install -r sidecar/requirements.txt` had never been run,
 * and asking a listener to open a terminal for that is not a setup step.
 */
function PythonStep() {
  const phase = usePythonStore((s) => s.phase);
  const status = usePythonStore((s) => s.status);
  const log = usePythonStore((s) => s.log);
  const error = usePythonStore((s) => s.error);
  const installerOpened = usePythonStore((s) => s.installerOpened);
  const afterUpgrade = usePythonStore((s) => s.afterUpgrade);
  const check = usePythonStore((s) => s.check);
  const install = usePythonStore((s) => s.install);
  const openInstaller = usePythonStore((s) => s.openInstaller);

  const logRef = useRef<HTMLDivElement>(null);

  // Only when nothing is known yet: returning to the step with Back shouldn't
  // spend another few seconds re-probing, and there's a button for doing it on
  // purpose.
  useEffect(() => {
    if (phase === "unknown") void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pin the log to the newest line, which is the only one worth watching.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);

  const busy = phase === "checking" || phase === "installing";
  const hasPython = !!status?.interpreter;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Terminal size={20} className="text-accent" />
        <h2 className="text-xl font-bold">Set up the music service</h2>
      </div>
      <p className="text-sm text-muted">
        Melodia talks to YouTube Music through a small Python helper. Signing in, search and
        playlists all need it — local files don't.
      </p>

      {afterUpgrade && (
        <p className="rounded-lg bg-accent/10 px-3 py-2 text-xs text-muted">
          Melodia was updated, so it&rsquo;s re-checking the helper&rsquo;s packages against this
          version&rsquo;s requirements. You can carry on — this runs in the background.
        </p>
      )}

      {/* Two independent checks rather than one verdict: each has its own fix,
          and the second one's fix is worth being able to run on demand even
          when the check above it says there's nothing wrong. */}
      <div className="flex flex-col gap-2">
        <CheckRow
          state={phase === "checking" ? "busy" : !status ? "pending" : hasPython ? "ok" : "bad"}
          title="Python"
          detail={
            phase === "checking"
              ? "Looking for an interpreter…"
              : hasPython
                ? `${status?.version} — ${status?.interpreter}`
                : (status?.detail ?? "Not checked yet.")
          }
          action={
            !hasPython && (
              <ActionButton onClick={() => void openInstaller()} disabled={busy} primary>
                <Download size={14} />
                Get Python
              </ActionButton>
            )
          }
        />

        <CheckRow
          state={
            phase === "installing"
              ? "busy"
              : !status || !hasPython
                ? "pending"
                : status.ready
                  ? "ok"
                  : "bad"
          }
          title="Helper packages"
          detail={
            phase === "installing"
              ? "Running pip — this can take a few minutes."
              : !hasPython
                ? "Needs Python first."
                : status?.ready
                  ? "ytmusicapi and yt-dlp are installed."
                  : `Missing: ${status?.missing.join(", ")}`
          }
          action={
            <ActionButton
              onClick={() => void install()}
              disabled={busy}
              primary={hasPython && !status?.ready}
            >
              <Download size={14} />
              {status?.ready ? "Run pip again" : "Install"}
            </ActionButton>
          }
        />
      </div>

      {log.length > 0 && (
        <div
          ref={logRef}
          className="no-scrollbar max-h-32 overflow-y-auto rounded-lg bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-muted"
        >
          {log.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {line}
            </div>
          ))}
        </div>
      )}

      {error && <div className="text-xs text-red-400">{error}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void check()}
          disabled={busy}
          className="rounded-full bg-surface-3 px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-3/70 disabled:opacity-50"
        >
          Check again
        </button>
        {/* A Python installed while Melodia was running may not be on the PATH
            this process inherited. The check looks in the usual install
            locations first, so this is the last resort rather than the advice. */}
        {installerOpened && !hasPython && (
          <p className="text-xs text-muted">
            Installed it? Check again — or{" "}
            <button
              onClick={() => void invoke("app_relaunch")}
              className="underline transition-colors hover:text-fg"
            >
              restart Melodia
            </button>{" "}
            if it still isn't found.
          </p>
        )}
      </div>
    </div>
  );
}

/** One line of the Python step: an outcome, what it means, and its fix. */
function CheckRow({
  state,
  title,
  detail,
  action,
}: {
  state: "pending" | "busy" | "ok" | "bad";
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface-3/40 p-3">
      <span className="shrink-0">
        {state === "busy" ? (
          <Loader2 size={18} className="animate-spin text-accent" />
        ) : state === "ok" ? (
          <Check size={18} className="text-accent" />
        ) : state === "bad" ? (
          <AlertTriangle size={18} className="text-amber-400" />
        ) : (
          <Circle size={18} className="text-muted/50" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="break-words text-xs text-muted">{detail}</div>
      </div>
      {action}
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  primary,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40",
        primary
          ? "bg-accent text-black hover:brightness-110"
          : "bg-surface-3 text-fg hover:bg-surface-3/70",
      )}
    >
      {children}
    </button>
  );
}
