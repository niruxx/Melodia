import { create } from "zustand";
import type { Track } from "../lib/mockData";
import type { RemoteCommand, RemoteState } from "../lib/types";

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
  toggleLike: (id: string) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setExpanded: (value: boolean) => void;
  setQueueOpen: (value: boolean) => void;
  tick: () => void;
  setRemoteSender: (fn: ((cmd: RemoteCommand) => void) | null) => void;
  applyRemoteState: (state: RemoteState) => void;
};

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
  remoteSend: null,

  currentTrack: () => {
    const { queue, queueIndex } = get();
    return queue[queueIndex];
  },

  playTrack: (track, context) => {
    const remoteSend = get().remoteSend;
    if (remoteSend) {
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
    });
  },

  togglePlay: () => {
    const remoteSend = get().remoteSend;
    if (remoteSend) {
      remoteSend({ cmd: "toggle_play" });
      return;
    }
    if (get().queue.length === 0) return;
    set((state) => ({ isPlaying: !state.isPlaying }));
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
      return;
    }
    let nextIndex = shuffle
      ? Math.floor(Math.random() * queue.length)
      : queueIndex + 1;
    if (nextIndex >= queue.length) {
      if (repeat === "all") {
        nextIndex = 0;
      } else {
        set({ isPlaying: false, progress: 0 });
        return;
      }
    }
    set({ queueIndex: nextIndex, progress: 0, isPlaying: true });
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
      return;
    }
    const prevIndex = Math.max(0, queueIndex - 1);
    set({ queueIndex: prevIndex, progress: 0, isPlaying: true });
  },

  jumpTo: (index) => {
    const remoteSend = get().remoteSend;
    if (remoteSend) {
      remoteSend({ cmd: "jump_to", index });
      return;
    }
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    set({ queueIndex: index, progress: 0, isPlaying: true });
  },

  seek: (seconds) => {
    const remoteSend = get().remoteSend;
    if (remoteSend) {
      remoteSend({ cmd: "seek", seconds });
      return;
    }
    set({ progress: seconds });
  },

  setVolume: (volume) => {
    const remoteSend = get().remoteSend;
    if (remoteSend) {
      remoteSend({ cmd: "set_volume", volume });
      return;
    }
    set({ volume: Math.min(1, Math.max(0, volume)) });
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

  tick: () => {
    const state = get();
    if (state.remoteSend) return; // progress is driven by incoming remote state instead
    const track = state.queue[state.queueIndex];
    if (!state.isPlaying || !track) return;
    const nextProgress = state.progress + 0.5;
    if (nextProgress >= track.duration) {
      get().next();
    } else {
      set({ progress: nextProgress });
    }
  },

  setRemoteSender: (fn) => set({ remoteSend: fn }),

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

setInterval(() => usePlayerStore.getState().tick(), 500);
