import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Carousel } from "../components/Carousel";
import { Card } from "../components/Card";
import { CarouselSkeleton } from "../components/Skeleton";
import { SignInPrompt } from "../components/SignInPrompt";
import { useAuthStore } from "../store/authStore";
import { useSourceStore } from "../store/sourceStore";
import { useLibraryStore } from "../store/libraryStore";
import { useAccountStore } from "../store/accountStore";
import { useScAuthStore } from "../store/scAuthStore";
import { useScLibraryStore } from "../store/scLibraryStore";
import { useScAccountStore } from "../store/scAccountStore";
import { usePlayCollection } from "../hooks/usePlayCollection";
import { Suggested } from "../components/Suggested";
import { trackAsCollection } from "../lib/collections";

/** Shown while the account name loads, or if it can't be fetched. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Late night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function Home() {
  const authState = useAuthStore((s) => s.state);
  const active = useSourceStore((s) => s.active);
  const isLocal = active === "local";
  const isSoundCloud = active === "soundcloud";
  const home = useLibraryStore((s) => s.home);
  const history = useLibraryStore((s) => s.history);
  const account = useAccountStore((s) => s.info);
  const accountLoading = useAccountStore((s) => s.loading);

  const scAuthState = useScAuthStore((s) => s.state);
  const scOpenModal = useScAuthStore((s) => s.openModal);
  const scHome = useScLibraryStore((s) => s.home);
  const scAccount = useScAccountStore((s) => s.info);

  const playCollection = usePlayCollection();
  const [avatarFailed, setAvatarFailed] = useState(false);

  // The home feed is a YouTube Music concept; in Local mode there's nothing to
  // show here, and demanding a Google sign-in would be nonsense.
  if (isLocal) {
    return <Navigate to="/library" replace />;
  }

  if (isSoundCloud) {
    if (scAuthState !== "signed_in") {
      return (
        <SignInPrompt
          title="Connect your SoundCloud account"
          message="Sign in with SoundCloud to load your stream, likes, and followed artists."
          buttonLabel="Connect SoundCloud"
          onSignIn={scOpenModal}
        />
      );
    }
    return (
      <div className="flex flex-col gap-8 px-6 py-6">
        <div className="flex items-center gap-3">
          {scAccount?.avatarUrl && !avatarFailed ? (
            <img
              src={scAccount.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setAvatarFailed(true)}
              className="h-11 w-11 shrink-0 rounded-full object-cover shadow-lg shadow-black/40"
            />
          ) : (
            scAccount?.username && (
              <div className="brand-mark flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white shadow-lg shadow-black/40">
                {scAccount.username.trim().charAt(0).toUpperCase()}
              </div>
            )
          )}
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {scAccount?.username ?? greeting()}
            </h1>
          </div>
        </div>

        {scHome.loading && (
          <>
            <CarouselSkeleton />
            <CarouselSkeleton />
          </>
        )}

        {scHome.error && (
          <p className="text-sm text-red-400">Couldn&rsquo;t load your SoundCloud home: {scHome.error}</p>
        )}

        {scHome.data?.map((section) => (
          <Carousel key={section.title} title={section.title}>
            {section.items.map((item) => (
              <Card key={item.id} collection={item} onPlay={() => playCollection(item)} />
            ))}
          </Carousel>
        ))}
      </div>
    );
  }

  if (authState !== "signed_in") {
    return <SignInPrompt />;
  }

  return (
    <div className="flex flex-col gap-8 px-6 py-6">
      <div className="flex items-center gap-3">
        {account?.accountPhotoUrl && !avatarFailed ? (
          <img
            src={account.accountPhotoUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setAvatarFailed(true)}
            className="h-11 w-11 shrink-0 rounded-full object-cover shadow-lg shadow-black/40"
          />
        ) : (
          account?.accountName && (
            // Initial-in-a-circle stand-in when the photo is absent or blocked.
            <div className="brand-mark flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white shadow-lg shadow-black/40">
              {account.accountName.trim().charAt(0).toUpperCase()}
            </div>
          )
        )}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {account?.accountName ?? (accountLoading ? "" : greeting())}
          </h1>
          {account?.channelHandle && (
            <p className="truncate text-sm text-muted">{account.channelHandle}</p>
          )}
        </div>
      </div>

      <Suggested />

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
