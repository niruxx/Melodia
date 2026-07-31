import {
  Cast,
  Heart,
  ListMusic,
  Maximize2,
  Pause,
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
import { usePlayerStore } from "../store/playerStore";
import { useNetworkStore } from "../store/networkStore";
import { formatDuration } from "../lib/format";

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
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const setExpanded = usePlayerStore((s) => s.setExpanded);
  const setQueueOpen = usePlayerStore((s) => s.setQueueOpen);
  const isQueueOpen = usePlayerStore((s) => s.isQueueOpen);

  const networkRole = useNetworkStore((s) => s.role);
  const connectedPeerName = useNetworkStore((s) => s.connectedPeerName);
  const openDeviceModal = useNetworkStore((s) => s.openDeviceModal);
  const disconnectDevice = useNetworkStore((s) => s.disconnect);

  const playbackError = usePlayerStore((s) => s.playbackError);

  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;

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
                <div className="truncate text-sm font-medium">{track.title}</div>
                <div className="truncate text-xs text-muted">{track.artist}</div>
              </div>
            </button>
            <button
              onClick={() => toggleLike(track.id)}
              className={clsx("shrink-0 text-muted hover:text-fg", liked && "text-accent")}
              aria-label="Like"
            >
              <Heart size={16} fill={liked ? "currentColor" : "none"} />
            </button>
          </>
        ) : (
          <div className="text-sm text-muted">Nothing playing</div>
        )}
      </div>

      <div className="flex w-[40%] flex-col items-center gap-2">
        <div className="flex items-center gap-5">
          <button
            onClick={toggleShuffle}
            className={clsx("text-muted hover:text-fg", shuffle && "text-accent")}
            aria-label="Shuffle"
          >
            <Shuffle size={16} />
          </button>
          <button onClick={prev} className="text-fg/90 hover:text-fg" aria-label="Previous">
            <SkipBack size={18} fill="currentColor" />
          </button>
          <button
            onClick={togglePlay}
            disabled={!track}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-fg text-black transition-transform hover:scale-105 disabled:opacity-40"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
          </button>
          <button onClick={next} className="text-fg/90 hover:text-fg" aria-label="Next">
            <SkipForward size={18} fill="currentColor" />
          </button>
          <button
            onClick={cycleRepeat}
            className={clsx("text-muted hover:text-fg", repeat !== "off" && "text-accent")}
            aria-label="Repeat"
          >
            <RepeatIcon size={16} />
          </button>
        </div>
        <div className="flex w-full max-w-xl items-center gap-2 text-xs text-muted">
          <span className="w-9 text-right">{formatDuration(progress)}</span>
          <input
            type="range"
            min={0}
            max={track?.duration ?? 0}
            value={progress}
            onChange={(e) => seek(Number(e.target.value))}
            disabled={!track}
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-accent disabled:cursor-default"
          />
          <span className="w-9">{formatDuration(track?.duration ?? 0)}</span>
        </div>
      </div>

      <div className="flex w-[30%] min-w-[180px] items-center justify-end gap-3">
        <button
          onClick={() => setExpanded(true)}
          disabled={!track}
          className="text-muted hover:text-fg disabled:opacity-40"
          aria-label="Now playing view"
        >
          <Maximize2 size={16} />
        </button>
        <button
          onClick={() => setQueueOpen(!isQueueOpen)}
          className={clsx("text-muted hover:text-fg", isQueueOpen && "text-accent")}
          aria-label="Queue"
        >
          <ListMusic size={18} />
        </button>
        <button
          onClick={openDeviceModal}
          className={clsx("text-muted hover:text-fg", networkRole !== "idle" && "text-accent")}
          aria-label="Connect to a device"
          title="Connect to a device"
        >
          <Cast size={18} />
        </button>
        <VolumeIcon size={18} className="shrink-0 text-muted" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-surface-3 accent-accent"
        />
      </div>
      </div>
    </div>
  );
}
