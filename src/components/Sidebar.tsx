import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Home, Search, Library, Heart, Plus } from "lucide-react";
import clsx from "clsx";
import { usePlayerStore } from "../store/playerStore";
import { useAuthStore } from "../store/authStore";
import { useLibraryStore } from "../store/libraryStore";
import { useScAuthStore } from "../store/scAuthStore";
import { useScLibraryStore } from "../store/scLibraryStore";
import { useSourceStore, type MusicSource } from "../store/sourceStore";
import { useLocalLibraryStore } from "../store/localLibraryStore";
import { usePlaylistModalStore } from "../store/playlistModalStore";
import { useUiThemeStore } from "../store/uiThemeStore";
import { useWallpaperStore } from "../store/wallpaperStore";
import { CoverArt } from "./CoverArt";
import { AppIcon } from "./AppIcon";

const navItems = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/search", label: "Search", icon: Search, end: false },
];

const sources: { id: MusicSource; label: string }[] = [
  { id: "youtube", label: "YouTube" },
  { id: "soundcloud", label: "SoundCloud" },
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
  const isScSignedIn = useScAuthStore((s) => s.state === "signed_in");
  const scPlaylists = useScLibraryStore((s) => s.playlists.data) ?? [];
  const scArrivedId = useScLibraryStore((s) => s.arrivedId);
  const clearScArrived = useScLibraryStore((s) => s.clearArrived);
  const activeSource = useSourceStore((s) => s.active);
  const setActiveSource = useSourceStore((s) => s.setActive);
  const localAlbums = useLocalLibraryStore((s) => s.albums);
  const openCreatePlaylist = usePlaylistModalStore((s) => s.openCreate);
  const washSidebar = useUiThemeStore((s) => s.washSidebar);
  const wallpaper = useWallpaperStore((s) => s.enabled);
  const arrivedId = useLibraryStore((s) => s.arrivedId);
  const clearArrived = useLibraryStore((s) => s.clearArrived);

  // Cleared once the animation has run, so re-rendering the list later (a
  // filter change, a refetch) doesn't replay it on a playlist that is no
  // longer new.
  useEffect(() => {
    if (!arrivedId) return;
    const id = setTimeout(clearArrived, 1600);
    return () => clearTimeout(id);
  }, [arrivedId, clearArrived]);

  useEffect(() => {
    if (!scArrivedId) return;
    const id = setTimeout(clearScArrived, 1600);
    return () => clearTimeout(id);
  }, [scArrivedId, clearScArrived]);

  const isLocal = activeSource === "local";
  const isSoundCloud = activeSource === "soundcloud";
  // Each source keeps its own library entirely separate — see sourceStore.ts's
  // "own tab, own state" convention — so which list/sign-in-state applies is
  // one lookup per source rather than a chain of ad hoc booleans.
  const sourceSignedIn = isSoundCloud ? isScSignedIn : isSignedIn;
  const allCollections = isLocal
    ? localAlbums
    : isSoundCloud
      ? (isScSignedIn ? scPlaylists : [])
      : isSignedIn
        ? [...playlists, ...albums]
        : [];
  const items = allCollections.filter((c) => filter === "all" || c.kind === filter);
  const activeArrivedId = isSoundCloud ? scArrivedId : arrivedId;

  function handleSourceChange(source: MusicSource) {
    setActiveSource(source);
    if (source === "local") navigate("/library");
  }

  return (
    <aside
      className={clsx(
        "flex h-full min-h-0 w-72 shrink-0 flex-col gap-2 px-2 py-2",
        // Both only paint `background-image`, so this swaps the sidebar's
        // default lift for the content panel's album-art wash without
        // disturbing its own base colour.
        washSidebar ? "chrome-wash" : "chrome-panel",
        // Opaque normally; sheer enough to show the artwork wallpaper behind
        // it when that's on, so the window reads as one surface.
        wallpaper ? "bg-black/70" : "bg-black",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <AppIcon className="h-7 w-7 rounded-md" />
        <span className="text-lg font-bold tracking-tight">Melodia</span>
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
          {/* Creating playlists goes through a signed-in account, so it's
              hidden for local playback and while signed out. */}
          {!isLocal && sourceSignedIn && (
            <motion.button
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: 0.88 }}
              transition={{ type: "spring", stiffness: 500, damping: 22 }}
              onClick={() => openCreatePlaylist()}
              className="ml-auto rounded-full p-1 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              title="Create playlist"
              aria-label="Create playlist"
            >
              <Plus size={18} />
            </motion.button>
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
          {!isLocal && !sourceSignedIn && (
            <p className="px-2 py-3 text-xs text-muted">
              {isSoundCloud
                ? "Connect your SoundCloud account to see your playlists here."
                : "Connect your YouTube Music account to see your playlists and albums here."}
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
                    // Only the playlist that was just created, and only once.
                    c.id === activeArrivedId && "arrive",
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
