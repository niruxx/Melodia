import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search as SearchIcon } from "lucide-react";
import { TrackList } from "../components/TrackList";
import { TrackListSkeleton } from "../components/Skeleton";
import { SignInPrompt } from "../components/SignInPrompt";
import { useAuthStore } from "../store/authStore";
import { useSourceStore } from "../store/sourceStore";
import { useLocalLibraryStore } from "../store/localLibraryStore";
import { searchTracks } from "../lib/ytmusic";
import { searchTracks as searchSoundCloudTracks } from "../lib/soundcloud";
import type { Track } from "../lib/types";

export function Search() {
  const authState = useAuthStore((s) => s.state);
  const active = useSourceStore((s) => s.active);
  const isLocal = active === "local";
  const isSoundCloud = active === "soundcloud";
  const localTracks = useLocalLibraryStore((s) => s.tracks);
  const [params] = useSearchParams();
  const query = (params.get("q") ?? "").trim();

  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }
    if (isLocal) {
      const q = query.toLowerCase();
      setResults(
        localTracks.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.artist.toLowerCase().includes(q) ||
            t.album.toLowerCase().includes(q),
        ),
      );
      setError(null);
      return;
    }
    if (isSoundCloud) {
      // SoundCloud's search works unauthenticated with just a client_id, so
      // browsing doesn't need to wait on a sign-in the way the library does.
      let cancelled = false;
      setLoading(true);
      setError(null);
      searchSoundCloudTracks(query)
        .then((tracks) => {
          if (!cancelled) setResults(tracks);
        })
        .catch((e) => {
          if (!cancelled) setError(String(e));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (authState !== "signed_in") {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    searchTracks(query)
      .then((tracks) => {
        if (!cancelled) setResults(tracks);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, authState, isLocal, isSoundCloud, localTracks]);

  if (!isLocal && !isSoundCloud && authState !== "signed_in") {
    return <SignInPrompt />;
  }

  if (!query) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-muted">
        <SearchIcon size={40} strokeWidth={1.25} />
        <p>Search for songs, artists, albums, and playlists.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 px-6 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Results for <span className="gradient-text">&ldquo;{query}&rdquo;</span>
      </h1>

      {loading && <TrackListSkeleton rows={8} />}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && !error && results.length === 0 && <p className="text-muted">No matches found.</p>}

      {results.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="mb-2 text-lg font-semibold tracking-tight">Songs</h2>
          <TrackList tracks={results} />
        </section>
      )}
    </div>
  );
}
