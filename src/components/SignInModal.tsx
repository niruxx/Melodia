import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Loader2, X } from "lucide-react";
import { useAuthStore } from "../store/authStore";

export function SignInModal() {
  const open = useAuthStore((s) => s.isModalOpen);
  const onClose = useAuthStore((s) => s.closeModal);
  const state = useAuthStore((s) => s.state);
  const userCode = useAuthStore((s) => s.userCode);
  const verificationUrl = useAuthStore((s) => s.verificationUrl);
  const error = useAuthStore((s) => s.error);
  const saveCredentials = useAuthStore((s) => s.saveCredentials);
  const beginSignIn = useAuthStore((s) => s.beginSignIn);
  const cancelSignIn = useAuthStore((s) => s.cancelSignIn);

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSaveCredentials(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setSaving(true);
    try {
      await saveCredentials(clientId.trim(), clientSecret.trim());
    } catch (err) {
      setLocalError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSignIn() {
    setLocalError(null);
    try {
      await beginSignIn();
    } catch (err) {
      setLocalError(String(err));
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
            onClick={state === "pending" ? undefined : onClose}
            className="fixed inset-0 z-50 bg-black/60"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18 }}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface-2 p-6 shadow-2xl"
          >
            {state !== "pending" && (
              <button
                onClick={onClose}
                className="absolute right-4 top-4 text-muted hover:text-fg"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            )}

            {state === "no_credentials" && (
              <form onSubmit={handleSaveCredentials} className="flex flex-col gap-4">
                <div>
                  <h2 className="text-lg font-bold">Connect your Google OAuth client</h2>
                  <p className="mt-1 text-sm text-muted">
                    TuneBox needs a free Google Cloud OAuth client (type: &ldquo;TVs and Limited
                    Input devices&rdquo;) to sign in. In Google Cloud Console: create a project,
                    configure the OAuth consent screen, then create a credential of that type and
                    paste its Client ID and Client Secret below.
                  </p>
                </div>
                <label className="flex flex-col gap-1 text-sm">
                  Client ID
                  <input
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    required
                    className="rounded-md bg-surface-3 px-3 py-2 text-sm text-fg outline-none focus:ring-1 focus:ring-accent"
                    placeholder="xxxxxxxx.apps.googleusercontent.com"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Client Secret
                  <input
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    required
                    type="password"
                    className="rounded-md bg-surface-3 px-3 py-2 text-sm text-fg outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
                {localError && <p className="text-sm text-red-400">{localError}</p>}
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full bg-accent py-2.5 text-sm font-semibold text-black transition-transform hover:scale-[1.02] disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save & Continue"}
                </button>
              </form>
            )}

            {state === "signed_out" && (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <h2 className="text-lg font-bold">Connect YouTube Music</h2>
                <p className="text-sm text-muted">
                  Sign in with your Google account to sync your playlists, library, and recently
                  played.
                </p>
                {(error || localError) && (
                  <p className="text-sm text-red-400">{error ?? localError}</p>
                )}
                <button
                  onClick={handleSignIn}
                  className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
                >
                  Sign in with Google
                </button>
              </div>
            )}

            {state === "pending" && (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <Loader2 size={28} className="animate-spin text-accent" />
                <h2 className="text-lg font-bold">Enter this code to sign in</h2>
                <div className="rounded-lg bg-surface-3 px-6 py-3 text-3xl font-bold tracking-widest">
                  {userCode}
                </div>
                <button
                  onClick={() => verificationUrl && openUrl(verificationUrl)}
                  className="flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
                >
                  Open google.com/device <ExternalLink size={14} />
                </button>
                <p className="text-xs text-muted">
                  Waiting for you to finish signing in in your browser...
                </p>
                <button onClick={cancelSignIn} className="text-xs text-muted underline hover:text-fg">
                  Cancel
                </button>
              </div>
            )}

            {state === "checking" && (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={24} className="animate-spin text-accent" />
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
