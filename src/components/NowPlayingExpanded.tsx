import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Loader2,
  SkipBack,
  SkipForward,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import clsx from "clsx";
import { CoverArt } from "./CoverArt";
import { LikeButton } from "./LikeButton";
import { ShuffleButton } from "./ShuffleButton";
import { Skeleton } from "./Skeleton";
import { Visualizer } from "./Visualizer";
import { VideoLayer } from "./VideoLayer";
import { useVideoStore } from "../store/videoStore";
import { usePlayerStore } from "../store/playerStore";
import { useAuthStore } from "../store/authStore";
import { useSourceStore } from "../store/sourceStore";
import { formatDuration } from "../lib/format";
import { getLocalLyrics, getLyrics, type LyricLine } from "../lib/ytmusic";

type LyricsState = {
  loading: boolean;
  lyrics: string | null;
  /** Timed lines. Empty whenever only unsynced text is available. */
  lines: LyricLine[];
  source: string | null;
  error: string | null;
};

const EMPTY_LYRICS: LyricsState = {
  loading: false,
  lyrics: null,
  lines: [],
  source: null,
  error: null,
};

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
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);

  const videoEnabled = useVideoStore((s) => s.enabled);
  const setVideoEnabled = useVideoStore((s) => s.setEnabled);
  const videoError = useVideoStore((s) => s.error);
  const loadVideo = useVideoStore((s) => s.load);
  const clearVideo = useVideoStore((s) => s.clear);
  const videoLoading = useVideoStore((s) => s.loadingFor !== null);
  // Local files and SoundCloud tracks have no YouTube video behind them.
  const canShowVideo = Boolean(
    track && !track.id.startsWith("local:") && !track.id.startsWith("sc:"),
  );

  // Resolve on demand rather than for every track: the lookup is a network
  // round trip, and most listening happens with video off.
  useEffect(() => {
    if (!videoEnabled || !canShowVideo || !track) {
      clearVideo();
      return;
    }
    void loadVideo(track.id);
  }, [videoEnabled, canShowVideo, track?.id, loadVideo, clearVideo]);

  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;

  // The richer tags a local file carries, as one line. Album artist is left
  // out unless it differs from the track artist, where it's the interesting
  // part (a compilation, a featured guest, a classical performer).
  const trackDetails = useMemo(() => {
    if (!track) return "";
    const parts: string[] = [];
    if (track.albumArtist && track.albumArtist !== track.artist) {
      parts.push(track.albumArtist);
    }
    if (track.year) parts.push(String(track.year));
    if (track.genres?.length) parts.push(track.genres.join(", "));
    if (track.composers?.length) parts.push(`Composed by ${track.composers.join(", ")}`);
    return parts.join(" · ");
  }, [track?.id, track?.albumArtist, track?.artist, track?.year, track?.genres, track?.composers]);

  const [lyricsState, setLyricsState] = useState<LyricsState>(EMPTY_LYRICS);

  const isLocalMode = useSourceStore((s) => s.active === "local");
  const isLocalTrack = Boolean(track?.id.startsWith("local:"));
  // A local file's lyrics come off the disk beside it, so they work with no
  // account and in Local mode — which is deliberately "don't talk to
  // YouTube". SoundCloud is the one source with nothing to read either way,
  // so its panel is dropped rather than shown empty.
  const canShowLyrics = Boolean(
    track && !track.id.startsWith("sc:") && (isLocalTrack || !isLocalMode),
  );
  // Only the YouTube path needs an account; saying so in front of a local
  // file's lyrics would be nonsense.
  const lyricsNeedSignIn = canShowLyrics && !isLocalTrack && !isSignedIn;

  useEffect(() => {
    if (!isExpanded || !track) return;
    if (!canShowLyrics || lyricsNeedSignIn) {
      // Nothing to fetch — and the previous track's lyrics must not linger
      // behind a local one, or they'd reappear on the way back out.
      setLyricsState(EMPTY_LYRICS);
      return;
    }

    let cancelled = false;
    setLyricsState({ ...EMPTY_LYRICS, loading: true });

    const request = isLocalTrack
      ? getLocalLyrics(track.id.slice("local:".length)).then((res) => ({
          lyrics: res.plain,
          lines: res.lines,
          source: null as string | null,
        }))
      : getLyrics(track.id);

    request
      .then((res) => {
        if (cancelled) return;
        setLyricsState({
          loading: false,
          lyrics: res.lyrics,
          lines: res.lines,
          source: res.source,
          error: null,
        });
      })
      .catch((e) => {
        if (!cancelled) setLyricsState({ ...EMPTY_LYRICS, error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [isExpanded, track?.id, isLocalTrack, lyricsNeedSignIn, canShowLyrics]);

  // Which timed line is current: the last one that has already started.
  // -1 until the first line is due, so nothing is highlighted over an intro.
  const activeLyricIndex = useMemo(() => {
    const { lines } = lyricsState;
    if (lines.length === 0) return -1;
    const positionMs = progress * 1000;
    let index = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startMs > positionMs) break;
      index = i;
    }
    return index;
  }, [lyricsState.lines, progress]);

  const activeLyricRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const node = activeLyricRef.current;
    if (!node) return;
    // Framer's MotionConfig can't reach a native scroll, so reduced motion is
    // honoured explicitly here.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  }, [activeLyricIndex]);

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
                {/* The video keeps the artwork's square footprint so switching
                    modes doesn't reflow the column. */}
                <div className="relative h-56 w-56 overflow-hidden rounded-xl sm:h-72 sm:w-72">
                  <CoverArt
                    seed={`${track.album}-${track.title}`}
                    src={track.thumbnail}
                    rounded="lg"
                    className="h-full w-full"
                  />
                  {videoEnabled && (
                    <div className="absolute inset-0 bg-black">
                      <VideoLayer />
                      {videoLoading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                          <Loader2 size={22} className="animate-spin text-accent" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>

              {canShowVideo && (
                <button
                  onClick={() => setVideoEnabled(!videoEnabled)}
                  className={clsx(
                    "mt-4 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                    videoEnabled
                      ? "bg-accent text-black"
                      : "bg-surface-2 text-fg hover:bg-surface-3",
                  )}
                  title="Play the music video in place of the artwork"
                >
                  {videoEnabled ? <Video size={14} /> : <VideoOff size={14} />}
                  {videoEnabled ? "Video on" : "Video off"}
                </button>
              )}

              {videoEnabled && videoError && (
                <p className="mt-2 max-w-xs text-center text-xs text-muted">
                  No video available for this track.
                </p>
              )}

              <div className="mt-8 flex w-full min-w-0 items-center justify-center gap-3">
                <div className="min-w-0 text-center">
                  <div className="line-clamp-2 break-words text-2xl font-semibold tracking-tight">
                    {track.title}
                  </div>
                  <div className="mt-1 truncate text-muted">{track.artist}</div>
                  {/* Only local files carry these; streaming sources return
                      nothing to show here. */}
                  {trackDetails && (
                    <div className="mt-1 truncate text-xs text-muted/70" title={trackDetails}>
                      {trackDetails}
                    </div>
                  )}
                </div>
                <LikeButton
                  liked={liked}
                  onToggle={() => toggleLike(track.id)}
                  size={20}
                  className={clsx("ml-2 text-muted hover:text-fg", liked && "text-accent")}
                />
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
                <ShuffleButton
                  active={shuffle}
                  onClick={toggleShuffle}
                  size={20}
                  className={clsx("text-muted hover:text-fg", shuffle && "text-accent")}
                />
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

              <div className="mt-5 flex w-full max-w-xs items-center gap-3">
                <button
                  onClick={toggleMute}
                  className="shrink-0 text-muted transition-colors hover:text-fg"
                  aria-label={volume === 0 ? "Unmute" : "Mute"}
                >
                  {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="tb-range h-3 flex-1"
                  style={{ "--fill-pct": `${volume * 100}%` } as React.CSSProperties}
                  aria-label="Volume"
                />
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted">
                  {Math.round(volume * 100)}
                </span>
              </div>
            </div>

            {canShowLyrics && (
              <div className="flex h-[60vh] w-full min-w-[16rem] max-w-sm shrink-0 flex-col rounded-xl bg-black/30 p-6 backdrop-blur md:h-[70vh]">
                <h3 className="mb-4 shrink-0 text-xs font-semibold uppercase tracking-wider text-muted">
                  Lyrics
                </h3>
                <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
                  {lyricsNeedSignIn && (
                    <p className="text-sm text-muted">Sign in to load lyrics.</p>
                  )}
                  {!lyricsNeedSignIn && lyricsState.loading && (
                    <div className="flex flex-col gap-3">
                      {[
                        "w-full",
                        "w-11/12",
                        "w-4/5",
                        "w-full",
                        "w-3/4",
                        "w-5/6",
                        "w-2/3",
                        "w-full",
                      ].map((w, i) => (
                        <Skeleton key={i} className={clsx("h-3.5", w)} />
                      ))}
                    </div>
                  )}
                  {!lyricsNeedSignIn && !lyricsState.loading && lyricsState.error && (
                    <p className="text-sm text-red-400">{lyricsState.error}</p>
                  )}
                  {!lyricsNeedSignIn &&
                    !lyricsState.loading &&
                    !lyricsState.error &&
                    !lyricsState.lyrics &&
                    lyricsState.lines.length === 0 && (
                      <p className="text-sm text-muted">
                        {isLocalTrack
                          ? "No lyrics found. Put an .lrc file next to the track to see them here."
                          : "Lyrics not available for this song."}
                      </p>
                    )}
                  {lyricsState.lines.length > 0 ? (
                    <div className="flex flex-col gap-1 py-[35%]">
                      {lyricsState.lines.map((line, i) => (
                        <button
                          key={`${line.startMs}-${i}`}
                          ref={i === activeLyricIndex ? activeLyricRef : undefined}
                          onClick={() => seek(line.startMs / 1000)}
                          className={clsx(
                            "rounded px-2 py-1 text-left text-sm leading-relaxed transition-colors duration-300",
                            i === activeLyricIndex
                              ? "font-semibold text-fg"
                              : "text-fg/40 hover:text-fg/70",
                          )}
                        >
                          {/* An instrumental gap is a real line with no words;
                              a dot keeps it clickable and visible. */}
                          {line.text || "·"}
                        </button>
                      ))}
                      {lyricsState.source && (
                        <p className="mt-4 px-2 text-xs text-muted">{lyricsState.source}</p>
                      )}
                    </div>
                  ) : (
                    lyricsState.lyrics && (
                      <>
                        <p className="whitespace-pre-line text-sm leading-relaxed text-fg/90">
                          {lyricsState.lyrics}
                        </p>
                        {lyricsState.source && (
                          <p className="mt-4 text-xs text-muted">{lyricsState.source}</p>
                        )}
                      </>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
