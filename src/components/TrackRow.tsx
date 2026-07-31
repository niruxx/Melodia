import { Heart, Pause, Play } from "lucide-react";
import clsx from "clsx";
import { CoverArt } from "./CoverArt";
import { usePlayerStore } from "../store/playerStore";
import { formatDuration } from "../lib/format";
import type { Track } from "../lib/mockData";

type TrackRowProps = {
  track: Track;
  index: number;
  tracks: Track[];
  showAlbum?: boolean;
};

export function TrackRow({ track, index, tracks, showAlbum = true }: TrackRowProps) {
  const current = usePlayerStore((s) => s.currentTrack());
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const liked = usePlayerStore((s) => s.likedIds[track.id]);
  const toggleLike = usePlayerStore((s) => s.toggleLike);

  const isCurrent = current?.id === track.id;

  function handleRowClick() {
    if (isCurrent) {
      togglePlay();
    } else {
      playTrack(track, tracks);
    }
  }

  return (
    <div
      onClick={handleRowClick}
      className={clsx(
        "group grid cursor-pointer grid-cols-[2rem_1fr_auto] items-center gap-4 rounded-lg px-3 py-2 sm:grid-cols-[2rem_1fr_10rem_auto]",
        isCurrent ? "bg-surface-2" : "hover:bg-surface-2",
      )}
    >
      <div className="flex w-8 items-center justify-center text-sm text-muted">
        <span className="group-hover:hidden">
          {isCurrent && isPlaying ? (
            <span className="flex h-3 items-end gap-0.5 text-accent">
              <span className="h-full w-0.5 animate-pulse bg-accent" />
              <span className="h-2 w-0.5 animate-pulse bg-accent" />
              <span className="h-1.5 w-0.5 animate-pulse bg-accent" />
            </span>
          ) : (
            <span className={clsx(isCurrent && "text-accent")}>{index + 1}</span>
          )}
        </span>
        <span className="hidden group-hover:block">
          {isCurrent && isPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <CoverArt seed={`${track.album}-${track.title}`} src={track.thumbnail} className="h-10 w-10" />
        <div className="min-w-0">
          <div className={clsx("truncate text-sm font-medium", isCurrent ? "text-accent" : "text-fg")}>
            {track.title}
          </div>
          <div className="truncate text-xs text-muted">{track.artist}</div>
        </div>
      </div>

      {showAlbum && (
        <div className="hidden truncate text-sm text-muted sm:block">{track.album}</div>
      )}

      <div className="flex items-center gap-4">
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleLike(track.id);
          }}
          className={clsx(
            "opacity-0 transition-opacity group-hover:opacity-100",
            liked && "opacity-100 text-accent",
          )}
          aria-label="Like"
        >
          <Heart size={16} fill={liked ? "currentColor" : "none"} />
        </button>
        <span className="w-10 text-right text-sm text-muted">{formatDuration(track.duration)}</span>
      </div>
    </div>
  );
}
