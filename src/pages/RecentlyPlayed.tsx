import { History, Loader2, Play, Shuffle } from "lucide-react";
import { TrackRow } from "../components/TrackRow";
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
      <div className="flex items-center gap-3">
        <div className="brand-mark flex h-14 w-14 items-center justify-center rounded-xl text-white">
          <History size={26} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Recently Played</h1>
          <p className="text-sm text-muted">{tracks.length} songs</p>
        </div>
      </div>

      {history.loading && (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-accent" />
        </div>
      )}

      {history.error && <p className="text-sm text-red-400">{history.error}</p>}

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
        {tracks.map((track, i) => (
          <TrackRow key={`${track.id}-${i}`} track={track} index={i} tracks={tracks} />
        ))}
      </div>
    </div>
  );
}
