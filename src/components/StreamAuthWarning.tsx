import { AnimatePresence, motion } from "framer-motion";
import { ShieldAlert } from "lucide-react";
import { useStreamAuthStore } from "../store/streamAuthStore";

/**
 * Raised when YouTube pushes back on the borrowed sign-in.
 *
 * Lending yt-dlp the account's cookies is what makes age-restricted tracks
 * playable, and also what can get the account throttled or its session
 * invalidated. When that appears to be happening, the fix isn't something the
 * user can guess at — so it's offered directly, once, with the cause named.
 */
export function StreamAuthWarning() {
  const warning = useStreamAuthStore((s) => s.warning);
  const busy = useStreamAuthStore((s) => s.busy);
  const setEnabled = useStreamAuthStore((s) => s.setEnabled);
  const dismiss = useStreamAuthStore((s) => s.dismissWarning);

  return (
    <AnimatePresence>
      {warning && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={dismiss}
            className="fixed inset-0 z-[72] bg-black/70 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18 }}
            className="fixed left-1/2 top-1/2 z-[72] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-surface-2 p-6 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <ShieldAlert size={20} className="mt-0.5 shrink-0 text-amber-400" />
              <div className="min-w-0">
                <h2 className="text-lg font-bold">YouTube is pushing back</h2>
                <p className="mt-2 text-sm text-muted">
                  Melodia is signing in to YouTube as you so age-restricted songs will play.
                  YouTube treats that as suspicious, and it looks like it has started to. Left
                  alone this can throttle playback or sign you out of your library.
                </p>
                <p className="mt-2 text-sm text-muted">
                  Turning it off stops that. Age-restricted songs go back to being unplayable —
                  everything else keeps working.
                </p>
                <p className="mt-3 break-words rounded-lg bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-muted">
                  {warning}
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={dismiss}
                disabled={busy}
                className="rounded-full px-4 py-2 text-sm font-semibold text-muted hover:text-fg disabled:opacity-50"
              >
                Keep it on
              </button>
              <button
                onClick={() => void setEnabled(false)}
                disabled={busy}
                className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-black transition-transform hover:scale-[1.02] disabled:opacity-50"
              >
                Turn it off
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
