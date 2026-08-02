import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, Music2, Speaker, Sparkles } from "lucide-react";
import clsx from "clsx";
import { useSetupStore, SETUP_STEPS } from "../store/setupStore";
import { useAudioSettingsStore } from "../store/audioSettingsStore";
import { useVisualizerStore, VISUALIZER_THEMES } from "../store/visualizerStore";
import { useAuthStore } from "../store/authStore";

/**
 * First-launch guide covering the choices that are awkward to discover later:
 * the visualiser palette, which speakers to use, and signing in.
 *
 * Every step is skippable and each choice is also reachable from Settings —
 * this only front-loads them, it isn't the sole route to any of them.
 */
export function SetupWizard() {
  const isOpen = useSetupStore((s) => s.isOpen);
  const stepIndex = useSetupStore((s) => s.stepIndex);
  const next = useSetupStore((s) => s.next);
  const back = useSetupStore((s) => s.back);
  const finish = useSetupStore((s) => s.finish);

  const themeId = useVisualizerStore((s) => s.themeId);
  const setTheme = useVisualizerStore((s) => s.setTheme);

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
                  <div className="brand-mark flex h-16 w-16 items-center justify-center rounded-2xl text-white">
                    <Music2 size={30} />
                  </div>
                  <h2 className="text-2xl font-bold">Welcome to TuneBox</h2>
                  <p className="max-w-sm text-sm text-muted">
                    Three quick choices and you're set. You can change any of them later in
                    Settings.
                  </p>
                </div>
              )}

              {step === "theme" && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <Sparkles size={20} className="text-accent" />
                    <h2 className="text-xl font-bold">Pick a visualizer palette</h2>
                  </div>
                  <p className="text-sm text-muted">
                    "Album art" re-tints the spectrum bars to match whatever is playing.
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
                          className="h-10 w-full rounded"
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
                    Leave this on the system default unless you want TuneBox pinned to specific
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
                  <div className="brand-mark flex h-14 w-14 items-center justify-center rounded-2xl text-white">
                    <Music2 size={26} />
                  </div>
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
