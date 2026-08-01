import { Reorder, motion } from "framer-motion";
import clsx from "clsx";
import { TrackRow, listVariants } from "./TrackRow";
import type { Track } from "../lib/types";

type TrackListProps = {
  tracks: Track[];
  showAlbum?: boolean;
  className?: string;
  /** Set by editable playlists; surfaces a remove entry in each row's menu. */
  onRemoveTrack?: (track: Track) => void;
  /** Enables drag-reordering. Fires continuously during the drag. */
  onReorder?: (tracks: Track[]) => void;
  /** Fires once on drop — the point at which a reorder should be persisted. */
  onReorderEnd?: () => void;
};

/** A staggered, context-menu-enabled list of tracks. */
export function TrackList({
  tracks,
  showAlbum = true,
  className,
  onRemoveTrack,
  onReorder,
  onReorderEnd,
}: TrackListProps) {
  const containerClassName = clsx("flex flex-col gap-1", className);

  if (onReorder) {
    return (
      <Reorder.Group
        as="div"
        axis="y"
        values={tracks}
        onReorder={onReorder}
        variants={listVariants}
        initial="hidden"
        animate="show"
        className={containerClassName}
      >
        {tracks.map((track, i) => (
          // Keyed by playlist entry rather than position, so a reorder animates
          // rows to their new slots instead of remounting the list.
          <TrackRow
            key={track.setVideoId ?? track.id}
            track={track}
            index={i}
            tracks={tracks}
            showAlbum={showAlbum}
            onRemove={onRemoveTrack}
            reorderable
            onDragEnd={onReorderEnd}
          />
        ))}
      </Reorder.Group>
    );
  }

  return (
    <motion.div
      variants={listVariants}
      initial="hidden"
      animate="show"
      // Re-runs the stagger when the underlying list changes identity
      // (e.g. a new search query) instead of leaving rows already-shown.
      key={tracks.length > 0 ? tracks[0].id : "empty"}
      className={containerClassName}
    >
      {tracks.map((track, i) => (
        <TrackRow
          key={`${track.id}-${i}`}
          track={track}
          index={i}
          tracks={tracks}
          showAlbum={showAlbum}
          onRemove={onRemoveTrack}
        />
      ))}
    </motion.div>
  );
}
