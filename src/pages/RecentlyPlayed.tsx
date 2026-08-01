import { History } from "lucide-react";
import { TrackList } from "../components/TrackList";
import { PlayControls } from "../components/PlayControls";
import { TrackListSkeleton } from "../components/Skeleton";
import { SignInPrompt } from "../components/SignInPrompt";
import { useAuthStore } from "../store/authStore";
import { useLibraryStore } from "../store/libraryStore";
import { usePlayerStore } from "../store/playerStore";

export function RecentlyPlayed() {
  const authState = useAuthStore((s) => s.state);
  const history = useLibraryStore((s) => s.history);
  const playTrack = usePlayerStore((s) => s.playTrack);

  if (authState !== "signed_in") {
    return <SignInPrompt />;
  }

  const tracks = history.data ?? [];

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
      {/* Hero matches the Playlist and Liked Songs detail pages — same
          artwork tile, eyebrow, title scale, and count line. */}
      <div className="flex items-end gap-6">
        <div className="brand-mark flex h-44 w-44 shrink-0 items-center justify-center rounded-xl text-white shadow-lg shadow-black/50 sm:h-56 sm:w-56">
          <History size={72} />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Playlist</span>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Recently Played</h1>
          <p className="text-sm text-muted">{tracks.length} songs</p>
        </div>
      </div>

      {history.loading && <TrackListSkeleton rows={10} />}

      {history.error && <p className="text-sm text-red-400">{history.error}</p>}

      {tracks.length > 0 && (
        <PlayControls onPlay={handlePlay} onShuffle={handleShuffle} />
      )}

      <TrackList tracks={tracks} />
    </div>
  );
}
