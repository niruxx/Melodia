import { motion } from "framer-motion";
import clsx from "clsx";
import { TrackRow, listVariants } from "./TrackRow";
import type { Track } from "../lib/types";

type TrackListProps = {
  tracks: Track[];
  showAlbum?: boolean;
  className?: string;
};

/** A staggered, context-menu-enabled list of tracks. */
export function TrackList({ tracks, showAlbum = true, className }: TrackListProps) {
  return (
    <motion.div
      variants={listVariants}
      initial="hidden"
      animate="show"
      // Re-runs the stagger when the underlying list changes identity
      // (e.g. a new search query) instead of leaving rows already-shown.
      key={tracks.length > 0 ? tracks[0].id : "empty"}
      className={clsx("flex flex-col gap-1", className)}
    >
      {tracks.map((track, i) => (
        <TrackRow
          key={`${track.id}-${i}`}
          track={track}
          index={i}
          tracks={tracks}
          showAlbum={showAlbum}
        />
      ))}
    </motion.div>
  );
}
