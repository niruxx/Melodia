import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import clsx from "clsx";
import { CoverArt } from "./CoverArt";
import { usePlayerStore } from "../store/playerStore";
import { formatDuration } from "../lib/format";
import type { Track } from "../lib/types";

export function QueueDrawer() {
  const isQueueOpen = usePlayerStore((s) => s.isQueueOpen);
  const setQueueOpen = usePlayerStore((s) => s.setQueueOpen);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const jumpTo = usePlayerStore((s) => s.jumpTo);

  const upcoming = queue.slice(queueIndex + 1);

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
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
                Queue
              </h3>
              <button
                onClick={() => setQueueOpen(false)}
                className="text-muted hover:text-fg"
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
                <QueueRow track={queue[queueIndex]} active />
              </div>
            )}

            <div className="no-scrollbar flex-1 overflow-y-auto">
              {upcoming.length > 0 ? (
                <>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                    Next up
                  </div>
                  <div className="flex flex-col gap-1">
                    {upcoming.map((track, i) => (
                      <div key={`${track.id}-${i}`} onClick={() => jumpTo(queueIndex + 1 + i)}>
                        <QueueRow track={track} />
                      </div>
                    ))}
                  </div>
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

function QueueRow({
  track,
  active,
}: {
  track: Track;
  active?: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2",
        active && "bg-surface-2",
      )}
    >
      <CoverArt seed={`${track.album}-${track.title}`} src={track.thumbnail} className="h-10 w-10" />
      <div className="min-w-0 flex-1">
        <div className={clsx("truncate text-sm font-medium", active && "text-accent")}>
          {track.title}
        </div>
        <div className="truncate text-xs text-muted">{track.artist}</div>
      </div>
      <span className="text-xs text-muted">{formatDuration(track.duration)}</span>
    </div>
  );
}
