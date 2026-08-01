import { useMemo } from "react";
import { Heart } from "lucide-react";
import { TrackList } from "../components/TrackList";
import { PlayControls } from "../components/PlayControls";
import { allTracks } from "../lib/mockData";
import { usePlayerStore } from "../store/playerStore";
import { useLibraryStore } from "../store/libraryStore";
import type { Track } from "../lib/types";

export function LikedSongs() {
  const likedIds = usePlayerStore((s) => s.likedIds);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const trackCache = useLibraryStore((s) => s.trackCache);
  const playlistCache = useLibraryStore((s) => s.playlistCache);
  const history = useLibraryStore((s) => s.history.data);

  const tracks = useMemo(() => {
    const known = new Map<string, Track>();
    for (const t of allTracks) known.set(t.id, t);
    for (const t of Object.values(trackCache)) known.set(t.id, t);
    for (const detail of Object.values(playlistCache)) {
      for (const t of detail.tracks) known.set(t.id, t);
    }
    for (const t of history ?? []) known.set(t.id, t);
    return Array.from(known.values()).filter((t) => likedIds[t.id]);
  }, [likedIds, trackCache, playlistCache, history]);

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
        <div className="brand-mark flex h-44 w-44 shrink-0 items-center justify-center rounded-xl shadow-lg shadow-black/50 sm:h-56 sm:w-56">
          <Heart size={72} className="text-white" fill="currentColor" />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Playlist</span>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Liked Songs</h1>
          <p className="text-sm text-muted">{tracks.length} songs</p>
        </div>
      </div>

      {tracks.length > 0 && (
        <PlayControls onPlay={handlePlay} onShuffle={handleShuffle} />
      )}

      {tracks.length > 0 ? (
        <TrackList tracks={tracks} />
      ) : (
        <p className="text-muted">
          Songs you like will appear here. Tap the heart icon on any song to save it.
        </p>
      )}
    </div>
  );
}
