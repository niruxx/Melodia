import { usePlayerStore } from "../store/playerStore";
import { useLibraryStore } from "../store/libraryStore";
import type { Collection } from "../lib/types";

/** Resolves a real (signed-in) collection's tracks on demand and starts playback. */
export function usePlayCollection() {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const getPlaylistTracks = useLibraryStore((s) => s.getPlaylistTracks);

  return async (collection: Collection) => {
    const tracks = await getPlaylistTracks(collection.id);
    if (tracks.length > 0) playTrack(tracks[0], tracks);
  };
}
