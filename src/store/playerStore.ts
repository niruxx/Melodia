import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Track } from "../lib/mockData";
import type { RemoteCommand, RemoteState } from "../lib/types";
import { useAudioSettingsStore, type StreamFormat } from "./audioSettingsStore";
import { useStreamAuthStore } from "./streamAuthStore";

export type RepeatMode = "off" | "all" | "one";

type PlayerState = {
  queue: Track[];
  queueIndex: number;
  isPlaying: boolean;
  progress: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  isExpanded: boolean;
  isQueueOpen: boolean;
  likedIds: Record<string, boolean>;
  playbackError: string | null;
  /** What the engine actually served for the current track; null for local
   * files, which play at their own native quality. */
  streamFormat: StreamFormat | null;
  /** Volume to restore when unmuting; null when not muted. */
  premuteVolume: number | null;

  /** Set while this device is controlling another device's playback over the
   * network. When present, playback actions are sent over the wire instead
   * of mutating local state — see `src/store/networkStore.ts`. */
  remoteSend: ((cmd: RemoteCommand) => void) | null;

  currentTrack: () => Track | undefined;
  playTrack: (track: Track, context?: Track[]) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  jumpTo: (index: number) => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (ids: string[]) => void;
  toggleLike: (id: string) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setExpanded: (value: boolean) => void;
  setQueueOpen: (value: boolean) => void;
  setRemoteSender: (fn: ((cmd: RemoteCommand) => void) | null) => void;
  applyRemoteState: (state: RemoteState) => void;
  /** Repoints tracks whose ids changed — local files moved on disk. */
  remapTrackIds: (mapping: Record<string, string>) => void;
};

const LOCAL_ID_PREFIX = "local:";
const SC_ID_PREFIX = "sc:";

/** How long before a track ends its successor is fetched and queued. Long
 * enough to cover a slow stream resolve; short enough that a queue edited
 * mid-song rarely has to throw a preload away. */
const PRELOAD_LEAD_SECONDS = 30;

/** The track the engine has been asked to queue next, and where it sits. */
type Preload = { index: number; id: string; format: StreamFormat | null };
let preloaded: Preload | null = null;

type QueueShape = Pick<PlayerState, "queue" | "queueIndex" | "shuffle" | "repeat">;

/** What `next()` would play, or null at the end of a non-repeating queue.
 * Shuffle's pick is random, so it's made once here and remembered in the
 * preload rather than rolled again when the track actually changes. */
function pickNextIndex({ queue, queueIndex, shuffle, repeat }: QueueShape): number | null {
  if (queue.length === 0) return null;
  if (repeat === "one") return queueIndex;
  if (shuffle) return Math.floor(Math.random() * queue.length);
  if (queueIndex + 1 < queue.length) return queueIndex + 1;
  return repeat === "all" ? 0 : null;
}

/** Whether a preload still matches what should play next after an edit. */
function preloadStillValid(p: Preload, s: QueueShape): boolean {
  if (s.queue[p.index]?.id !== p.id) return false;
  if (s.repeat === "one") return p.index === s.queueIndex;
  // Any other track is as good a shuffle pick as the one that was rolled.
  if (s.shuffle) return p.index !== s.queueIndex;
  return pickNextIndex(s) === p.index;
}

/** Drops the preload locally and in the engine. */
function cancelPreload() {
  if (!preloaded) return;
  preloaded = null;
  invoke("playback_cancel_preload").catch(() => {});
}

function requestPreload() {
  const state = usePlayerStore.getState();
  if (preloaded || state.remoteSend || !state.isPlaying) return;
  if (!useAudioSettingsStore.getState().gapless) return;
  const index = pickNextIndex(state);
  if (index === null) return;
  const track = state.queue[index];
  const entry: Preload = { index, id: track.id, format: null };
  // Claimed before the request so position ticks don't fire duplicates.
  preloaded = entry;
  invoke<StreamFormat | null>("playback_preload", {
    trackId: track.id,
    quality: useAudioSettingsStore.getState().streamQuality,
  })
    .then((format) => {
      if (preloaded === entry) entry.format = format;
    })
    // Left claimed on failure: retrying every tick would hammer the helper,
    // and the normal end-of-track path plays (and reports) it anyway.
    .catch(() => {});
}

/** Starts real audio playback for a track on this device (a no-op on the
 * device that's currently controlling another one — see each action's guard
 * above this being called only from local branches). Routes to the local
 * file-based engine for tracks from the Local source, SoundCloud stream
 * resolution for `sc:`-prefixed tracks, YouTube stream resolution otherwise. */
function playReal(track: Track, onError: (message: string) => void) {
  if (track.id.startsWith(LOCAL_ID_PREFIX)) {
    const path = track.id.slice(LOCAL_ID_PREFIX.length);
    // Local files are decoded straight from disk, so whatever the container
    // holds is what's heard — FLAC/ALAC/WAV stay bit-for-bit intact.
    usePlayerStore.setState({ streamFormat: null });
    invoke("playback_play_local", { path }).catch((e) => onError(String(e)));
  } else if (track.id.startsWith(SC_ID_PREFIX)) {
    const trackId = track.id.slice(SC_ID_PREFIX.length);
    // SoundCloud has no quality tiers to report the way YouTube's format
    // selection does — there's exactly one progressive stream to resolve to.
    usePlayerStore.setState({ streamFormat: null });
    invoke("playback_play_soundcloud", { trackId }).catch((e) => onError(String(e)));
  } else {
    const { streamQuality } = useAudioSettingsStore.getState();
    invoke<StreamFormat>("playback_play", { videoId: track.id, quality: streamQuality })
      .then((format) => usePlayerStore.setState({ streamFormat: format }))
      .catch((e) => {
        const message = String(e);
        // YouTube pushing back on the borrowed session is worth surfacing as
        // its own thing: the fix is a setting, not a retry.
        useStreamAuthStore.getState().reportFailure(message);
        onError(message);
      });
  }
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  queueIndex: -1,
  isPlaying: false,
  progress: 0,
  volume: 0.8,
  shuffle: false,
  repeat: "off",
  isExpanded: false,
  isQueueOpen: false,
  likedIds: {},
  playbackError: null,
  streamFormat: null,
  premuteVolume: null,
  remoteSend: null,

  currentTrack: () => {
    const { queue, queueIndex } = get();
    return queue[queueIndex];
  },

  playTrack: (track, context) => {
    const remoteSend = get().remoteSend;
    if (remoteSend) {
      if (track.id.startsWith(LOCAL_ID_PREFIX)) {
        set({ playbackError: "Can't cast a local file to another device." });
        return;
      }
      remoteSend({ cmd: "play_track", track, queue: context && context.length > 0 ? context : [track] });
      return;
    }
    const queue = context && context.length > 0 ? context : [track];
    const queueIndex = queue.findIndex((t) => t.id === track.id);
    set({
      queue,
      queueIndex: queueIndex >= 0 ? queueIndex : 0,
      isPlaying: true,
      progress: 0,
      playbackError: null,
    });
    playReal(track, (message) => set({ playbackError: message, isPlaying: false }));
  },

  togglePlay: () => {
    const remoteSend = get().remoteSend;
    if (remoteSend) {
      remoteSend({ cmd: "toggle_play" });
      return;
    }
    if (get().queue.length === 0) return;
    const nowPlaying = !get().isPlaying;
    set({ isPlaying: nowPlaying });
    invoke(nowPlaying ? "playback_resume" : "playback_pause").catch((e) =>
      set({ playbackError: String(e) }),
    );
  },

  next: () => {
    const remoteSend = get().remoteSend;
    if (remoteSend) {
      remoteSend({ cmd: "next" });
      return;
    }
    const { queue, queueIndex, shuffle, repeat } = get();
    if (queue.length === 0) return;
    if (repeat === "one") {
      set({ progress: 0, isPlaying: true });
      invoke("playback_seek", { seconds: 0 }).catch((e) => set({ playbackError: String(e) }));
      return;
    }
    // Honour an already-made shuffle pick, so skipping lands on the track the
    // engine had lined up rather than rolling a different one.
    const planned = preloaded && preloadStillValid(preloaded, get()) ? preloaded.index : null;
    preloaded = null;
    let nextIndex =
      planned ?? (shuffle ? Math.floor(Math.random() * queue.length) : queueIndex + 1);
    if (nextIndex >= queue.length) {
      if (repeat === "all") {
        nextIndex = 0;
      } else {
        set({ isPlaying: false, progress: 0 });
        invoke("playback_stop").catch(() => {});
        return;
      }
    }
    set({ queueIndex: nextIndex, progress: 0, isPlaying: true, playbackError: null });
    playReal(queue[nextIndex], (message) => set({ playbackError: message, isPlaying: false }));
  },

  prev: () => {
    const remoteSend = get().remoteSend;
    if (remoteSend) {
      remoteSend({ cmd: "prev" });
      return;
    }
    const { queue, queueIndex, progress } = get();
    if (queue.length === 0) return;
    if (progress > 3) {
      set({ progress: 0 });
      invoke("playback_seek", { seconds: 0 }).catch((e) => set({ playbackError: String(e) }));
      return;
    }
    const prevIndex = Math.max(0, queueIndex - 1);
    set({ queueIndex: prevIndex, progress: 0, isPlaying: true, playbackError: null });
    playReal(queue[prevIndex], (message) => set({ playbackError: message, isPlaying: false }));
  },

  jumpTo: (index) => {
    const remoteSend = get().remoteSend;
    if (remoteSend) {
      remoteSend({ cmd: "jump_to", index });
      return;
    }
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    set({ queueIndex: index, progress: 0, isPlaying: true, playbackError: null });
    playReal(queue[index], (message) => set({ playbackError: message, isPlaying: false }));
  },

  seek: (seconds) => {
    const remoteSend = get().remoteSend;
    if (remoteSend) {
      remoteSend({ cmd: "seek", seconds });
      return;
    }
    set({ progress: seconds });
    invoke("playback_seek", { seconds }).catch((e) => set({ playbackError: String(e) }));
  },

  setVolume: (volume) => {
    const remoteSend = get().remoteSend;
    if (remoteSend) {
      remoteSend({ cmd: "set_volume", volume });
      return;
    }
    const clamped = Math.min(1, Math.max(0, volume));
    // Dragging the slider by hand supersedes a mute, so drop the stored
    // pre-mute level rather than letting a later unmute clobber the choice.
    set({ volume: clamped, premuteVolume: null });
    invoke("playback_set_volume", { volume: clamped }).catch(() => {});
  },

  toggleMute: () => {
    const { premuteVolume, volume, setVolume } = get();
    if (premuteVolume !== null) {
      setVolume(premuteVolume);
      return;
    }
    // Restore to something audible if muted from an already-silent slider.
    const restore = volume > 0 ? volume : 0.8;
    setVolume(0);
    set({ premuteVolume: restore });
  },

  playNext: (track) => {
    const { queue, queueIndex } = get();
    if (queue.length === 0) {
      get().playTrack(track);
      return;
    }
    const next = [...queue];
    next.splice(queueIndex + 1, 0, track);
    set({ queue: next });
  },

  addToQueue: (track) => {
    const { queue } = get();
    if (queue.length === 0) {
      get().playTrack(track);
      return;
    }
    set({ queue: [...queue, track] });
  },

  removeFromQueue: (index) => {
    const { queue, queueIndex } = get();
    if (index < 0 || index >= queue.length) return;
    // Removing the track that's playing is ambiguous; leave it alone rather
    // than silently jumping playback somewhere the user didn't ask for.
    if (index === queueIndex) return;
    const next = queue.filter((_, i) => i !== index);
    set({
      queue: next,
      // Keep pointing at the same track: only shift when we removed ahead of it.
      queueIndex: index < queueIndex ? queueIndex - 1 : queueIndex,
    });
  },

  reorderQueue: (ids) => {
    const { queue, queueIndex } = get();
    const currentId = queue[queueIndex]?.id;
    const byId = new Map(queue.map((t) => [t.id, t]));
    const next = ids.map((id) => byId.get(id)).filter((t): t is Track => t != null);
    if (next.length !== queue.length) return;
    set({
      queue: next,
      queueIndex: currentId ? next.findIndex((t) => t.id === currentId) : queueIndex,
    });
  },

  toggleLike: (id) =>
    set((state) => ({
      likedIds: { ...state.likedIds, [id]: !state.likedIds[id] },
    })),

  toggleShuffle: () => {
    const remoteSend = get().remoteSend;
    if (remoteSend) {
      remoteSend({ cmd: "toggle_shuffle" });
      return;
    }
    set((state) => ({ shuffle: !state.shuffle }));
  },

  cycleRepeat: () => {
    const remoteSend = get().remoteSend;
    if (remoteSend) {
      remoteSend({ cmd: "cycle_repeat" });
      return;
    }
    set((state) => ({
      repeat:
        state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off",
    }));
  },

  setExpanded: (value) => set({ isExpanded: value }),
  setQueueOpen: (value) => set({ isQueueOpen: value }),

  setRemoteSender: (fn) => {
    // Playback is about to be driven from elsewhere; nothing local follows.
    if (fn) cancelPreload();
    set({ remoteSend: fn });
  },

  remapTrackIds: (mapping) => {
    const { queue, likedIds } = get();
    if (!queue.some((t) => t.id in mapping) && !Object.keys(likedIds).some((id) => id in mapping)) {
      return;
    }
    const nextLiked: Record<string, boolean> = {};
    for (const [id, liked] of Object.entries(likedIds)) {
      nextLiked[mapping[id] ?? id] = liked;
    }
    set({
      queue: queue.map((t) => (t.id in mapping ? { ...t, id: mapping[t.id] } : t)),
      likedIds: nextLiked,
    });
  },

  applyRemoteState: (state) =>
    set({
      queue: state.queue,
      queueIndex: state.queueIndex,
      isPlaying: state.isPlaying,
      progress: state.progress,
      volume: state.volume,
      shuffle: state.shuffle,
      repeat: state.repeat,
    }),
}));

// Real playback position/end-of-track events from the Rust audio engine —
// only meaningful on whichever device is actually driving local playback
// (i.e. not currently controlling another device over the network).
/** Set when a track has been restarted to resume it after an output switch. */
let pendingResumeAt: number | null = null;

listen<number>("playback:position", (event) => {
  if (usePlayerStore.getState().remoteSend) return;
  // The first tick after a restart means the decoder is live, which is the
  // earliest a seek will actually land.
  if (pendingResumeAt !== null) {
    const target = pendingResumeAt;
    pendingResumeAt = null;
    usePlayerStore.getState().seek(target);
    return;
  }
  // A position tick means the engine is actively playing — clear any error
  // left behind by an earlier, since-superseded fetch that failed after this
  // one had already started succeeding.
  usePlayerStore.setState({ progress: event.payload, playbackError: null });

  const duration = usePlayerStore.getState().currentTrack()?.duration ?? 0;
  if (duration > 0 && duration - event.payload <= PRELOAD_LEAD_SECONDS) {
    requestPreload();
  }
});

// The engine moved onto the queued track by itself, with no gap. Follow it
// without calling `playReal` — the audio is already playing.
listen<string>("playback:advanced", (event) => {
  const planned = preloaded;
  preloaded = null;
  const state = usePlayerStore.getState();
  if (state.remoteSend) return;
  const index =
    planned && planned.id === event.payload && state.queue[planned.index]?.id === planned.id
      ? planned.index
      : state.queue.findIndex((t) => t.id === event.payload);
  if (index < 0) return;
  usePlayerStore.setState({
    queueIndex: index,
    progress: 0,
    isPlaying: true,
    playbackError: null,
    streamFormat: planned?.id === event.payload ? planned.format : null,
  });
});

// Editing the queue, or the shuffle/repeat rules, can change what comes next.
usePlayerStore.subscribe((s, prev) => {
  if (!preloaded) return;
  if (
    s.queue === prev.queue &&
    s.queueIndex === prev.queueIndex &&
    s.shuffle === prev.shuffle &&
    s.repeat === prev.repeat
  ) {
    return;
  }
  if (!preloadStillValid(preloaded, s)) cancelPreload();
});

/** For the gapless setting being switched off. */
export function cancelGaplessPreload() {
  cancelPreload();
}

// Switching output device tears down the sink the player was wired to, so the
// track has to be restarted. Jump back to where it was rather than silently
// dropping to the start or stopping altogether.
listen<{ wasPlaying: boolean; position: number | null }>("playback:output-changed", (event) => {
  // The engine dropped its queued successor along with the old sink,
  // whether or not anything was playing.
  preloaded = null;

  const state = usePlayerStore.getState();
  if (state.remoteSend || !event.payload.wasPlaying) return;
  const track = state.currentTrack();
  if (!track) return;

  const position = event.payload.position ?? 0;
  pendingResumeAt = position > 1 ? position : null;
  usePlayerStore.setState({ isPlaying: true });
  playReal(track, (message) =>
    usePlayerStore.setState({ playbackError: message, isPlaying: false }),
  );
});

listen("playback:ended", () => {
  if (usePlayerStore.getState().remoteSend) return;
  usePlayerStore.getState().next();
});

listen<string>("playback:error", (event) => {
  usePlayerStore.setState({ playbackError: event.payload });
});
