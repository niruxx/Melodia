import { usePlayerStore } from "../store/playerStore";
import { useLibraryStore } from "../store/libraryStore";
import { useScLibraryStore } from "../store/scLibraryStore";
import { useLocalLibraryStore } from "../store/localLibraryStore";
import { SC_ID_PREFIX } from "../lib/soundcloud";
import type { Collection } from "../lib/types";

/** Resolves a collection's tracks on demand (YouTube, SoundCloud, or local)
 * and starts playback. */
export function usePlayCollection() {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const getPlaylistTracks = useLibraryStore((s) => s.getPlaylistTracks);
  const getScPlaylistTracks = useScLibraryStore((s) => s.getPlaylistTracks);
  const localTracks = useLocalLibraryStore((s) => s.tracks);

  return async (collection: Collection) => {
    if (collection.id.startsWith("local-album:")) {
      const byId = new Map(localTracks.map((t) => [t.id, t]));
      const tracks = collection.trackIds.map((id) => byId.get(id)).filter((t) => t != null);
      if (tracks.length > 0) playTrack(tracks[0], tracks);
      return;
    }
    const tracks = await (collection.id.startsWith(SC_ID_PREFIX)
      ? getScPlaylistTracks(collection.id)
      : getPlaylistTracks(collection.id));
    if (tracks.length > 0) playTrack(tracks[0], tracks);
  };
}
