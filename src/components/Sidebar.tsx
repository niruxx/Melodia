import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Home, Search, Library, Heart, Plus } from "lucide-react";
import clsx from "clsx";
import { usePlayerStore } from "../store/playerStore";
import { useAuthStore } from "../store/authStore";
import { useLibraryStore } from "../store/libraryStore";
import { useSourceStore, type MusicSource } from "../store/sourceStore";
import { useLocalLibraryStore } from "../store/localLibraryStore";
import { usePlaylistModalStore } from "../store/playlistModalStore";
import { CoverArt } from "./CoverArt";

const navItems = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/search", label: "Search", icon: Search, end: false },
];

const sources: { id: MusicSource; label: string }[] = [
  { id: "youtube", label: "YouTube" },
  { id: "local", label: "Local" },
];

const filters = [
  { id: "all", label: "All" },
  { id: "playlist", label: "Playlists" },
  { id: "album", label: "Albums" },
] as const;

type Filter = (typeof filters)[number]["id"];

export function Sidebar() {
  const [filter, setFilter] = useState<Filter>("all");
  const navigate = useNavigate();
  const likedCount = usePlayerStore((s) => Object.values(s.likedIds).filter(Boolean).length);
  const isSignedIn = useAuthStore((s) => s.state === "signed_in");
  const playlists = useLibraryStore((s) => s.playlists.data) ?? [];
  const albums = useLibraryStore((s) => s.albums.data) ?? [];
  const activeSource = useSourceStore((s) => s.active);
  const setActiveSource = useSourceStore((s) => s.setActive);
  const localAlbums = useLocalLibraryStore((s) => s.albums);
  const openCreatePlaylist = usePlaylistModalStore((s) => s.openCreate);

  const isLocal = activeSource === "local";
  const allCollections = isLocal ? localAlbums : isSignedIn ? [...playlists, ...albums] : [];
  const items = allCollections.filter((c) => filter === "all" || c.kind === filter);

  function handleSourceChange(source: MusicSource) {
    setActiveSource(source);
    if (source === "local") navigate("/library");
  }

  return (
    <aside className="flex h-full min-h-0 w-72 shrink-0 flex-col gap-2 bg-black px-2 py-2">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="brand-mark h-7 w-7 rounded-md" />
        <span className="text-lg font-bold tracking-tight">TuneBox</span>
      </div>

      <div className="flex gap-2 px-3 pb-1">
        {sources.map((s) => (
          <button
            key={s.id}
            onClick={() => handleSourceChange(s.id)}
            className={clsx(
              "pill flex-1 px-3 py-1.5 text-xs font-semibold transition-colors",
              activeSource === s.id ? "bg-fg text-black" : "bg-surface-2 text-fg hover:bg-surface-3",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <nav className="flex flex-col gap-1 rounded-lg bg-surface px-2 py-2">
        {navItems
          .filter((item) => !isLocal || item.to !== "/")
          .map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-4 rounded-md px-3 py-2 text-sm font-semibold transition-colors",
                isActive ? "text-fg" : "text-muted hover:text-fg",
              )
            }
          >
            <Icon size={22} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg bg-surface">
        <div className="flex items-center gap-2 px-4 pb-2 pt-3">
          <Library size={20} className="text-muted" />
          <span className="text-sm font-semibold text-fg">Your Library</span>
          {/* Creating playlists goes through the signed-in YouTube account, so
              it's hidden for local playback and while signed out. */}
          {!isLocal && isSignedIn && (
            <button
              onClick={() => openCreatePlaylist()}
              className="ml-auto rounded-full p-1 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              title="Create playlist"
              aria-label="Create playlist"
            >
              <Plus size={18} />
            </button>
          )}
        </div>

        <div className="flex gap-2 px-3 pb-2">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={clsx(
                "pill px-3 py-1.5 text-xs font-semibold transition-colors",
                filter === f.id
                  ? "bg-fg text-black"
                  : "bg-surface-2 text-fg hover:bg-surface-3",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <NavLink
          to="/liked"
          className={({ isActive }) =>
            clsx(
              "mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors",
              isActive ? "bg-surface-2" : "hover:bg-surface-2",
            )
          }
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-accent-2">
            <Heart size={18} className="text-white" fill="currentColor" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium text-fg">Liked Songs</div>
            <div className="truncate text-xs text-muted">{likedCount} liked songs</div>
          </div>
        </NavLink>

        <div className="no-scrollbar mt-1 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {isLocal && items.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted">
              Pick a local music folder in Settings to see your albums here.
            </p>
          )}
          {!isLocal && !isSignedIn && (
            <p className="px-2 py-3 text-xs text-muted">
              Connect your YouTube Music account to see your playlists and albums here.
            </p>
          )}
          <div className="flex flex-col gap-0.5">
            {items.map((c) => (
              <NavLink
                key={c.id}
                to={`/playlist/${c.id}`}
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors",
                    isActive ? "bg-surface-2" : "hover:bg-surface-2",
                  )
                }
              >
                <CoverArt seed={c.id} src={c.thumbnail} className="h-10 w-10 shrink-0" />
                <div className="min-w-0">
                  <div className="truncate font-medium text-fg">{c.title}</div>
                  <div className="truncate text-xs text-muted capitalize">
                    {c.kind} &middot; {c.subtitle}
                  </div>
                </div>
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
