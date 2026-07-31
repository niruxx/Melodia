import { ChevronLeft, ChevronRight, Search, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuthStore } from "../store/authStore";
import { useDiscordStore } from "../store/discordStore";

export function TopBar() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const authState = useAuthStore((s) => s.state);
  const openModal = useAuthStore((s) => s.openModal);
  const doSignOut = useAuthStore((s) => s.doSignOut);
  const isSignedIn = authState === "signed_in";
  const openSettings = useDiscordStore((s) => s.openSettings);

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
        <div className="flex items-center gap-3 rounded-full bg-surface-2 px-4 py-2.5 text-sm text-muted transition-colors focus-within:bg-surface-3">
          <Search size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What do you want to play?"
            className="w-full bg-transparent text-fg outline-none placeholder:text-muted"
          />
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
