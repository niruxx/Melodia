import { Card } from "../components/Card";
import { TrackList } from "../components/TrackList";
import { CardGridSkeleton } from "../components/Skeleton";
import { SignInPrompt } from "../components/SignInPrompt";
import { useAuthStore } from "../store/authStore";
import { useLibraryStore } from "../store/libraryStore";
import { useSourceStore } from "../store/sourceStore";
import { useLocalLibraryStore } from "../store/localLibraryStore";
import { useScAuthStore } from "../store/scAuthStore";
import { useScLibraryStore } from "../store/scLibraryStore";
import { usePlayCollection } from "../hooks/usePlayCollection";

export function Library() {
  const authState = useAuthStore((s) => s.state);
  const active = useSourceStore((s) => s.active);
  const isLocal = active === "local";
  const isSoundCloud = active === "soundcloud";
  const playlists = useLibraryStore((s) => s.playlists);
  const albums = useLibraryStore((s) => s.albums);
  const localAlbums = useLocalLibraryStore((s) => s.albums);
  const localFolder = useLocalLibraryStore((s) => s.folder);
  const localLoading = useLocalLibraryStore((s) => s.loading);
  const localError = useLocalLibraryStore((s) => s.error);

  const scAuthState = useScAuthStore((s) => s.state);
  const scOpenModal = useScAuthStore((s) => s.openModal);
  const scPlaylists = useScLibraryStore((s) => s.playlists);
  const scLikes = useScLibraryStore((s) => s.likes);
  const scFollowings = useScLibraryStore((s) => s.followings);

  const playCollection = usePlayCollection();

  if (isSoundCloud) {
    if (scAuthState !== "signed_in") {
      return (
        <SignInPrompt
          title="Connect your SoundCloud account"
          message="Sign in with SoundCloud to see your playlists, likes, and followed artists."
          buttonLabel="Connect SoundCloud"
          onSignIn={scOpenModal}
        />
      );
    }

    const scLoading = scPlaylists.loading || scLikes.loading;

    return (
      <div className="flex flex-col gap-8 px-6 py-6">
        <h1 className="text-2xl font-semibold tracking-tight">Your SoundCloud Library</h1>

        {scLoading && <CardGridSkeleton />}

        {scLikes.data && scLikes.data.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Liked tracks</h2>
            <TrackList tracks={scLikes.data} />
          </section>
        )}

        {scPlaylists.data && scPlaylists.data.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Playlists</h2>
            <div className="flex flex-wrap gap-4">
              {scPlaylists.data.map((c) => (
                <Card key={c.id} collection={c} onPlay={() => playCollection(c)} />
              ))}
            </div>
          </section>
        )}

        {scFollowings.data && scFollowings.data.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Following</h2>
            <div className="flex flex-wrap gap-3">
              {scFollowings.data.map((f) => (
                <a
                  key={f.username}
                  href={f.permalinkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-col items-center gap-2 text-center"
                >
                  <img
                    src={f.avatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-20 w-20 rounded-full object-cover"
                  />
                  <span className="max-w-[6rem] truncate text-xs text-muted">{f.username}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        {scPlaylists.error && <p className="text-sm text-red-400">{scPlaylists.error}</p>}
        {scLikes.error && <p className="text-sm text-red-400">{scLikes.error}</p>}
      </div>
    );
  }

  if (isLocal) {
    return (
      <div className="flex flex-col gap-8 px-6 py-6">
        <h1 className="text-2xl font-semibold tracking-tight">Local Library</h1>

        {!localFolder && localAlbums.length === 0 && (
          <p className="text-muted">
            No local music folder configured yet. Pick one in Settings to see your albums here.
          </p>
        )}

        {localLoading && <CardGridSkeleton cards={6} />}

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

      {loading && <CardGridSkeleton />}

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
