import { useEffect } from "react";
import { HashRouter, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { TitleBar } from "./components/TitleBar";
import { ResizeHandles } from "./components/ResizeHandles";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { NowPlayingBar } from "./components/NowPlayingBar";
import { NowPlayingExpanded } from "./components/NowPlayingExpanded";
import { QueueDrawer } from "./components/QueueDrawer";
import { SignInModal } from "./components/SignInModal";
import { SettingsModal } from "./components/SettingsModal";
import { DeviceConnectModal } from "./components/DeviceConnectModal";
import { PlaylistFormModal } from "./components/PlaylistFormModal";
import { AddToPlaylistModal } from "./components/AddToPlaylistModal";
import { IncomingControlRequestModal } from "./components/IncomingControlRequestModal";
import { PageTransition } from "./components/PageTransition";
import { ContextMenu } from "./components/ContextMenu";
import { Toaster } from "./components/Toaster";
import { CommandPalette } from "./components/CommandPalette";
import { ShortcutsOverlay } from "./components/ShortcutsOverlay";
import { MiniPlayer } from "./components/MiniPlayer";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useMediaKeys } from "./hooks/useMediaKeys";
import { useMiniPlayerStore } from "./store/miniPlayerStore";
import { Home } from "./pages/Home";
import { Search } from "./pages/Search";
import { Library } from "./pages/Library";
import { Playlist } from "./pages/Playlist";
import { RecentlyPlayed } from "./pages/RecentlyPlayed";
import { LikedSongs } from "./pages/LikedSongs";
import { useAuthStore } from "./store/authStore";
import { useLibraryStore } from "./store/libraryStore";
import { useDiscordStore } from "./store/discordStore";
import { usePlayerStore } from "./store/playerStore";
import { useNetworkStore } from "./store/networkStore";
import { useAudioSettingsStore } from "./store/audioSettingsStore";
import { useSourceStore } from "./store/sourceStore";
import { useLocalLibraryStore } from "./store/localLibraryStore";
import { useThemeStore } from "./store/themeStore";
import { useAccountStore } from "./store/accountStore";

const routes = [
  { path: "/", element: <Home /> },
  { path: "/search", element: <Search /> },
  { path: "/library", element: <Library /> },
  { path: "/recently-played", element: <RecentlyPlayed /> },
  { path: "/liked", element: <LikedSongs /> },
  { path: "/playlist/:id", element: <Playlist /> },
];

/** Registers global hotkeys. Inside the router so shortcuts can navigate. */
function GlobalShortcuts() {
  useKeyboardShortcuts();
  return null;
}

/** Lives inside the router so it can read the current location. */
function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <Routes location={location} key={location.pathname}>
        {routes.map(({ path, element }) => (
          <Route key={path} path={path} element={<PageTransition>{element}</PageTransition>} />
        ))}
      </Routes>
    </AnimatePresence>
  );
}

function App() {
  const authState = useAuthStore((s) => s.state);
  const currentTrack = usePlayerStore((s) => s.currentTrack());
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isMini = useMiniPlayerStore((s) => s.active);

  useMediaKeys();

  useEffect(() => {
    useAuthStore.getState().init();
    useDiscordStore.getState().init();
    useNetworkStore.getState().init();
    useAudioSettingsStore.getState().init();
    useSourceStore.getState().init();
    useLocalLibraryStore.getState().init();
  }, []);

  useEffect(() => {
    if (authState === "signed_in") {
      useLibraryStore.getState().fetchAll();
      useAccountStore.getState().fetch();
    } else {
      useLibraryStore.getState().reset();
      useAccountStore.getState().reset();
    }
  }, [authState]);

  useEffect(() => {
    if (!currentTrack) return;
    const state = isPlaying ? currentTrack.artist : `${currentTrack.artist} (Paused)`;
    useDiscordStore.getState().updatePresence(currentTrack.title, state, currentTrack.thumbnail);
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.thumbnail, isPlaying]);

  // Re-tint the UI from the current track's album art.
  useEffect(() => {
    if (!currentTrack) {
      useThemeStore.getState().reset();
      return;
    }
    useThemeStore
      .getState()
      .applyForTrack(`${currentTrack.album}-${currentTrack.title}`, currentTrack.thumbnail);
  }, [currentTrack?.id, currentTrack?.thumbnail]);

  if (isMini) {
    // Mini mode replaces the whole shell; the stores (and therefore playback)
    // keep running untouched underneath.
    return (
      <>
        <MiniPlayer />
        <Toaster />
      </>
    );
  }

  return (
    <HashRouter>
      <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-black text-fg">
        <ResizeHandles />
        <TitleBar />
        <div className="flex min-h-0 flex-1 gap-2 p-2 pb-0">
          <Sidebar />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-base">
            <TopBar />
            <main className="min-h-0 flex-1 overflow-y-auto">
              <AnimatedRoutes />
            </main>
          </div>
        </div>
        <NowPlayingBar />
      </div>
      <QueueDrawer />
      <NowPlayingExpanded />
      <SignInModal />
      <SettingsModal />
      <DeviceConnectModal />
      <PlaylistFormModal />
      <AddToPlaylistModal />
      <IncomingControlRequestModal />
      <ContextMenu />
      <CommandPalette />
      <ShortcutsOverlay />
      <Toaster />
      <GlobalShortcuts />
    </HashRouter>
  );
}

export default App;
