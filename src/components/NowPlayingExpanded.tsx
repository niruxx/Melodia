import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  Heart,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from "lucide-react";
import clsx from "clsx";
import { CoverArt } from "./CoverArt";
import { Skeleton } from "./Skeleton";
import { Visualizer } from "./Visualizer";
import { usePlayerStore } from "../store/playerStore";
import { useAuthStore } from "../store/authStore";
import { formatDuration } from "../lib/format";
import { getLyrics } from "../lib/ytmusic";

type LyricsState = { loading: boolean; lyrics: string | null; source: string | null; error: string | null };

export function NowPlayingExpanded() {
  const isExpanded = usePlayerStore((s) => s.isExpanded);
  const setExpanded = usePlayerStore((s) => s.setExpanded);
  const track = usePlayerStore((s) => s.currentTrack());
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const progress = usePlayerStore((s) => s.progress);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const liked = usePlayerStore((s) => (track ? s.likedIds[track.id] : false));
  const isSignedIn = useAuthStore((s) => s.state === "signed_in");

  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const seek = usePlayerStore((s) => s.seek);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const toggleLike = usePlayerStore((s) => s.toggleLike);

  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;

  const [lyricsState, setLyricsState] = useState<LyricsState>({
    loading: false,
    lyrics: null,
    source: null,
    error: null,
  });

  useEffect(() => {
    if (!isExpanded || !track || !isSignedIn) return;
    let cancelled = false;
    setLyricsState({ loading: true, lyrics: null, source: null, error: null });
    getLyrics(track.id)
      .then((res) => {
        if (!cancelled) setLyricsState({ loading: false, lyrics: res.lyrics, source: res.source, error: null });
      })
      .catch((e) => {
        if (!cancelled) setLyricsState({ loading: false, lyrics: null, source: null, error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [isExpanded, track?.id, isSignedIn]);

  return (
    <AnimatePresence>
      {isExpanded && track && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
        >
          {/* Ambient backdrop built from the artwork's real colours, slowly
              drifting so the fullscreen view never feels static. */}
          <div
            className="ambient-drift absolute inset-0 -z-10 opacity-70 blur-3xl"
            style={{
              backgroundImage: `radial-gradient(circle at 30% 30%, var(--accent-dynamic-1), transparent 60%), radial-gradient(circle at 70% 70%, var(--accent-dynamic-2), transparent 60%)`,
            }}
          />
          <div className="absolute inset-0 -z-10 bg-base/90 backdrop-blur-2xl" />

          <button
            onClick={() => setExpanded(false)}
            className="absolute left-6 top-6 flex h-9 w-9 items-center justify-center rounded-full bg-surface-2/80 text-fg hover:bg-surface-3"
            aria-label="Minimize"
          >
            <ChevronDown size={20} />
          </button>

          <div className="flex max-h-full w-full max-w-5xl flex-col items-center gap-12 overflow-y-auto overflow-x-hidden px-8 py-6 md:flex-row md:items-center md:justify-center">
            {/* `min-w-0` + a capped width stop a long track title from stretching
                this column, which otherwise squeezes the lyrics panel and forces
                the whole overlay to scroll sideways. */}
            <div className="flex w-full min-w-0 max-w-md shrink-0 flex-col items-center">
              {/* A shared-element morph from the now-playing bar was tried here
                  and removed: the bar stays mounted behind this overlay, so two
                  live elements claimed the same layoutId and Framer Motion's
                  absolute positioning broke the centred layout. A plain
                  entrance animation is well-behaved and reads just as well. */}
              <motion.div
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.3, ease: "easeOut", delay: 0.05 }}
              >
                <CoverArt
                  seed={`${track.album}-${track.title}`}
                  src={track.thumbnail}
                  rounded="lg"
                  className="h-56 w-56 sm:h-72 sm:w-72"
                />
              </motion.div>

              <div className="mt-8 flex w-full min-w-0 items-center justify-center gap-3">
                <div className="min-w-0 text-center">
                  <div className="line-clamp-2 break-words text-2xl font-semibold tracking-tight">
                    {track.title}
                  </div>
                  <div className="mt-1 truncate text-muted">{track.artist}</div>
                </div>
                <button
                  onClick={() => toggleLike(track.id)}
                  className={clsx("ml-2 text-muted hover:text-fg", liked && "text-accent")}
                  aria-label="Like"
                >
                  <Heart size={20} fill={liked ? "currentColor" : "none"} />
                </button>
              </div>

              <div className="mt-8 flex w-full max-w-md flex-col items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={track.duration || 1}
                  value={progress}
                  onChange={(e) => seek(Number(e.target.value))}
                  className="tb-range h-3 w-full"
                  style={
                    {
                      "--fill-pct": `${track.duration > 0 ? (progress / track.duration) * 100 : 0}%`,
                    } as React.CSSProperties
                  }
                  aria-label="Seek"
                />
                <div className="flex w-full justify-between text-xs tabular-nums text-muted">
                  <span>{formatDuration(progress)}</span>
                  <span>{formatDuration(track.duration)}</span>
                </div>
              </div>

              <Visualizer className="mt-6 h-16 w-full max-w-md" />

              <div className="mt-4 flex items-center gap-6">
                <button
                  onClick={toggleShuffle}
                  className={clsx("text-muted hover:text-fg", shuffle && "text-accent")}
                  aria-label="Shuffle"
                >
                  <Shuffle size={20} />
                </button>
                <button onClick={prev} className="text-fg hover:text-fg" aria-label="Previous">
                  <SkipBack size={26} fill="currentColor" />
                </button>
                <button
                  onClick={togglePlay}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-fg text-black shadow-lg shadow-black/40 transition-transform hover:scale-105"
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? (
                    <Pause size={24} fill="currentColor" />
                  ) : (
                    <Play size={24} fill="currentColor" className="ml-1" />
                  )}
                </button>
                <button onClick={next} className="text-fg hover:text-fg" aria-label="Next">
                  <SkipForward size={26} fill="currentColor" />
                </button>
                <button
                  onClick={cycleRepeat}
                  className={clsx("text-muted hover:text-fg", repeat !== "off" && "text-accent")}
                  aria-label="Repeat"
                >
                  <RepeatIcon size={20} />
                </button>
              </div>
            </div>

            <div className="flex h-[60vh] w-full min-w-[16rem] max-w-sm shrink-0 flex-col rounded-xl bg-black/30 p-6 backdrop-blur md:h-[70vh]">
              <h3 className="mb-4 shrink-0 text-xs font-semibold uppercase tracking-wider text-muted">
                Lyrics
              </h3>
              <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
                {!isSignedIn && (
                  <p className="text-sm text-muted">Sign in to load lyrics.</p>
                )}
                {isSignedIn && lyricsState.loading && (
                  <div className="flex flex-col gap-3">
                    {["w-full", "w-11/12", "w-4/5", "w-full", "w-3/4", "w-5/6", "w-2/3", "w-full"].map(
                      (w, i) => (
                        <Skeleton key={i} className={clsx("h-3.5", w)} />
                      ),
                    )}
                  </div>
                )}
                {isSignedIn && !lyricsState.loading && lyricsState.error && (
                  <p className="text-sm text-red-400">{lyricsState.error}</p>
                )}
                {isSignedIn && !lyricsState.loading && !lyricsState.error && !lyricsState.lyrics && (
                  <p className="text-sm text-muted">Lyrics not available for this song.</p>
                )}
                {lyricsState.lyrics && (
                  <>
                    <p className="whitespace-pre-line text-sm leading-relaxed text-fg/90">
                      {lyricsState.lyrics}
                    </p>
                    {lyricsState.source && (
                      <p className="mt-4 text-xs text-muted">{lyricsState.source}</p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
