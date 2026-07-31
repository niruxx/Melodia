import { useMemo } from "react";
import { Heart, Play, Shuffle } from "lucide-react";
import { TrackRow } from "../components/TrackRow";
import { allTracks } from "../lib/mockData";
import { usePlayerStore } from "../store/playerStore";
import { useLibraryStore } from "../store/libraryStore";
import type { Track } from "../lib/types";

export function LikedSongs() {
  const likedIds = usePlayerStore((s) => s.likedIds);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const trackCache = useLibraryStore((s) => s.trackCache);
  const playlistTracksCache = useLibraryStore((s) => s.playlistTracksCache);
  const history = useLibraryStore((s) => s.history.data);

  const tracks = useMemo(() => {
    const known = new Map<string, Track>();
    for (const t of allTracks) known.set(t.id, t);
    for (const t of Object.values(trackCache)) known.set(t.id, t);
    for (const list of Object.values(playlistTracksCache)) {
      for (const t of list) known.set(t.id, t);
    }
    for (const t of history ?? []) known.set(t.id, t);
    return Array.from(known.values()).filter((t) => likedIds[t.id]);
  }, [likedIds, trackCache, playlistTracksCache, history]);

  function handlePlay() {
    if (tracks.length > 0) playTrack(tracks[0], tracks);
  }

  function handleShuffle() {
    if (tracks.length === 0) return;
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    playTrack(shuffled[0], shuffled);
  }

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <div className="flex items-end gap-6">
        <div className="flex h-44 w-44 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-accent-2 shadow-lg shadow-black/50 sm:h-56 sm:w-56">
          <Heart size={72} className="text-white" fill="currentColor" />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Playlist</span>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Liked Songs</h1>
          <p className="text-sm text-muted">{tracks.length} songs</p>
        </div>
      </div>

      {tracks.length > 0 && (
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
      )}

      <div className="flex flex-col gap-1">
        {tracks.length > 0 ? (
          tracks.map((track, i) => (
            <TrackRow key={`${track.id}-${i}`} track={track} index={i} tracks={tracks} />
          ))
        ) : (
          <div className="py-16 text-center text-muted">
            Songs you like will appear here. Tap the heart icon on any song to save it.
          </div>
        )}
      </div>
    </div>
  );
}
