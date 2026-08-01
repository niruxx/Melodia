import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useDiscordStore } from "../store/discordStore";
import { EQ_BAND_FREQS_HZ, useAudioSettingsStore } from "../store/audioSettingsStore";
import { useLocalLibraryStore } from "../store/localLibraryStore";
import { APP_VERSION } from "../lib/version";

export function SettingsModal() {
  const open = useDiscordStore((s) => s.isSettingsOpen);
  const onClose = useDiscordStore((s) => s.closeSettings);
  const enabled = useDiscordStore((s) => s.enabled);
  const connected = useDiscordStore((s) => s.connected);
  const error = useDiscordStore((s) => s.error);
  const enable = useDiscordStore((s) => s.enable);
  const disable = useDiscordStore((s) => s.disable);

  const fadeMs = useAudioSettingsStore((s) => s.fadeMs);
  const setFadeMs = useAudioSettingsStore((s) => s.setFadeMs);
  const eqBands = useAudioSettingsStore((s) => s.eqBands);
  const setEqBand = useAudioSettingsStore((s) => s.setEqBand);
  const resetEq = useAudioSettingsStore((s) => s.resetEq);

  const runInBackground = useAudioSettingsStore((s) => s.runInBackground);
  const setRunInBackground = useAudioSettingsStore((s) => s.setRunInBackground);

  const sleepTimerEndsAt = useAudioSettingsStore((s) => s.sleepTimerEndsAt);
  const startSleepTimer = useAudioSettingsStore((s) => s.startSleepTimer);
  const cancelSleepTimer = useAudioSettingsStore((s) => s.cancelSleepTimer);

  const localFolder = useLocalLibraryStore((s) => s.folder);
  const localError = useLocalLibraryStore((s) => s.error);
  const pickFolder = useLocalLibraryStore((s) => s.pickFolder);

  const [busy, setBusy] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);

  async function handlePickFolder() {
    setFolderBusy(true);
    try {
      await pickFolder();
    } finally {
      setFolderBusy(false);
    }
  }

  async function handleToggle() {
    setBusy(true);
    try {
      if (enabled) {
        await disable();
      } else {
        await enable();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/60"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18 }}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface-2 p-6 shadow-2xl"
          >
            <button
              onClick={onClose}
              className="absolute right-4 top-4 text-muted hover:text-fg"
              aria-label="Close"
            >
              <X size={18} />
            </button>

            <h2 className="text-lg font-bold">Settings</h2>

            <div className="mt-6 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Discord Rich Presence</div>
                  <div className="text-xs text-muted">
                    Show the song you're playing on your Discord profile.
                  </div>
                </div>
                <button
                  onClick={handleToggle}
                  disabled={busy}
                  className={
                    "shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 " +
                    (enabled ? "bg-accent text-black" : "bg-surface-3 text-fg hover:bg-surface-3/70")
                  }
                >
                  {enabled ? (connected ? "Connected" : "Enabled") : "Enable"}
                </button>
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Keep playing in the background</div>
                  <div className="text-xs text-muted">
                    Closing the window minimises TuneBox to the system tray instead of quitting,
                    so music keeps playing. Quit from the tray icon.
                  </div>
                </div>
                <button
                  onClick={() => setRunInBackground(!runInBackground)}
                  className={
                    "shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors " +
                    (runInBackground
                      ? "bg-accent text-black"
                      : "bg-surface-3 text-fg hover:bg-surface-3/70")
                  }
                >
                  {runInBackground ? "On" : "Off"}
                </button>
              </div>

              <div className="mt-2 flex flex-col gap-1.5">
                <div className="text-sm font-semibold">Local music folder</div>
                <div className="text-xs text-muted">
                  Play songs straight from a folder on this computer via the "Local" tab.
                </div>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate rounded-md bg-surface-3 px-3 py-2 text-xs text-muted">
                    {localFolder ?? "No folder selected"}
                  </span>
                  <button
                    onClick={handlePickFolder}
                    disabled={folderBusy}
                    className="shrink-0 rounded-full bg-surface-3 px-4 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-3/70 disabled:opacity-50"
                  >
                    Choose folder…
                  </button>
                </div>
                {localError && <p className="text-sm text-red-400">{localError}</p>}
              </div>

              <div className="mt-2 flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">Fade in / out</div>
                    <div className="text-xs text-muted">
                      Smoothly ramp volume at the start of a track and on pause/stop.
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted">
                    {fadeMs === 0 ? "Off" : `${(fadeMs / 1000).toFixed(1)}s`}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={3000}
                  step={100}
                  value={fadeMs}
                  onChange={(e) => setFadeMs(Number(e.target.value))}
                  className="tb-range h-3 w-full"
                  style={{ "--fill-pct": `${(fadeMs / 3000) * 100}%` } as React.CSSProperties}
                />
              </div>

              <div className="mt-2 flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">Sleep timer</div>
                    <div className="text-xs text-muted">
                      {sleepTimerEndsAt
                        ? "Playback will fade out and pause when it ends."
                        : "Automatically pause playback after a while."}
                    </div>
                  </div>
                  {sleepTimerEndsAt && (
                    <button
                      onClick={cancelSleepTimer}
                      className="shrink-0 rounded-full bg-surface-3 px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-3/70"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  {[15, 30, 45, 60].map((m) => (
                    <button
                      key={m}
                      onClick={() => startSleepTimer(m)}
                      className="pill flex-1 bg-surface-3 px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-3/70"
                    >
                      {m}m
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-2 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Equalizer</div>
                  <button onClick={resetEq} className="text-xs text-muted hover:text-fg">
                    Reset
                  </button>
                </div>
                <div className="flex items-center justify-between gap-1 rounded-lg bg-surface-3 px-2 py-3">
                  {EQ_BAND_FREQS_HZ.map((freq, i) => (
                    <div key={freq} className="flex flex-col items-center gap-1.5">
                      <span className="w-7 text-center text-[10px] tabular-nums text-muted">
                        {eqBands[i] > 0 ? `+${eqBands[i]}` : eqBands[i]}
                      </span>
                      <div className="flex h-24 w-7 items-center justify-center overflow-hidden">
                        <input
                          type="range"
                          min={-12}
                          max={12}
                          step={1}
                          value={eqBands[i]}
                          onChange={(e) => setEqBand(i, Number(e.target.value))}
                          className="tb-range tb-range-always"
                          style={
                            {
                              width: 96,
                              transform: "rotate(-90deg)",
                              // Bipolar band (-12..+12) mapped to 0-100% so the
                              // track fills upward as the band is boosted.
                              "--fill-pct": `${((eqBands[i] + 12) / 24) * 100}%`,
                            } as React.CSSProperties
                          }
                          aria-label={`${freq} Hz gain`}
                        />
                      </div>
                      <span className="text-[10px] text-muted">
                        {freq >= 1000 ? `${freq / 1000}k` : freq}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-1 border-t border-border pt-3 text-center text-xs text-muted">
                TuneBox <span className="tabular-nums">{APP_VERSION}</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
