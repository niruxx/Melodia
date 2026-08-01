import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { CoverArt } from "../components/CoverArt";
import { TrackList } from "../components/TrackList";
import { PlayControls } from "../components/PlayControls";
import { Skeleton, TrackListSkeleton } from "../components/Skeleton";
import { SignInPrompt } from "../components/SignInPrompt";
import { usePlayerStore } from "../store/playerStore";
import { useAuthStore } from "../store/authStore";
import { useLibraryStore } from "../store/libraryStore";
import { useSourceStore } from "../store/sourceStore";
import { useLocalLibraryStore } from "../store/localLibraryStore";
import { useContextMenuStore } from "../store/contextMenuStore";
import { usePlaylistModalStore } from "../store/playlistModalStore";
import { toast } from "../store/toastStore";
import type { Track } from "../lib/types";

export function Playlist() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const authState = useAuthStore((s) => s.state);
  const isLocal = useSourceStore((s) => s.active === "local");

  // Subscribe to these slices so this page re-renders once library data arrives.
  useLibraryStore((s) => s.playlists.data);
  useLibraryStore((s) => s.albums.data);
  useLibraryStore((s) => s.home.data);
  const trackCache = useLibraryStore((s) => s.trackCache);
  const detail = useLibraryStore((s) => (id ? s.playlistCache[id] : undefined));
  const findCollection = useLibraryStore((s) => s.findCollection);
  const getPlaylistDetail = useLibraryStore((s) => s.getPlaylistDetail);
  const removeTrackFromPlaylist = useLibraryStore((s) => s.removeTrackFromPlaylist);
  const reorderPlaylistTracks = useLibraryStore((s) => s.reorderPlaylistTracks);
  const deletePlaylist = useLibraryStore((s) => s.deletePlaylist);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const openMenu = useContextMenuStore((s) => s.openMenu);
  const openEdit = usePlaylistModalStore((s) => s.openEdit);

  const localAlbums = useLocalLibraryStore((s) => s.albums);
  const localTracks = useLocalLibraryStore((s) => s.tracks);

  const [remoteLoading, setRemoteLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Holds the in-flight order while a row is being dragged; the store only
  // hears about it on drop, so one drag is one request.
  const [draftOrder, setDraftOrder] = useState<Track[] | null>(null);

  const localCollection = isLocal ? localAlbums.find((c) => c.id === id) : undefined;
  const collection = isLocal ? localCollection : id ? findCollection(id) : undefined;

  useEffect(() => {
    if (!id || isLocal) return;
    let cancelled = false;
    setRemoteLoading(true);
    setError(null);
    getPlaylistDetail(id)
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setRemoteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, isLocal, getPlaylistDetail]);

  const localTrackList = useMemo(() => {
    if (!isLocal || !localCollection) return [];
    const byId = new Map(localTracks.map((t) => [t.id, t]));
    return localCollection.trackIds.map((tid) => byId.get(tid)).filter((t) => t != null);
  }, [isLocal, localCollection, localTracks]);

  const remoteTrackList = useMemo(() => {
    if (!id) return [];
    // Home's bare songs are surfaced as synthetic single-track collections and
    // have no playlist behind them to fetch.
    if (id.startsWith("song-")) {
      const track = trackCache[id.slice("song-".length)];
      return track ? [track] : [];
    }
    return detail?.tracks ?? [];
  }, [id, detail, trackCache]);

  const loading = isLocal ? false : remoteLoading;
  const storedTrackList = isLocal ? localTrackList : remoteTrackList;
  const trackList = draftOrder ?? storedTrackList;
  const canEdit = !isLocal && detail?.owned === true;

  async function handleRemoveTrack(track: Track) {
    if (!id) return;
    try {
      await removeTrackFromPlaylist(id, track);
      toast.success(`Removed "${track.title}"`);
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function handleReorderEnd() {
    if (!id || !draftOrder) return;
    const next = draftOrder;
    try {
      // Clears the draft only once the store holds the new order, so the list
      // never flashes back through its old arrangement.
      await reorderPlaylistTracks(id, next);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDraftOrder(null);
    }
  }

  async function handleDelete() {
    if (!id || deleting) return;
    setDeleting(true);
    try {
      await deletePlaylist(id);
      toast.success("Playlist deleted");
      setConfirmingDelete(false);
      navigate("/library");
    } catch (e) {
      toast.error(String(e));
      setDeleting(false);
    }
  }

  function openOverflowMenu(event: React.MouseEvent) {
    if (!collection) return;
    const rect = event.currentTarget.getBoundingClientRect();
    openMenu(rect.left, rect.bottom + 4, [
      {
        label: "Edit details",
        icon: Pencil,
        onSelect: () => openEdit(collection),
      },
      { kind: "separator" },
      {
        label: "Delete playlist",
        icon: Trash2,
        danger: true,
        onSelect: () => setConfirmingDelete(true),
      },
    ]);
  }

  if (!isLocal && authState !== "signed_in") {
    return <SignInPrompt />;
  }

  if (!collection) {
    if (!loading) {
      return (
        <div className="flex h-full items-center justify-center text-muted">Playlist not found.</div>
      );
    }
    return (
      <div className="flex flex-col gap-6 px-6 py-6">
        <div className="flex items-end gap-6">
          <Skeleton className="h-44 w-44 rounded-xl sm:h-56 sm:w-56" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <TrackListSkeleton rows={10} />
      </div>
    );
  }

  const totalSeconds = trackList.reduce((sum, t) => sum + t.duration, 0);
  const totalMinutes = Math.round(totalSeconds / 60);

  function handlePlay() {
    if (trackList.length > 0) playTrack(trackList[0], trackList);
  }

  function handleShuffle() {
    if (trackList.length === 0) return;
    const shuffled = [...trackList].sort(() => Math.random() - 0.5);
    playTrack(shuffled[0], shuffled);
  }

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <div className="flex items-end gap-6">
        <CoverArt
          seed={collection.id}
          src={collection.thumbnail}
          rounded="lg"
          className="h-44 w-44 sm:h-56 sm:w-56"
        />
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            {collection.kind}
          </span>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{collection.title}</h1>
          <p className="text-muted">{collection.subtitle}</p>
          {!loading && (
            <p className="text-sm text-muted">
              {trackList.length} songs &middot; {totalMinutes} min
            </p>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <TrackListSkeleton rows={10} />
      ) : (
        <>
          <div className="flex items-center gap-4">
            <PlayControls onPlay={handlePlay} onShuffle={handleShuffle} />
            {canEdit && (
              <button
                onClick={openOverflowMenu}
                className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                aria-label="More options"
              >
                <MoreHorizontal size={20} />
              </button>
            )}
          </div>

          <TrackList
            tracks={trackList}
            onRemoveTrack={canEdit ? handleRemoveTrack : undefined}
            onReorder={canEdit ? setDraftOrder : undefined}
            onReorderEnd={canEdit ? handleReorderEnd : undefined}
          />
        </>
      )}

      <AnimatePresence>
        {confirmingDelete && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !deleting && setConfirmingDelete(false)}
              className="fixed inset-0 z-50 bg-black/60"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.18 }}
              className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface-2 p-6 shadow-2xl"
            >
              <h2 className="text-lg font-bold">Delete this playlist?</h2>
              <p className="mt-2 text-sm text-muted">
                "{collection.title}" will be removed from your YouTube Music account. This can't be
                undone.
              </p>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                  className="rounded-full px-4 py-2 text-sm font-semibold text-muted hover:text-fg disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex items-center gap-2 rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white transition-transform hover:scale-105 disabled:opacity-50"
                >
                  {deleting && <Loader2 size={14} className="animate-spin" />}
                  Delete
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
