import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "../store/toastStore";

/**
 * Share links point at music.youtube.com rather than youtube.com so they open
 * in the recipient's YouTube Music app or web player.
 */
export function trackShareUrl(videoId: string): string {
  return `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

export function collectionShareUrl(id: string): string {
  // Album browse ids aren't valid on the playlist route; they have their own.
  if (id.startsWith("MPREb_")) {
    return `https://music.youtube.com/browse/${encodeURIComponent(id)}`;
  }
  if (id.startsWith("UC")) {
    return `https://music.youtube.com/channel/${encodeURIComponent(id)}`;
  }
  return `https://music.youtube.com/playlist?list=${encodeURIComponent(id)}`;
}

/** Synthetic ids the app invents for home-shelf songs aren't shareable as-is. */
export function isShareable(id: string | undefined): id is string {
  return Boolean(id) && !id!.startsWith("local:");
}

export async function copyLink(url: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast.success(`${what} link copied`);
  } catch {
    toast.error("Couldn't copy to clipboard");
  }
}

export async function openLink(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch (e) {
    toast.error(String(e));
  }
}
