import { ChevronLeft, ChevronRight, Search, Settings, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../store/authStore";
import { useDiscordStore } from "../store/discordStore";

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

export function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const authState = useAuthStore((s) => s.state);
  const openModal = useAuthStore((s) => s.openModal);
  const doSignOut = useAuthStore((s) => s.doSignOut);
  const isSignedIn = authState === "signed_in";
  const openSettings = useDiscordStore((s) => s.openSettings);

  // Read inside the debounce callback so it sees the current route without
  // being an effect dependency — depending on it would re-run the effect on
  // every navigation.
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  // Only an actual keystroke may trigger a search navigation. Without this
  // guard, anything that re-runs the effect (notably a route change) would
  // re-navigate to /search while text was still in the box, yanking the user
  // back out of the tab they just clicked.
  const typedRef = useRef(false);

  function handleQueryChange(value: string) {
    typedRef.current = true;
    setQuery(value);
  }

  // Search as the user types, debounced so a remote lookup doesn't fire on
  // every keystroke. `replace` keeps the back button useful instead of
  // stacking one history entry per character.
  useEffect(() => {
    if (!typedRef.current) return;
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return;
    const id = setTimeout(() => {
      typedRef.current = false;
      navigate(`/search?q=${encodeURIComponent(trimmed)}`, {
        replace: pathnameRef.current === "/search",
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query, navigate]);

  // Leaving the search page cancels the search outright: drop any pending
  // navigation and empty the box, so a stale query can't pull the user back.
  useEffect(() => {
    if (location.pathname !== "/search") {
      typedRef.current = false;
      setQuery("");
    }
  }, [location.pathname]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    typedRef.current = false;
    navigate(`/search${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  }

  return (
    // Transparent so the ambient wash reaches the top of the panel. An opaque
    // fill here would clip the gradient to below the search bar.
    <header className="relative flex h-16 shrink-0 items-center justify-between gap-4 px-6">
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate(-1)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-black text-fg transition-transform hover:scale-105"
          aria-label="Go back"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={() => navigate(1)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-black text-fg transition-transform hover:scale-105"
          aria-label="Go forward"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <form onSubmit={submitSearch} className="w-full max-w-md">
        <div className="flex items-center gap-3 rounded-full bg-surface-2 px-4 py-2.5 text-sm text-muted transition-colors focus-within:bg-surface-3 focus-within:ring-1 focus-within:ring-accent/40">
          <Search size={18} className="shrink-0" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="What do you want to play?    /"
            className="w-full bg-transparent text-fg outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                // Cancel any in-flight debounce too, so clearing the box
                // can't be followed by a stray navigation to /search.
                typedRef.current = false;
                setQuery("");
                inputRef.current?.focus();
              }}
              className="shrink-0 transition-colors hover:text-fg"
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </form>

      <div className="flex items-center gap-3">
        <button
          onClick={openSettings}
          title="Settings"
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-transform hover:scale-105 hover:text-fg"
        >
          <Settings size={18} />
        </button>
        <button
          onClick={() => (isSignedIn ? setConfirmingSignOut(true) : openModal())}
          title={isSignedIn ? "Signed in — click to sign out" : "Connect YouTube Music"}
          className={
            "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-transform hover:scale-105 " +
            (isSignedIn ? "bg-accent text-black" : "bg-surface-3 text-fg")
          }
        >
          Y
        </button>
      </div>

      {/* Signing out deletes the stored Google session and needs a full
          re-login to undo, so it doesn't happen on a single stray click. */}
      <AnimatePresence>
        {confirmingSignOut && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmingSignOut(false)}
              className="fixed inset-0 z-50 bg-black/60"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.18 }}
              className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface-2 p-6 shadow-2xl"
            >
              <h2 className="text-lg font-bold">Sign out of YouTube Music?</h2>
              <p className="mt-2 text-sm text-muted">
                You&rsquo;ll need to sign in with Google again to get your library back.
              </p>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  onClick={() => setConfirmingSignOut(false)}
                  className="rounded-full px-4 py-2 text-sm font-semibold text-muted hover:text-fg"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setConfirmingSignOut(false);
                    void doSignOut();
                  }}
                  className="rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white transition-transform hover:scale-105"
                >
                  Sign out
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </header>
  );
}
