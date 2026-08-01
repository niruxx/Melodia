import { motion } from "framer-motion";
import { Heart, Pause, Play } from "lucide-react";
import clsx from "clsx";
import { CoverArt } from "./CoverArt";
import { PlayingBars } from "./PlayingBars";
import { usePlayerStore } from "../store/playerStore";
import { useTrackContextMenu } from "../hooks/useTrackContextMenu";
import { formatDuration } from "../lib/format";
import type { Track } from "../lib/mockData";

type TrackRowProps = {
  track: Track;
  index: number;
  tracks: Track[];
  showAlbum?: boolean;
};

/** Shared by list pages so rows fade/rise in sequence rather than all at once. */
export const listVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.025, delayChildren: 0.02 } },
};

export const listItemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: "easeOut" as const } },
};

export function TrackRow({ track, index, tracks, showAlbum = true }: TrackRowProps) {
  const current = usePlayerStore((s) => s.currentTrack());
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const liked = usePlayerStore((s) => s.likedIds[track.id]);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const openTrackMenu = useTrackContextMenu();

  const isCurrent = current?.id === track.id;

  function handleRowClick() {
    if (isCurrent) {
      togglePlay();
    } else {
      playTrack(track, tracks);
    }
  }

  return (
    <motion.div
      variants={listItemVariants}
      onClick={handleRowClick}
      onContextMenu={(e) => openTrackMenu(e, track, tracks)}
      className={clsx(
        "group grid cursor-pointer grid-cols-[2rem_1fr_auto] items-center gap-4 rounded-lg px-3 py-2 transition-colors sm:grid-cols-[2rem_1fr_10rem_auto]",
        isCurrent ? "bg-surface-2" : "hover:bg-surface-2",
      )}
    >
      <div className="flex w-8 items-center justify-center text-sm text-muted">
        <span className="group-hover:hidden">
          {isCurrent ? (
            <PlayingBars className="text-accent" paused={!isPlaying} />
          ) : (
            <span className="tabular-nums">{index + 1}</span>
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

      {showAlbum && <div className="hidden truncate text-sm text-muted sm:block">{track.album}</div>}

      <div className="flex items-center gap-4">
        <motion.button
          whileTap={{ scale: 0.85 }}
          onClick={(e) => {
            e.stopPropagation();
            toggleLike(track.id);
          }}
          className={clsx(
            "opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100",
            liked && "text-accent opacity-100",
          )}
          aria-label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
        >
          <Heart size={16} fill={liked ? "currentColor" : "none"} />
        </motion.button>
        <span className="w-10 text-right text-sm tabular-nums text-muted">
          {formatDuration(track.duration)}
        </span>
      </div>
    </motion.div>
  );
}
