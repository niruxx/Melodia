import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Play, Shuffle } from "lucide-react";
import { CoverArt } from "../components/CoverArt";
import { TrackRow } from "../components/TrackRow";
import { SignInPrompt } from "../components/SignInPrompt";
import { usePlayerStore } from "../store/playerStore";
import { useAuthStore } from "../store/authStore";
import { useLibraryStore } from "../store/libraryStore";
import { useSourceStore } from "../store/sourceStore";
import { useLocalLibraryStore } from "../store/localLibraryStore";
import type { Track } from "../lib/types";

export function Playlist() {
  const { id } = useParams<{ id: string }>();
  const authState = useAuthStore((s) => s.state);
  const isLocal = useSourceStore((s) => s.active === "local");

  // Subscribe to these slices so this page re-renders once library data arrives.
  useLibraryStore((s) => s.playlists.data);
  useLibraryStore((s) => s.albums.data);
  useLibraryStore((s) => s.home.data);
  useLibraryStore((s) => s.trackCache);
  const findCollection = useLibraryStore((s) => s.findCollection);
  const getPlaylistTracks = useLibraryStore((s) => s.getPlaylistTracks);
  const playTrack = usePlayerStore((s) => s.playTrack);

  const localAlbums = useLocalLibraryStore((s) => s.albums);
  const localTracks = useLocalLibraryStore((s) => s.tracks);

  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const localCollection = isLocal ? localAlbums.find((c) => c.id === id) : undefined;
  const collection = isLocal ? localCollection : id ? findCollection(id) : undefined;

  useEffect(() => {
    if (!id || isLocal) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPlaylistTracks(id)
      .then((t) => {
        if (!cancelled) setTracks(t);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, isLocal, getPlaylistTracks]);

  useEffect(() => {
    if (!isLocal || !localCollection) return;
    const byId = new Map(localTracks.map((t) => [t.id, t]));
    setTracks(localCollection.trackIds.map((tid) => byId.get(tid)).filter((t) => t != null));
    setLoading(false);
    setError(null);
  }, [isLocal, localCollection, localTracks]);

  if (!isLocal && authState !== "signed_in") {
    return <SignInPrompt />;
  }

  if (!collection) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        {loading ? <Loader2 size={24} className="animate-spin text-accent" /> : "Playlist not found."}
      </div>
    );
  }

  const trackList = tracks ?? [];
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
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-accent" />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <button
              onClick={handlePlay}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-black shadow-lg shadow-black/40 transition-transform hover:scale-105"
              aria-label="Play"
            >
              <Play size={20} fill="currentColor" className="ml-0.5" />
            </button>
            <button
              onClick={handleShuffle}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-muted hover:text-fg"
              aria-label="Shuffle play"
            >
              <Shuffle size={18} />
            </button>
          </div>

          <div className="flex flex-col gap-1">
            {trackList.map((track, i) => (
              <TrackRow key={`${track.id}-${i}`} track={track} index={i} tracks={trackList} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
