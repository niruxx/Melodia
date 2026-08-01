import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Plus, X } from "lucide-react";
import { CoverArt } from "./CoverArt";
import { useLibraryStore } from "../store/libraryStore";
import { usePlaylistModalStore } from "../store/playlistModalStore";
import { toast } from "../store/toastStore";

/** Destination picker for "Add to playlist". */
export function AddToPlaylistModal() {
  const tracks = usePlaylistModalStore((s) => s.pendingAdd);
  const close = usePlaylistModalStore((s) => s.closeAddTo);
  const openCreate = usePlaylistModalStore((s) => s.openCreate);
  const playlists = useLibraryStore((s) => s.playlists.data);
  const addTracksToPlaylist = useLibraryStore((s) => s.addTracksToPlaylist);

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const count = tracks?.length ?? 0;
  const options = playlists ?? [];

  async function handlePick(id: string, title: string) {
    if (!tracks || pendingId) return;
    setPendingId(id);
    setError(null);
    try {
      await addTracksToPlaylist(id, tracks);
      toast.success(`Added ${count} song${count === 1 ? "" : "s"} to "${title}"`);
      close();
    } catch (e) {
      // Most often this is a playlist the account doesn't own (YouTube's
      // auto-generated mixes, or someone else's saved playlist).
      setError(String(e));
      setPendingId(null);
    }
  }

  return (
    <AnimatePresence>
      {tracks && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
            className="fixed inset-0 z-50 bg-black/60"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18 }}
            className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-surface-2 p-6 shadow-2xl"
          >
            <button
              onClick={close}
              className="absolute right-4 top-4 text-muted hover:text-fg"
              aria-label="Close"
            >
              <X size={18} />
            </button>

            <h2 className="text-lg font-bold">Add to playlist</h2>
            <p className="mt-1 text-sm text-muted">
              {count === 1 ? tracks[0].title : `${count} songs`}
            </p>

            <button
              onClick={() => openCreate(tracks)}
              className="mt-5 flex items-center gap-3 rounded-lg bg-surface-3 px-3 py-2.5 text-left text-sm font-semibold hover:bg-surface"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface">
                <Plus size={18} />
              </div>
              New playlist
            </button>

            <div className="no-scrollbar mt-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
              {options.length === 0 && (
                <p className="py-6 text-center text-sm text-muted">No playlists in your library yet.</p>
              )}
              {options.map((playlist) => (
                <button
                  key={playlist.id}
                  onClick={() => handlePick(playlist.id, playlist.title)}
                  disabled={pendingId !== null}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-3 disabled:opacity-50"
                >
                  <CoverArt
                    seed={playlist.id}
                    src={playlist.thumbnail}
                    className="h-10 w-10 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-fg">{playlist.title}</div>
                    <div className="truncate text-xs text-muted">{playlist.subtitle}</div>
                  </div>
                  {pendingId === playlist.id && (
                    <Loader2 size={16} className="shrink-0 animate-spin text-accent" />
                  )}
                </button>
              ))}
            </div>

            {error && <p className="mt-3 shrink-0 text-sm text-red-400">{error}</p>}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
