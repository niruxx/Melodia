import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { usePlayerStore } from "../store/playerStore";

/**
 * Wires the OS media keys (registered in `src-tauri/src/lib.rs`) to playback.
 * Registration is best-effort on the Rust side, so a key already claimed by
 * another media app simply never fires here.
 */
export function useMediaKeys() {
  useEffect(() => {
    const unlisteners = [
      listen("media:play-pause", () => usePlayerStore.getState().togglePlay()),
      listen("media:next", () => usePlayerStore.getState().next()),
      listen("media:prev", () => usePlayerStore.getState().prev()),
      listen("media:stop", () => {
        const player = usePlayerStore.getState();
        if (player.isPlaying) player.togglePlay();
      }),
    ];
    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, []);
}
