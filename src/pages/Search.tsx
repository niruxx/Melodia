import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, Search as SearchIcon } from "lucide-react";
import { TrackRow } from "../components/TrackRow";
import { SignInPrompt } from "../components/SignInPrompt";
import { useAuthStore } from "../store/authStore";
import { useSourceStore } from "../store/sourceStore";
import { useLocalLibraryStore } from "../store/localLibraryStore";
import { searchTracks } from "../lib/ytmusic";
import type { Track } from "../lib/types";

export function Search() {
  const authState = useAuthStore((s) => s.state);
  const isLocal = useSourceStore((s) => s.active === "local");
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
  }, [query, authState, isLocal, localTracks]);

  if (!isLocal && authState !== "signed_in") {
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
      <h1 className="text-xl font-semibold tracking-tight">
        Results for <span className="gradient-text">&ldquo;{query}&rdquo;</span>
      </h1>

      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-accent" />
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && !error && results.length === 0 && <p className="text-muted">No matches found.</p>}

      {results.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="mb-2 text-lg font-semibold tracking-tight">Songs</h2>
          {results.map((track, i) => (
            <TrackRow key={`${track.id}-${i}`} track={track} index={i} tracks={results} />
          ))}
        </section>
      )}
    </div>
  );
}
