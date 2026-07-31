import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useDiscordStore } from "../store/discordStore";

export function SettingsModal() {
  const open = useDiscordStore((s) => s.isSettingsOpen);
  const onClose = useDiscordStore((s) => s.closeSettings);
  const enabled = useDiscordStore((s) => s.enabled);
  const savedAppId = useDiscordStore((s) => s.appId);
  const connected = useDiscordStore((s) => s.connected);
  const error = useDiscordStore((s) => s.error);
  const enable = useDiscordStore((s) => s.enable);
  const disable = useDiscordStore((s) => s.disable);

  const [appId, setAppId] = useState(savedAppId);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleToggle() {
    setLocalError(null);
    setBusy(true);
    try {
      if (enabled) {
        await disable();
      } else {
        if (!appId.trim()) {
          setLocalError("Enter a Discord Application ID first.");
          return;
        }
        await enable(appId.trim());
      }
    } catch (e) {
      setLocalError(String(e));
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

              {!enabled && (
                <label className="flex flex-col gap-1 text-sm">
                  Discord Application ID
                  <input
                    value={appId}
                    onChange={(e) => setAppId(e.target.value)}
                    className="rounded-md bg-surface-3 px-3 py-2 text-sm text-fg outline-none focus:ring-1 focus:ring-accent"
                    placeholder="123456789012345678"
                  />
                  <span className="text-xs text-muted">
                    Create one free at discord.com/developers/applications, name it
                    &ldquo;TuneBox&rdquo;, then paste its Application ID here.
                  </span>
                </label>
              )}

              {(error || localError) && (
                <p className="text-sm text-red-400">{error ?? localError}</p>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
