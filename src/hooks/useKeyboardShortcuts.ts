import { useEffect } from "react";
import { usePlayerStore } from "../store/playerStore";
import { useDiscordStore } from "../store/discordStore";
import { useNetworkStore } from "../store/networkStore";
import { useContextMenuStore } from "../store/contextMenuStore";
import { useUiStore } from "../store/uiStore";

const SEEK_STEP = 5;
const VOLUME_STEP = 0.05;

/** True when the user is typing, so shortcuts must not steal the keystroke. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

/**
 * Closes the topmost overlay, in the order a user perceives them as stacked.
 * Returns false when there was nothing to close.
 */
function closeTopmostOverlay(): boolean {
  const ui = useUiStore.getState();
  const menu = useContextMenuStore.getState();
  const player = usePlayerStore.getState();
  const discord = useDiscordStore.getState();
  const network = useNetworkStore.getState();

  if (menu.open) return menu.close(), true;
  if (ui.isPaletteOpen) return ui.setPaletteOpen(false), true;
  if (ui.isShortcutsOpen) return ui.setShortcutsOpen(false), true;
  if (discord.isSettingsOpen) return discord.closeSettings(), true;
  if (network.isDeviceModalOpen) return network.closeDeviceModal(), true;
  if (player.isExpanded) return player.setExpanded(false), true;
  if (player.isQueueOpen) return player.setQueueOpen(false), true;
  return false;
}

/** Registers the app's global keyboard shortcuts on `window`. */
export function useKeyboardShortcuts() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const ui = useUiStore.getState();
      const player = usePlayerStore.getState();
      const mod = e.ctrlKey || e.metaKey;

      // Command palette works even from inside a text field.
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ui.setPaletteOpen(!ui.isPaletteOpen);
        return;
      }

      if (e.key === "Escape") {
        if (closeTopmostOverlay()) e.preventDefault();
        return;
      }

      if (isTypingTarget(e.target)) return;
      // Let browser/OS combos through untouched.
      if (mod || e.altKey) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          player.togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) player.prev();
          else player.seek(Math.max(0, player.progress - SEEK_STEP));
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) player.next();
          else {
            const max = player.currentTrack()?.duration ?? 0;
            player.seek(Math.min(max, player.progress + SEEK_STEP));
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          player.setVolume(player.volume + VOLUME_STEP);
          break;
        case "ArrowDown":
          e.preventDefault();
          player.setVolume(player.volume - VOLUME_STEP);
          break;
        case "/":
          e.preventDefault();
          document.querySelector<HTMLInputElement>("input[type='search'], header input")?.focus();
          break;
        case "?":
          e.preventDefault();
          ui.setShortcutsOpen(!ui.isShortcutsOpen);
          break;
        default:
          break;
      }

      switch (e.key.toLowerCase()) {
        case "m":
          player.toggleMute();
          break;
        case "s":
          player.toggleShuffle();
          break;
        case "r":
          player.cycleRepeat();
          break;
        case "q":
          player.setQueueOpen(!player.isQueueOpen);
          break;
        case "f": {
          const track = player.currentTrack();
          if (track) player.setExpanded(!player.isExpanded);
          break;
        }
        case "l": {
          const track = player.currentTrack();
          if (track) player.toggleLike(track.id);
          break;
        }
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/** Rendered in the shortcuts overlay; single source of truth for the list. */
export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["Space"], label: "Play / pause" },
  { keys: ["←", "→"], label: "Seek 5 seconds" },
  { keys: ["Shift", "←/→"], label: "Previous / next track" },
  { keys: ["↑", "↓"], label: "Volume up / down" },
  { keys: ["M"], label: "Mute" },
  { keys: ["L"], label: "Like current song" },
  { keys: ["S"], label: "Shuffle" },
  { keys: ["R"], label: "Repeat mode" },
  { keys: ["F"], label: "Fullscreen player" },
  { keys: ["Q"], label: "Toggle queue" },
  { keys: ["/"], label: "Focus search" },
  { keys: ["Ctrl", "K"], label: "Command palette" },
  { keys: ["?"], label: "This help" },
  { keys: ["Esc"], label: "Close overlay" },
];
