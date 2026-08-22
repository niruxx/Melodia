import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { useScAuthStore } from "../store/scAuthStore";

export function SoundCloudSignInModal() {
  const open = useScAuthStore((s) => s.isModalOpen);
  const onClose = useScAuthStore((s) => s.closeModal);
  const state = useScAuthStore((s) => s.state);
  const error = useScAuthStore((s) => s.error);
  const signInWithSoundCloud = useScAuthStore((s) => s.signInWithSoundCloud);
  const submitToken = useScAuthStore((s) => s.submitToken);
  const cancelSignIn = useScAuthStore((s) => s.cancelSignIn);

  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const busy = state === "sc_pending" || submitting;
  const shownError = error ?? localError;

  async function handleSubmitToken(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    try {
      await submitToken(token);
      setToken("");
    } catch (err) {
      setLocalError(String(err));
    } finally {
      setSubmitting(false);
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
            onClick={busy ? undefined : onClose}
            className="fixed inset-0 z-50 bg-black/60"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18 }}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface-2 p-6 shadow-2xl"
          >
            {!busy && (
              <button
                onClick={onClose}
                className="absolute right-4 top-4 text-muted transition-colors hover:text-fg"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            )}

            {state === "checking" ? (
              <div className="flex flex-col items-center gap-4 py-8 text-center">
                <Loader2 size={24} className="animate-spin text-accent" />
                <p className="text-sm text-muted">Checking your SoundCloud session...</p>
              </div>
            ) : state === "sc_pending" ? (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <Loader2 size={28} className="animate-spin text-accent" />
                <h2 className="text-lg font-bold">Waiting for SoundCloud sign-in</h2>
                <p className="text-sm text-muted">
                  Finish signing in in the SoundCloud window. Melodia will try to pick it up
                  automatically — if it doesn&rsquo;t, paste your token below once you&rsquo;re
                  signed in.
                </p>
                <button
                  onClick={cancelSignIn}
                  className="text-xs text-muted underline transition-colors hover:text-fg"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 py-2 text-center">
                <h2 className="text-lg font-bold">Connect SoundCloud</h2>
                <p className="text-sm text-muted">
                  Sign in with your SoundCloud account to load your playlists, likes, and
                  followed artists.
                </p>
                {shownError && <p className="text-sm text-red-400">{shownError}</p>}
                <button
                  onClick={() => signInWithSoundCloud()}
                  className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
                >
                  Open SoundCloud sign-in
                </button>
              </div>
            )}

            {/* Always visible, not one click deeper — SoundCloud's auto-capture
                is a best-effort guess at where the site keeps its session
                token, so the manual path needs to be a real first-class
                option, not a last resort buried behind a link. */}
            {state !== "checking" && (
              <form onSubmit={handleSubmitToken} className="mt-5 flex flex-col gap-2 border-t border-border pt-4">
                <label className="flex flex-col gap-1 text-left text-sm">
                  <span className="text-muted">Or paste your token instead</span>
                  <input
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    disabled={busy}
                    type="password"
                    placeholder="Signed-in SoundCloud session token"
                    className="rounded-md bg-surface-3 px-3 py-2 text-sm text-fg outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                  />
                </label>
                <p className="text-left text-xs text-muted">
                  On soundcloud.com, sign in, open your browser&rsquo;s dev tools, and copy the
                  value of the <code>Authorization</code> header from any request to
                  api-v2.soundcloud.com (Network tab) — or the token from Local Storage if you
                  know its key.
                </p>
                <button
                  type="submit"
                  disabled={busy || !token.trim()}
                  className="mt-1 rounded-full bg-surface-3 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-3/70 disabled:opacity-50"
                >
                  {submitting ? "Checking..." : "Use this token"}
                </button>
              </form>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
