import { Navigate } from "react-router-dom";
import { Carousel } from "../components/Carousel";
import { Card } from "../components/Card";
import { CarouselSkeleton } from "../components/Skeleton";
import { SignInPrompt } from "../components/SignInPrompt";
import { useAuthStore } from "../store/authStore";
import { useSourceStore } from "../store/sourceStore";
import { useLibraryStore } from "../store/libraryStore";
import { usePlayCollection } from "../hooks/usePlayCollection";
import type { Collection, Track } from "../lib/types";

function trackAsCollection(track: Track): Collection {
  return {
    id: `song-${track.id}`,
    title: track.title,
    subtitle: track.artist,
    kind: "playlist",
    trackIds: [track.id],
    thumbnail: track.thumbnail,
  };
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Late night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function Home() {
  const authState = useAuthStore((s) => s.state);
  const isLocal = useSourceStore((s) => s.active === "local");
  const home = useLibraryStore((s) => s.home);
  const history = useLibraryStore((s) => s.history);
  const playCollection = usePlayCollection();

  // The home feed is a YouTube Music concept; in Local mode there's nothing to
  // show here, and demanding a Google sign-in would be nonsense.
  if (isLocal) {
    return <Navigate to="/library" replace />;
  }

  if (authState !== "signed_in") {
    return <SignInPrompt />;
  }

  return (
    <div className="flex flex-col gap-8 px-6 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">{greeting()}</h1>

      {home.loading && (
        <>
          <CarouselSkeleton />
          <CarouselSkeleton />
          <CarouselSkeleton />
        </>
      )}

      {history.data && history.data.length > 0 && (
        <Carousel title="Recently played">
          {history.data.slice(0, 15).map((track) => {
            const collection = trackAsCollection(track);
            return <Card key={collection.id} collection={collection} onPlay={() => playCollection(collection)} />;
          })}
        </Carousel>
      )}

      {home.error && <p className="text-sm text-red-400">Couldn&rsquo;t load your home feed: {home.error}</p>}

      {home.data?.map((section) => (
        <Carousel key={section.title} title={section.title}>
          {section.items.map((item) => (
            <Card key={item.id} collection={item} onPlay={() => playCollection(item)} />
          ))}
        </Carousel>
      ))}
    </div>
  );
}
