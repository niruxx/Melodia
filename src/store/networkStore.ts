import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { usePlayerStore } from "./playerStore";
import type { RemoteCommand, RemoteState } from "../lib/types";

export type Peer = { id: string; name: string };
export type NetworkRole = "idle" | "controller" | "controlled";

type NetworkStore = {
  peers: Peer[];
  role: NetworkRole;
  connectedPeerName: string | null;
  incomingRequest: { fromName: string } | null;
  isDeviceModalOpen: boolean;
  connecting: boolean;
  error: string | null;

  init: () => Promise<void>;
  connect: (peer: Peer) => Promise<void>;
  disconnect: () => Promise<void>;
  respondToRequest: (accept: boolean) => Promise<void>;
  openDeviceModal: () => void;
  closeDeviceModal: () => void;
};

let initialized = false;
let lastBroadcast: string | null = null;

function applyRemoteCommand(cmd: RemoteCommand) {
  const player = usePlayerStore.getState();
  switch (cmd.cmd) {
    case "play_track":
      player.playTrack(cmd.track, cmd.queue);
      break;
    case "toggle_play":
      player.togglePlay();
      break;
    case "next":
      player.next();
      break;
    case "prev":
      player.prev();
      break;
    case "jump_to":
      player.jumpTo(cmd.index);
      break;
    case "seek":
      player.seek(cmd.seconds);
      break;
    case "set_volume":
      player.setVolume(cmd.volume);
      break;
    case "toggle_shuffle":
      player.toggleShuffle();
      break;
    case "cycle_repeat":
      player.cycleRepeat();
      break;
  }
}

export const useNetworkStore = create<NetworkStore>((set, get) => ({
  peers: [],
  role: "idle",
  connectedPeerName: null,
  incomingRequest: null,
  isDeviceModalOpen: false,
  connecting: false,
  error: null,

  init: async () => {
    if (initialized) return;
    initialized = true;

    await invoke("network_start").catch((e) => set({ error: String(e) }));

    await listen<Peer[]>("network:peers", (event) => set({ peers: event.payload }));

    await listen<{ fromName: string }>("network:incoming-request", (event) =>
      set({ incomingRequest: event.payload }),
    );

    await listen<{ peer: string }>("network:controlled-started", (event) =>
      set({ role: "controlled", connectedPeerName: event.payload.peer }),
    );

    await listen<RemoteCommand>("network:command", (event) => applyRemoteCommand(event.payload));

    await listen<RemoteState>("network:state", (event) =>
      usePlayerStore.getState().applyRemoteState(event.payload),
    );

    await listen("network:peer-disconnected", () => {
      usePlayerStore.getState().setRemoteSender(null);
      set({ role: "idle", connectedPeerName: null });
    });

    // Push local playback state out whenever it changes while we're the controlled device.
    usePlayerStore.subscribe((state) => {
      if (get().role !== "controlled") return;
      const snapshot: RemoteState = {
        queue: state.queue,
        queueIndex: state.queueIndex,
        isPlaying: state.isPlaying,
        progress: state.progress,
        volume: state.volume,
        shuffle: state.shuffle,
        repeat: state.repeat,
      };
      const serialized = JSON.stringify(snapshot);
      if (serialized === lastBroadcast) return;
      lastBroadcast = serialized;
      invoke("network_broadcast_state", { payload: snapshot }).catch(() => {});
    });
  },

  connect: async (peer) => {
    set({ connecting: true, error: null });
    try {
      await invoke("network_connect", { peerId: peer.id });
      usePlayerStore.getState().setRemoteSender((cmd) => {
        invoke("network_send_command", { payload: cmd }).catch(() => {});
      });
      set({ role: "controller", connectedPeerName: peer.name, isDeviceModalOpen: false });
    } catch (e) {
      set({ error: String(e) });
      throw e;
    } finally {
      set({ connecting: false });
    }
  },

  disconnect: async () => {
    await invoke("network_disconnect").catch(() => {});
    usePlayerStore.getState().setRemoteSender(null);
    set({ role: "idle", connectedPeerName: null });
  },

  respondToRequest: async (accept) => {
    await invoke("network_respond_request", { accept }).catch(() => {});
    set({ incomingRequest: null });
  },

  openDeviceModal: () => set({ isDeviceModalOpen: true }),
  closeDeviceModal: () => set({ isDeviceModalOpen: false }),
}));
