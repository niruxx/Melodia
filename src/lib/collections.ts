import type { Collection, Track } from "./types";

/**
 * Wraps a single song in the shape the card grid speaks.
 *
 * The `song-` prefix is load-bearing: `libraryStore` reads it to resolve the
 * track straight out of its cache instead of asking YouTube for a playlist
 * that doesn't exist.
 */
export function trackAsCollection(track: Track): Collection {
  return {
    id: `song-${track.id}`,
    title: track.title,
    subtitle: track.artist,
    kind: "playlist",
    trackIds: [track.id],
    thumbnail: track.thumbnail,
  };
}
