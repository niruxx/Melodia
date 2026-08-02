import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import clsx from "clsx";
import { useDiscordStore } from "../store/discordStore";
import {
  EQ_BAND_FREQS_HZ,
  EQ_PRESETS,
  STREAM_QUALITIES,
  useAudioSettingsStore,
} from "../store/audioSettingsStore";
import { usePlayerStore } from "../store/playerStore";
import { useSetupStore } from "../store/setupStore";
import { useLocalLibraryStore } from "../store/localLibraryStore";
import {
  CUSTOM_THEME_ID,
  VISUALIZER_THEMES,
  useVisualizerStore,
  type VisualizerTheme,
} from "../store/visualizerStore";
import { APP_VERSION } from "../lib/version";

/** Mirrors the canvas gradient, which runs bottom-to-top. */
function swatchGradient(theme: VisualizerTheme): string {
  return theme.colors
    ? `linear-gradient(to top, ${theme.colors[0]}, ${theme.colors[1]})`
    : "linear-gradient(to top, var(--accent-dynamic-1), var(--accent-dynamic-2))";
}

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
  const applyEqPreset = useAudioSettingsStore((s) => s.applyEqPreset);
  const resetEq = useAudioSettingsStore((s) => s.resetEq);

  const streamQuality = useAudioSettingsStore((s) => s.streamQuality);
  const setStreamQuality = useAudioSettingsStore((s) => s.setStreamQuality);
  const outputDeviceId = useAudioSettingsStore((s) => s.outputDeviceId);
  const outputDevices = useAudioSettingsStore((s) => s.outputDevices);
  const setOutputDevice = useAudioSettingsStore((s) => s.setOutputDevice);
  const refreshOutputDevices = useAudioSettingsStore((s) => s.refreshOutputDevices);
  const streamFormat = usePlayerStore((s) => s.streamFormat);
  const restartSetup = useSetupStore((s) => s.restart);

  const runInBackground = useAudioSettingsStore((s) => s.runInBackground);
  const setRunInBackground = useAudioSettingsStore((s) => s.setRunInBackground);

  const sleepTimerEndsAt = useAudioSettingsStore((s) => s.sleepTimerEndsAt);
  const startSleepTimer = useAudioSettingsStore((s) => s.startSleepTimer);
  const cancelSleepTimer = useAudioSettingsStore((s) => s.cancelSleepTimer);

  const visualizerThemeId = useVisualizerStore((s) => s.themeId);
  const visualizerCustom = useVisualizerStore((s) => s.custom);
  const setVisualizerTheme = useVisualizerStore((s) => s.setTheme);
  const setVisualizerCustomColor = useVisualizerStore((s) => s.setCustomColor);

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
            // Capped to the viewport with the body scrolling inside, so the
            // panel can't grow past the window as sections are added.
            className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-surface-2 shadow-2xl"
          >
            <div className="shrink-0 px-6 pb-2 pt-6">
              <button
                onClick={onClose}
                className="absolute right-4 top-4 text-muted hover:text-fg"
                aria-label="Close"
              >
                <X size={18} />
              </button>
              <h2 className="text-lg font-bold">Settings</h2>
            </div>

            <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6 pt-2">
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

              <div className="mt-2 flex flex-col gap-1.5">
                <div className="text-sm font-semibold">Audio output</div>
                <div className="text-xs text-muted">
                  Where sound is sent. Changing this restarts the current track from where it
                  was.
                </div>
                <select
                  value={outputDeviceId ?? ""}
                  onChange={(e) => setOutputDevice(e.target.value || null)}
                  onFocus={() => void refreshOutputDevices()}
                  className="rounded-md bg-surface-3 px-3 py-2 text-sm text-fg outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">
                    System default
                    {outputDevices.find((d) => d.isDefault)
                      ? ` (${outputDevices.find((d) => d.isDefault)?.name})`
                      : ""}
                  </option>
                  {outputDevices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-2 flex flex-col gap-1.5">
                <div className="text-sm font-semibold">Streaming quality</div>
                <div className="text-xs text-muted">
                  Streams are AAC — YouTube's higher-bitrate Opus audio uses a codec the player
                  can't decode, and there's no lossless tier either way. Local files always play
                  at their original quality.
                </div>
                <div className="flex gap-2">
                  {STREAM_QUALITIES.map((q) => (
                    <button
                      key={q.id}
                      onClick={() => setStreamQuality(q.id)}
                      title={q.hint}
                      className={clsx(
                        "pill flex-1 px-3 py-1.5 text-xs font-semibold transition-colors",
                        streamQuality === q.id
                          ? "bg-fg text-black"
                          : "bg-surface-3 text-fg hover:bg-surface-3/70",
                      )}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
                {streamFormat?.acodec && (
                  <div className="text-xs text-muted">
                    Now playing:{" "}
                    <span className="text-fg">
                      {streamFormat.acodec}
                      {streamFormat.abr ? ` · ${Math.round(streamFormat.abr)} kbps` : ""}
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-2 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Equalizer</div>
                  <button onClick={resetEq} className="text-xs text-muted hover:text-fg">
                    Reset
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {EQ_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => applyEqPreset(preset.gains)}
                      className={clsx(
                        "pill px-2.5 py-1 text-[11px] font-semibold transition-colors",
                        preset.gains.every((g, i) => g === eqBands[i])
                          ? "bg-fg text-black"
                          : "bg-surface-3 text-fg hover:bg-surface-3/70",
                      )}
                    >
                      {preset.name}
                    </button>
                  ))}
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

              <div className="mt-2 flex flex-col gap-2">
                <div className="text-sm font-semibold">Visualizer colours</div>
                <div className="text-xs text-muted">
                  Pick a palette for the spectrum bars, or let them keep following the album
                  artwork.
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {[
                    ...VISUALIZER_THEMES,
                    // The custom entry previews whatever pair is currently saved.
                    { id: CUSTOM_THEME_ID, label: "Custom", colors: visualizerCustom },
                  ].map((theme) => {
                    const active = visualizerThemeId === theme.id;
                    return (
                      <button
                        key={theme.id}
                        onClick={() => setVisualizerTheme(theme.id)}
                        aria-pressed={active}
                        className={clsx(
                          "flex flex-col items-center gap-1.5 rounded-lg border p-1.5 transition-colors",
                          active
                            ? "border-accent bg-surface-3"
                            : "border-transparent bg-surface-3/40 hover:bg-surface-3",
                        )}
                      >
                        <span
                          className="h-8 w-full rounded"
                          style={{ backgroundImage: swatchGradient(theme) }}
                        />
                        <span className="text-[10px] font-semibold text-fg">{theme.label}</span>
                      </button>
                    );
                  })}
                </div>

                {visualizerThemeId === CUSTOM_THEME_ID && (
                  <div className="flex items-center gap-4 rounded-lg bg-surface-3 px-3 py-2">
                    {([0, 1] as const).map((i) => (
                      <label key={i} className="flex items-center gap-2 text-xs text-muted">
                        <input
                          type="color"
                          value={visualizerCustom[i]}
                          onChange={(e) => setVisualizerCustomColor(i, e.target.value)}
                          className="h-7 w-9 cursor-pointer rounded bg-transparent p-0"
                          aria-label={i === 0 ? "Bottom bar colour" : "Top bar colour"}
                        />
                        {i === 0 ? "Bottom" : "Top"}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-2 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Relaunch TuneBox</div>
                  <div className="text-xs text-muted">
                    Restarts the app. Needed after changing Python or updating the helper.
                  </div>
                </div>
                <button
                  onClick={() => void invoke("app_relaunch")}
                  className="shrink-0 rounded-full bg-surface-3 px-4 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-3/70"
                >
                  Relaunch
                </button>
              </div>

              <div className="mt-1 flex flex-col items-center gap-2 border-t border-border pt-3">
                <button
                  onClick={() => {
                    onClose();
                    restartSetup();
                  }}
                  className="text-xs text-muted underline transition-colors hover:text-fg"
                >
                  Run the setup guide again
                </button>
                <div className="text-center text-xs text-muted">
                  TuneBox <span className="tabular-nums">{APP_VERSION}</span>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
