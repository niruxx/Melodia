import { motion } from "framer-motion";
import {
  Cast,
  Heart,
  ListMusic,
  Maximize2,
  MessageSquare,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import clsx from "clsx";
import { CoverArt } from "./CoverArt";
import { Marquee } from "./Marquee";
import { SleepTimerChip } from "./SleepTimerChip";
import { usePlayerStore } from "../store/playerStore";
import { useNetworkStore } from "../store/networkStore";
import { useMiniPlayerStore } from "../store/miniPlayerStore";
import { useCommentsStore } from "../store/commentsStore";
import { formatDuration } from "../lib/format";

const tap = { scale: 0.9 };

export function NowPlayingBar() {
  const track = usePlayerStore((s) => s.currentTrack());
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const progress = usePlayerStore((s) => s.progress);
  const volume = usePlayerStore((s) => s.volume);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const liked = usePlayerStore((s) => (track ? s.likedIds[track.id] : false));

  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const setExpanded = usePlayerStore((s) => s.setExpanded);
  const setQueueOpen = usePlayerStore((s) => s.setQueueOpen);
  const isCommentsOpen = useCommentsStore((s) => s.isOpen);
  const setCommentsOpen = useCommentsStore((s) => s.setOpen);
  const isQueueOpen = usePlayerStore((s) => s.isQueueOpen);

  const networkRole = useNetworkStore((s) => s.role);
  const connectedPeerName = useNetworkStore((s) => s.connectedPeerName);
  const openDeviceModal = useNetworkStore((s) => s.openDeviceModal);
  const disconnectDevice = useNetworkStore((s) => s.disconnect);

  const playbackError = usePlayerStore((s) => s.playbackError);
  const toggleMini = useMiniPlayerStore((s) => s.toggle);

  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;

  const duration = track?.duration ?? 0;
  const progressPct = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <div className="flex shrink-0 flex-col bg-black">
      {playbackError && (
        <div className="flex items-center justify-center gap-2 bg-red-500/15 px-4 py-1.5 text-xs text-red-400">
          {playbackError}
        </div>
      )}
      {networkRole !== "idle" && (
        <div className="flex items-center justify-center gap-2 bg-accent/15 px-4 py-1.5 text-xs text-accent">
          <Cast size={13} />
          {networkRole === "controller"
            ? `Playing on ${connectedPeerName}`
            : `Being controlled by ${connectedPeerName}`}
          <button onClick={() => disconnectDevice()} className="ml-2 underline hover:no-underline">
            Disconnect
          </button>
        </div>
      )}
      <div className="flex h-[90px] items-center gap-4 px-4">
        <div className="flex w-[30%] min-w-[180px] items-center gap-3">
          {track ? (
            <>
              <button
                onClick={() => setExpanded(true)}
                className="flex min-w-0 items-center gap-3 text-left"
              >
                <CoverArt
                  seed={`${track.album}-${track.title}`}
                  src={track.thumbnail}
                  rounded="md"
                  className="h-14 w-14 shrink-0"
                />
                <div className="min-w-0">
                  <Marquee text={track.title} className="text-sm font-medium" />
                  <Marquee text={track.artist} className="mt-0.5 text-xs text-muted" />
                </div>
              </button>
              <motion.button
                whileTap={tap}
                onClick={() => toggleLike(track.id)}
                className={clsx(
                  "shrink-0 text-muted transition-colors hover:text-fg",
                  liked && "text-accent hover:text-accent",
                )}
                aria-label="Like"
              >
                <Heart size={16} fill={liked ? "currentColor" : "none"} />
              </motion.button>
            </>
          ) : (
            <div className="text-sm text-muted">Nothing playing</div>
          )}
        </div>

        <div className="flex w-[40%] flex-col items-center gap-2">
          <div className="flex items-center gap-5">
            <motion.button
              whileTap={tap}
              onClick={toggleShuffle}
              className={clsx("text-muted transition-colors hover:text-fg", shuffle && "text-accent")}
              aria-label="Shuffle"
            >
              <Shuffle size={16} />
            </motion.button>
            <motion.button
              whileTap={tap}
              onClick={prev}
              className="text-fg/90 transition-colors hover:text-fg"
              aria-label="Previous"
            >
              <SkipBack size={18} fill="currentColor" />
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.94 }}
              whileHover={{ scale: 1.06 }}
              onClick={togglePlay}
              disabled={!track}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-fg text-black shadow-lg shadow-black/30 disabled:opacity-40"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause size={16} fill="currentColor" />
              ) : (
                <Play size={16} fill="currentColor" className="ml-0.5" />
              )}
            </motion.button>
            <motion.button
              whileTap={tap}
              onClick={next}
              className="text-fg/90 transition-colors hover:text-fg"
              aria-label="Next"
            >
              <SkipForward size={18} fill="currentColor" />
            </motion.button>
            <motion.button
              whileTap={tap}
              onClick={cycleRepeat}
              className={clsx(
                "text-muted transition-colors hover:text-fg",
                repeat !== "off" && "text-accent",
              )}
              aria-label="Repeat"
            >
              <RepeatIcon size={16} />
            </motion.button>
          </div>
          <div className="flex w-full max-w-xl items-center gap-2 text-xs tabular-nums text-muted">
            <span className="w-9 text-right">{formatDuration(progress)}</span>
            <input
              type="range"
              min={0}
              max={duration || 1}
              value={progress}
              onChange={(e) => seek(Number(e.target.value))}
              disabled={!track}
              className="tb-range h-3 w-full"
              style={{ "--fill-pct": `${progressPct}%` } as React.CSSProperties}
              aria-label="Seek"
            />
            <span className="w-9">{formatDuration(duration)}</span>
          </div>
        </div>

        <div className="flex w-[30%] min-w-[180px] items-center justify-end gap-3">
          <SleepTimerChip />
          <motion.button
            whileTap={tap}
            onClick={() => setExpanded(true)}
            disabled={!track}
            className="text-muted transition-colors hover:text-fg disabled:opacity-40"
            aria-label="Now playing view"
          >
            <Maximize2 size={16} />
          </motion.button>
          <motion.button
            whileTap={tap}
            onClick={() => toggleMini()}
            className="text-muted transition-colors hover:text-fg"
            aria-label="Mini player"
            title="Mini player"
          >
            <PictureInPicture2 size={16} />
          </motion.button>
          <motion.button
            whileTap={tap}
            onClick={() => setQueueOpen(!isQueueOpen)}
            className={clsx("text-muted transition-colors hover:text-fg", isQueueOpen && "text-accent")}
            aria-label="Queue"
          >
            <ListMusic size={18} />
          </motion.button>
          <motion.button
            whileTap={tap}
            onClick={() => setCommentsOpen(!isCommentsOpen)}
            className={clsx(
              "text-muted transition-colors hover:text-fg",
              isCommentsOpen && "text-accent",
            )}
            aria-label="Comments"
            title="YouTube comments"
          >
            <MessageSquare size={18} />
          </motion.button>
          <motion.button
            whileTap={tap}
            onClick={openDeviceModal}
            className={clsx(
              "text-muted transition-colors hover:text-fg",
              networkRole !== "idle" && "text-accent",
            )}
            aria-label="Connect to a device"
            title="Connect to a device"
          >
            <Cast size={18} />
          </motion.button>
          <motion.button
            whileTap={tap}
            onClick={toggleMute}
            className="shrink-0 text-muted transition-colors hover:text-fg"
            aria-label={volume === 0 ? "Unmute" : "Mute"}
          >
            <VolumeIcon size={18} />
          </motion.button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="tb-range h-3 w-24"
            style={{ "--fill-pct": `${volume * 100}%` } as React.CSSProperties}
            aria-label="Volume"
          />
        </div>
      </div>
    </div>
  );
}
