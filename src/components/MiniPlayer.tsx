import { motion } from "framer-motion";
import { Minimize2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { CoverArt } from "./CoverArt";
import { Marquee } from "./Marquee";
import { usePlayerStore } from "../store/playerStore";
import { useMiniPlayerStore } from "../store/miniPlayerStore";
import { formatDuration } from "../lib/format";

/** Compact always-on-top layout shown instead of the full app in mini mode. */
export function MiniPlayer() {
  const track = usePlayerStore((s) => s.currentTrack());
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const progress = usePlayerStore((s) => s.progress);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const seek = usePlayerStore((s) => s.seek);
  const exitMini = useMiniPlayerStore((s) => s.toggle);

  const duration = track?.duration ?? 0;
  const pct = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-black text-fg">
      {/* Whole strip is a drag region so the tiny window stays movable
          without a titlebar; buttons opt out via their own handlers. */}
      <div data-tauri-drag-region className="flex flex-1 items-center gap-3 px-3">
        {track ? (
          <>
            <CoverArt
              seed={`${track.album}-${track.title}`}
              src={track.thumbnail}
              className="h-14 w-14 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <Marquee text={track.title} className="text-sm font-semibold" />
              <Marquee text={track.artist} className="mt-0.5 text-xs text-muted" />
            </div>
          </>
        ) : (
          <div className="flex-1 text-sm text-muted">Nothing playing</div>
        )}

        <div className="flex shrink-0 items-center gap-1">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={prev}
            className="p-1.5 text-fg/90 hover:text-fg"
            aria-label="Previous"
          >
            <SkipBack size={16} fill="currentColor" />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.94 }}
            onClick={togglePlay}
            disabled={!track}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-fg text-black disabled:opacity-40"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause size={15} fill="currentColor" />
            ) : (
              <Play size={15} fill="currentColor" className="ml-0.5" />
            )}
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={next}
            className="p-1.5 text-fg/90 hover:text-fg"
            aria-label="Next"
          >
            <SkipForward size={16} fill="currentColor" />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => exitMini()}
            className="ml-1 p-1.5 text-muted hover:text-fg"
            aria-label="Exit mini player"
            title="Exit mini player"
          >
            <Minimize2 size={15} />
          </motion.button>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 pb-2 text-[10px] tabular-nums text-muted">
        <span className="w-8 text-right">{formatDuration(progress)}</span>
        <input
          type="range"
          min={0}
          max={duration || 1}
          value={progress}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={!track}
          className="tb-range h-3 w-full"
          style={{ "--fill-pct": `${pct}%` } as React.CSSProperties}
          aria-label="Seek"
        />
        <span className="w-8">{formatDuration(duration)}</span>
      </div>
    </div>
  );
}
