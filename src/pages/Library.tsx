import { Loader2 } from "lucide-react";
import { Card } from "../components/Card";
import { SignInPrompt } from "../components/SignInPrompt";
import { useAuthStore } from "../store/authStore";
import { useLibraryStore } from "../store/libraryStore";
import { useSourceStore } from "../store/sourceStore";
import { useLocalLibraryStore } from "../store/localLibraryStore";
import { usePlayCollection } from "../hooks/usePlayCollection";

export function Library() {
  const authState = useAuthStore((s) => s.state);
  const isLocal = useSourceStore((s) => s.active === "local");
  const playlists = useLibraryStore((s) => s.playlists);
  const albums = useLibraryStore((s) => s.albums);
  const localAlbums = useLocalLibraryStore((s) => s.albums);
  const localFolder = useLocalLibraryStore((s) => s.folder);
  const localLoading = useLocalLibraryStore((s) => s.loading);
  const localError = useLocalLibraryStore((s) => s.error);
  const playCollection = usePlayCollection();

  if (isLocal) {
    return (
      <div className="flex flex-col gap-8 px-6 py-6">
        <h1 className="text-2xl font-semibold tracking-tight">Local Library</h1>

        {!localFolder && localAlbums.length === 0 && (
          <p className="text-muted">
            No local music folder configured yet. Pick one in Settings to see your albums here.
          </p>
        )}

        {localLoading && (
          <div className="flex justify-center py-16">
            <Loader2 size={24} className="animate-spin text-accent" />
          </div>
        )}

        {localError && <p className="text-sm text-red-400">{localError}</p>}

        {localAlbums.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Albums</h2>
            <div className="flex flex-wrap gap-4">
              {localAlbums.map((c) => (
                <Card key={c.id} collection={c} onPlay={() => playCollection(c)} />
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  if (authState !== "signed_in") {
    return <SignInPrompt />;
  }

  const loading = playlists.loading || albums.loading;

  return (
    <div className="flex flex-col gap-8 px-6 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Your Library</h1>

      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-accent" />
        </div>
      )}

      {playlists.data && playlists.data.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Playlists</h2>
          <div className="flex flex-wrap gap-4">
            {playlists.data.map((c) => (
              <Card key={c.id} collection={c} onPlay={() => playCollection(c)} />
            ))}
          </div>
        </section>
      )}

      {albums.data && albums.data.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Albums</h2>
          <div className="flex flex-wrap gap-4">
            {albums.data.map((c) => (
              <Card key={c.id} collection={c} onPlay={() => playCollection(c)} />
            ))}
          </div>
        </section>
      )}

      {playlists.error && <p className="text-sm text-red-400">{playlists.error}</p>}
      {albums.error && <p className="text-sm text-red-400">{albums.error}</p>}
    </div>
  );
}
