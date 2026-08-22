import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Cloud,
  Disc3,
  Heart,
  Home,
  Library,
  ListMusic,
  Moon,
  Music2,
  Search,
  Settings,
  Shuffle,
  MonitorPlay,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import { useUiStore } from "../store/uiStore";
import { usePlayerStore } from "../store/playerStore";
import { useLibraryStore } from "../store/libraryStore";
import { useLocalLibraryStore } from "../store/localLibraryStore";
import { useSourceStore } from "../store/sourceStore";
import { useDiscordStore } from "../store/discordStore";
import { useAudioSettingsStore } from "../store/audioSettingsStore";
import { toast } from "../store/toastStore";
import { fuzzyFilter } from "../lib/fuzzy";

type Command = {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
};

export function CommandPalette() {
  const open = useUiStore((s) => s.isPaletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const playlists = useLibraryStore((s) => s.playlists.data);
  const albums = useLibraryStore((s) => s.albums.data);
  const history = useLibraryStore((s) => s.history.data);
  const localAlbums = useLocalLibraryStore((s) => s.albums);
  const localTracks = useLocalLibraryStore((s) => s.tracks);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: "nav-home", label: "Go to Home", icon: Home, run: () => navigate("/") },
      { id: "nav-search", label: "Go to Search", icon: Search, run: () => navigate("/search") },
      { id: "nav-library", label: "Go to Library", icon: Library, run: () => navigate("/library") },
      { id: "nav-liked", label: "Go to Liked Songs", icon: Heart, run: () => navigate("/liked") },
      {
        id: "src-youtube",
        label: "Switch to YouTube Music",
        icon: MonitorPlay,
        run: () => useSourceStore.getState().setActive("youtube"),
      },
      {
        id: "src-soundcloud",
        label: "Switch to SoundCloud",
        icon: Cloud,
        run: () => useSourceStore.getState().setActive("soundcloud"),
      },
      {
        id: "src-local",
        label: "Switch to Local files",
        icon: Music2,
        run: () => {
          useSourceStore.getState().setActive("local");
          navigate("/library");
        },
      },
      {
        id: "toggle-shuffle",
        label: "Toggle shuffle",
        icon: Shuffle,
        run: () => usePlayerStore.getState().toggleShuffle(),
      },
      {
        id: "toggle-queue",
        label: "Toggle queue",
        icon: ListMusic,
        run: () => {
          const p = usePlayerStore.getState();
          p.setQueueOpen(!p.isQueueOpen);
        },
      },
      {
        id: "settings",
        label: "Open settings",
        icon: Settings,
        run: () => useDiscordStore.getState().openSettings(),
      },
    ];

    for (const minutes of [15, 30, 60]) {
      list.push({
        id: `sleep-${minutes}`,
        label: `Sleep timer: ${minutes} minutes`,
        icon: Moon,
        run: () => {
          useAudioSettingsStore.getState().startSleepTimer(minutes);
          toast.success(`Sleep timer set for ${minutes} minutes`);
        },
      });
    }

    const collections = [...(playlists ?? []), ...(albums ?? []), ...localAlbums];
    for (const c of collections) {
      list.push({
        id: `col-${c.id}`,
        label: c.title,
        hint: c.kind === "album" ? "Album" : "Playlist",
        icon: Disc3,
        run: () => navigate(`/playlist/${c.id}`),
      });
    }

    // Tracks the user can actually resolve instantly (already in memory).
    const tracks = [...localTracks, ...(history ?? [])];
    const seen = new Set<string>();
    for (const t of tracks) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      list.push({
        id: `track-${t.id}`,
        label: t.title,
        hint: t.artist,
        icon: Music2,
        run: () => usePlayerStore.getState().playTrack(t, tracks),
      });
    }

    return list;
  }, [playlists, albums, localAlbums, localTracks, history, navigate]);

  const results = useMemo(
    () => fuzzyFilter(commands, query, (c) => `${c.label} ${c.hint ?? ""}`, 30),
    [commands, query],
  );

  // Reset per-open so it never reopens showing a stale query/selection.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // Focus after the entrance animation has begun so it isn't stolen back.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = results[active];
      if (cmd) {
        cmd.run();
        setOpen(false);
      }
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
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[68] bg-black/60"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18 }}
            className="fixed left-1/2 top-[15%] z-[68] w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface-2 shadow-2xl shadow-black/60"
          >
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search size={18} className="shrink-0 text-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search songs, albums, and actions…"
                className="w-full bg-transparent py-4 text-sm outline-none placeholder:text-muted"
              />
            </div>

            <div ref={listRef} className="no-scrollbar max-h-80 overflow-y-auto p-2">
              {results.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted">No matches.</p>
              )}
              {results.map((cmd, i) => (
                <button
                  key={cmd.id}
                  data-index={i}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    cmd.run();
                    setOpen(false);
                  }}
                  className={clsx(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                    i === active ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-3/60",
                  )}
                >
                  <cmd.icon size={16} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-fg">{cmd.label}</span>
                  {cmd.hint && <span className="shrink-0 text-xs text-muted">{cmd.hint}</span>}
                </button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
