import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ExternalLink, Loader2, X } from "lucide-react";
import { useAuthStore } from "../store/authStore";

export function SignInModal() {
  const open = useAuthStore((s) => s.isModalOpen);
  const onClose = useAuthStore((s) => s.closeModal);
  const state = useAuthStore((s) => s.state);
  const oauthConfigured = useAuthStore((s) => s.oauthConfigured);
  const showOAuthFallback = useAuthStore((s) => s.showOAuthFallback);
  const setShowOAuthFallback = useAuthStore((s) => s.setShowOAuthFallback);
  const userCode = useAuthStore((s) => s.userCode);
  const verificationUrl = useAuthStore((s) => s.verificationUrl);
  const error = useAuthStore((s) => s.error);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
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

  async function handleOAuthSignIn() {
    setLocalError(null);
    try {
      await beginSignIn();
    } catch (err) {
      setLocalError(String(err));
    }
  }

  const busy = state === "pending" || state === "google_pending";
  const shownError = error ?? localError;

  // The OAuth fallback covers two screens: entering client credentials (when
  // none are saved) and the device-code flow itself.
  const inOAuthFallback = showOAuthFallback && state !== "signed_in";

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

            {inOAuthFallback && !busy && (
              <button
                onClick={() => setShowOAuthFallback(false)}
                className="absolute left-4 top-4 flex items-center gap-1 text-xs text-muted transition-colors hover:text-fg"
              >
                <ArrowLeft size={14} /> Back
              </button>
            )}

            {/* ---- Primary: one-click Google sign-in ---- */}
            {state === "signed_out" && !inOAuthFallback && (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <h2 className="text-lg font-bold">Connect YouTube Music</h2>
                <p className="text-sm text-muted">
                  Sign in with your Google account to sync your playlists, library, recently
                  played, and search.
                </p>
                {shownError && <p className="text-sm text-red-400">{shownError}</p>}
                <button
                  onClick={() => signInWithGoogle()}
                  className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
                >
                  Sign in with Google
                </button>
                <p className="text-xs text-muted">
                  Opens Google&rsquo;s own sign-in page. No setup required.
                </p>
                <button
                  onClick={() => setShowOAuthFallback(true)}
                  className="mt-2 text-xs text-muted underline transition-colors hover:text-fg"
                >
                  Having trouble? Use the OAuth client method instead
                </button>
              </div>
            )}

            {/* ---- Waiting on the Google login window ---- */}
            {state === "google_pending" && (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <Loader2 size={28} className="animate-spin text-accent" />
                <h2 className="text-lg font-bold">Waiting for Google sign-in</h2>
                <p className="text-sm text-muted">
                  Finish signing in in the Google window. TuneBox picks it up automatically.
                </p>
                <button
                  onClick={cancelSignIn}
                  className="text-xs text-muted underline transition-colors hover:text-fg"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* ---- Fallback step 1: OAuth client credentials ---- */}
            {inOAuthFallback && state !== "pending" && !oauthConfigured && (
              <form onSubmit={handleSaveCredentials} className="flex flex-col gap-4 pt-4">
                <div>
                  <h2 className="text-lg font-bold">Use a Google OAuth client</h2>
                  <p className="mt-1 text-sm text-muted">
                    Fallback method. Create a free Google Cloud OAuth client (type: &ldquo;TVs and
                    Limited Input devices&rdquo;), then paste its Client ID and Secret below.
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
                {shownError && <p className="text-sm text-red-400">{shownError}</p>}
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full bg-accent py-2.5 text-sm font-semibold text-black transition-transform hover:scale-[1.02] disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save & Continue"}
                </button>
              </form>
            )}

            {/* ---- Fallback step 2: start the device-code flow ---- */}
            {inOAuthFallback && state === "signed_out" && oauthConfigured && (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <h2 className="text-lg font-bold">Sign in with a device code</h2>
                <p className="text-sm text-muted">
                  You&rsquo;ll get a short code to enter on google.com/device.
                </p>
                {shownError && <p className="text-sm text-red-400">{shownError}</p>}
                <button
                  onClick={handleOAuthSignIn}
                  className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
                >
                  Get a code
                </button>
              </div>
            )}

            {/* ---- Fallback step 3: the device code itself ---- */}
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
                <button
                  onClick={cancelSignIn}
                  className="text-xs text-muted underline transition-colors hover:text-fg"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Legacy state: OAuth creds were required before browser auth
                existed. Treated as the fallback's first step. */}
            {state === "no_credentials" && !inOAuthFallback && (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <h2 className="text-lg font-bold">Connect YouTube Music</h2>
                <p className="text-sm text-muted">
                  Sign in with your Google account to sync your library.
                </p>
                {shownError && <p className="text-sm text-red-400">{shownError}</p>}
                <button
                  onClick={() => signInWithGoogle()}
                  className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
                >
                  Sign in with Google
                </button>
                <button
                  onClick={() => setShowOAuthFallback(true)}
                  className="mt-2 text-xs text-muted underline transition-colors hover:text-fg"
                >
                  Having trouble? Use the OAuth client method instead
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
