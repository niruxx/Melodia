import { ChevronLeft, ChevronRight, Search, Settings, X } from "lucide-react";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const authState = useAuthStore((s) => s.state);
  const openModal = useAuthStore((s) => s.openModal);
  const doSignOut = useAuthStore((s) => s.doSignOut);
  const isSignedIn = authState === "signed_in";
  const openSettings = useDiscordStore((s) => s.openSettings);

  // Search as the user types, debounced so a remote lookup doesn't fire on
  // every keystroke. `replace` keeps the back button useful instead of
  // stacking one history entry per character.
  const onSearchPage = location.pathname === "/search";
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return;
    const id = setTimeout(() => {
      navigate(`/search?q=${encodeURIComponent(trimmed)}`, { replace: onSearchPage });
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query, navigate, onSearchPage]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    navigate(`/search${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  }

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 bg-base px-6">
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
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What do you want to play?    /"
            className="w-full bg-transparent text-fg outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
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
          onClick={() => (isSignedIn ? doSignOut() : openModal())}
          title={isSignedIn ? "Signed in — click to sign out" : "Connect YouTube Music"}
          className={
            "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-transform hover:scale-105 " +
            (isSignedIn ? "bg-accent text-black" : "bg-surface-3 text-fg")
          }
        >
          Y
        </button>
      </div>
    </header>
  );
}
