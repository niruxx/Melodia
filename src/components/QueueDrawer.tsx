import { AnimatePresence, Reorder, motion, useDragControls } from "framer-motion";
import { GripVertical, X } from "lucide-react";
import clsx from "clsx";
import { CoverArt } from "./CoverArt";
import { PlayingBars } from "./PlayingBars";
import { usePlayerStore } from "../store/playerStore";
import { formatDuration } from "../lib/format";
import type { Track } from "../lib/types";

export function QueueDrawer() {
  const isQueueOpen = usePlayerStore((s) => s.isQueueOpen);
  const setQueueOpen = usePlayerStore((s) => s.setQueueOpen);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const jumpTo = usePlayerStore((s) => s.jumpTo);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);

  const upcoming = queue.slice(queueIndex + 1);

  /** Reorder only ever rearranges the upcoming slice; already-played tracks
   *  and the current one keep their positions. */
  function handleReorder(next: Track[]) {
    const head = queue.slice(0, queueIndex + 1).map((t) => t.id);
    reorderQueue([...head, ...next.map((t) => t.id)]);
  }

  return (
    <AnimatePresence>
      {isQueueOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setQueueOpen(false)}
            className="fixed inset-0 z-40 bg-black/30"
          />
          <motion.aside
            initial={{ x: 320, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 320, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed right-0 top-0 z-50 flex h-full w-80 flex-col border-l border-border bg-surface px-4 py-4"
          >
            <div className="flex items-center justify-between pb-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Queue</h3>
              <button
                onClick={() => setQueueOpen(false)}
                className="text-muted transition-colors hover:text-fg"
                aria-label="Close queue"
              >
                <X size={18} />
              </button>
            </div>

            {queue[queueIndex] && (
              <div className="mb-2">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                  Now playing
                </div>
                <QueueRow track={queue[queueIndex]} active isPlaying={isPlaying} />
              </div>
            )}

            <div className="no-scrollbar flex-1 overflow-y-auto">
              {upcoming.length > 0 ? (
                <>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                    Next up
                    <span className="ml-2 font-normal normal-case tracking-normal opacity-70">
                      drag to reorder
                    </span>
                  </div>
                  <Reorder.Group
                    axis="y"
                    values={upcoming}
                    onReorder={handleReorder}
                    className="flex flex-col gap-1"
                  >
                    {upcoming.map((track, i) => (
                      <DraggableQueueRow
                        key={track.id}
                        track={track}
                        onSelect={() => jumpTo(queueIndex + 1 + i)}
                      />
                    ))}
                  </Reorder.Group>
                </>
              ) : (
                <div className="pt-6 text-center text-sm text-muted">Queue is empty</div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function DraggableQueueRow({ track, onSelect }: { track: Track; onSelect: () => void }) {
  // Drag is bound to the grip handle only, so clicking the row still plays it.
  const controls = useDragControls();

  return (
    <Reorder.Item
      value={track}
      dragListener={false}
      dragControls={controls}
      className="list-none"
      whileDrag={{ scale: 1.02, zIndex: 1 }}
    >
      <div
        onClick={onSelect}
        className="group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2"
      >
        <button
          onPointerDown={(e) => {
            e.stopPropagation();
            controls.start(e);
          }}
          onClick={(e) => e.stopPropagation()}
          className="cursor-grab text-muted opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-100"
          aria-label={`Reorder ${track.title}`}
        >
          <GripVertical size={14} />
        </button>
        <CoverArt
          seed={`${track.album}-${track.title}`}
          src={track.thumbnail}
          className="h-10 w-10"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{track.title}</div>
          <div className="truncate text-xs text-muted">{track.artist}</div>
        </div>
        <span className="text-xs tabular-nums text-muted">{formatDuration(track.duration)}</span>
      </div>
    </Reorder.Item>
  );
}

function QueueRow({
  track,
  active,
  isPlaying,
}: {
  track: Track;
  active?: boolean;
  isPlaying?: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex items-center gap-3 rounded-lg px-2 py-2",
        active ? "bg-surface-2" : "hover:bg-surface-2",
      )}
    >
      <CoverArt seed={`${track.album}-${track.title}`} src={track.thumbnail} className="h-10 w-10" />
      <div className="min-w-0 flex-1">
        <div className={clsx("truncate text-sm font-medium", active && "text-accent")}>
          {track.title}
        </div>
        <div className="truncate text-xs text-muted">{track.artist}</div>
      </div>
      {active ? (
        <PlayingBars className="text-accent" paused={!isPlaying} />
      ) : (
        <span className="text-xs tabular-nums text-muted">{formatDuration(track.duration)}</span>
      )}
    </div>
  );
}
