import type { MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Copy,
  Disc3,
  ExternalLink,
  Heart,
  HeartOff,
  Link2,
  ListEnd,
  ListPlus,
  ListStart,
  ListX,
  Play,
} from "lucide-react";
import { usePlayerStore } from "../store/playerStore";
import { useAuthStore } from "../store/authStore";
import { useScAuthStore } from "../store/scAuthStore";
import { useContextMenuStore, type MenuItem } from "../store/contextMenuStore";
import { usePlaylistModalStore } from "../store/playlistModalStore";
import { toast } from "../store/toastStore";
import { copyLink, openLink, trackShareUrl } from "../lib/share";
import type { Track } from "../lib/types";

export type TrackMenuOptions = {
  /** Supplied by pages showing an editable playlist; adds the remove entry. */
  onRemoveFromPlaylist?: (track: Track) => void;
};

/**
 * Returns an `onContextMenu` handler that opens the standard track menu.
 * Reads store state imperatively at open time so the returned callback is
 * stable and rows don't re-render when unrelated player state changes.
 */
export function useTrackContextMenu() {
  const openMenu = useContextMenuStore((s) => s.openMenu);
  const navigate = useNavigate();

  return (event: MouseEvent, track: Track, tracks?: Track[], options?: TrackMenuOptions) => {
    event.preventDefault();
    event.stopPropagation();

    const player = usePlayerStore.getState();
    const liked = !!player.likedIds[track.id];
    const isLocal = track.id.startsWith("local:");
    const isSoundCloudTrack = track.id.startsWith("sc:");
    // "Add to playlist" and the share/open links depend on whichever
    // provider this specific track came from, not on the currently-active
    // tab — a right-click on a SoundCloud card while browsing YouTube Music
    // (e.g. from a mixed list) still needs SoundCloud's own sign-in state.
    const isSignedIn = isSoundCloudTrack
      ? useScAuthStore.getState().state === "signed_in"
      : useAuthStore.getState().state === "signed_in";

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

    // A local file has no videoId YouTube would accept, so it can't go into a
    // YouTube Music playlist at all.
    if (!isLocal && isSignedIn) {
      items.push({
        label: "Add to playlist",
        icon: ListPlus,
        onSelect: () => usePlaylistModalStore.getState().openAddTo([track]),
      });
    }

    if (options?.onRemoveFromPlaylist) {
      const remove = options.onRemoveFromPlaylist;
      items.push({
        label: "Remove from this playlist",
        icon: ListX,
        danger: true,
        onSelect: () => remove(track),
      });
    }

    // Local tracks have no browsable album page, so only offer it for
    // library-backed tracks that actually name an album.
    if (track.album && !isLocal) {
      items.push({
        label: "Go to album",
        icon: Disc3,
        onSelect: () => navigate(`/search?q=${encodeURIComponent(track.album)}`),
      });
    }

    items.push({ kind: "separator" });

    // A local file has no page to point anyone at. A SoundCloud track only
    // has one if the API actually handed back its permalink (not every shape
    // it returns includes one, e.g. a playlist stub).
    if (isSoundCloudTrack && track.permalinkUrl) {
      const url = track.permalinkUrl;
      items.push(
        { label: "Copy share link", icon: Link2, onSelect: () => void copyLink(url, "Song") },
        { label: "Open in SoundCloud", icon: ExternalLink, onSelect: () => void openLink(url) },
      );
    } else if (!isLocal && !isSoundCloudTrack) {
      items.push(
        {
          label: "Copy share link",
          icon: Link2,
          onSelect: () => void copyLink(trackShareUrl(track.id), "Song"),
        },
        {
          label: "Open in YouTube Music",
          icon: ExternalLink,
          onSelect: () => void openLink(trackShareUrl(track.id)),
        },
      );
    }

    items.push({
      label: "Copy song name",
      icon: Copy,
      onSelect: () => {
        navigator.clipboard
          .writeText(`${track.title} — ${track.artist}`)
          .then(() => toast.info("Copied to clipboard"))
          .catch(() => toast.error("Couldn't copy to clipboard"));
      },
    });

    openMenu(event.clientX, event.clientY, items);
  };
}
