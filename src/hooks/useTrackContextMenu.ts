import type { MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Disc3, Heart, HeartOff, ListEnd, ListStart, Play } from "lucide-react";
import { usePlayerStore } from "../store/playerStore";
import { useContextMenuStore, type MenuItem } from "../store/contextMenuStore";
import { toast } from "../store/toastStore";
import type { Track } from "../lib/types";

/**
 * Returns an `onContextMenu` handler that opens the standard track menu.
 * Reads store state imperatively at open time so the returned callback is
 * stable and rows don't re-render when unrelated player state changes.
 */
export function useTrackContextMenu() {
  const openMenu = useContextMenuStore((s) => s.openMenu);
  const navigate = useNavigate();

  return (event: MouseEvent, track: Track, tracks?: Track[]) => {
    event.preventDefault();
    event.stopPropagation();

    const player = usePlayerStore.getState();
    const liked = !!player.likedIds[track.id];

    const items: MenuItem[] = [
      {
        label: "Play",
        icon: Play,
        onSelect: () => player.playTrack(track, tracks),
      },
      {
        label: "Play next",
        icon: ListStart,
        onSelect: () => {
          player.playNext(track);
          toast.success(`Playing next: ${track.title}`);
        },
      },
      {
        label: "Add to queue",
        icon: ListEnd,
        onSelect: () => {
          player.addToQueue(track);
          toast.success(`Added to queue: ${track.title}`);
        },
      },
      { kind: "separator" },
      {
        label: liked ? "Remove from Liked Songs" : "Add to Liked Songs",
        icon: liked ? HeartOff : Heart,
        onSelect: () => {
          player.toggleLike(track.id);
          toast.info(liked ? "Removed from Liked Songs" : "Added to Liked Songs");
        },
      },
    ];

    // Local tracks have no browsable album page, so only offer it for
    // library-backed tracks that actually name an album.
    if (track.album && !track.id.startsWith("local:")) {
      items.push({
        label: "Go to album",
        icon: Disc3,
        onSelect: () => navigate(`/search?q=${encodeURIComponent(track.album)}`),
      });
    }

    items.push(
      { kind: "separator" },
      {
        label: "Copy song name",
        icon: Copy,
        onSelect: () => {
          navigator.clipboard
            .writeText(`${track.title} — ${track.artist}`)
            .then(() => toast.info("Copied to clipboard"))
            .catch(() => toast.error("Couldn't copy to clipboard"));
        },
      },
    );

    openMenu(event.clientX, event.clientY, items);
  };
}
