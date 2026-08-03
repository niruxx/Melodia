import { useEffect, useRef } from "react";
import { HashRouter, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import clsx from "clsx";
import { TitleBar } from "./components/TitleBar";
import { ResizeHandles } from "./components/ResizeHandles";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { NowPlayingBar } from "./components/NowPlayingBar";
import { NowPlayingExpanded } from "./components/NowPlayingExpanded";
import { QueueDrawer } from "./components/QueueDrawer";
import { CommentsDrawer } from "./components/CommentsDrawer";
import { SignInModal } from "./components/SignInModal";
import { SettingsModal } from "./components/SettingsModal";
import { DeviceConnectModal } from "./components/DeviceConnectModal";
import { SetupWizard } from "./components/SetupWizard";
import { UpdateBanner, UpdateNotes } from "./components/UpdateBanner";
import { StreamAuthWarning } from "./components/StreamAuthWarning";
import { Wallpaper } from "./components/Wallpaper";
import { useWallpaperStore } from "./store/wallpaperStore";
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
import { useVisualizerStore } from "./store/visualizerStore";
import { useSetupStore } from "./store/setupStore";
import { usePythonStore } from "./store/pythonStore";
import { useUpdateStore } from "./store/updateStore";
import { useStreamAuthStore } from "./store/streamAuthStore";
import { useVideoStore } from "./store/videoStore";
import { useUiThemeStore } from "./store/uiThemeStore";
import { migrateLegacyStorage } from "./lib/storageMigration";
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
  const wallpaper = useWallpaperStore((s) => s.enabled);
  /** One Python probe per session, at most. */
  const pythonChecked = useRef(false);

  useMediaKeys();

  // Applied before anything else paints so the window doesn't flash the
  // default palette on the way to the saved one. The storage migration has to
  // come first of all — every `init()` below reads keys it may have moved.
  useEffect(() => {
    migrateLegacyStorage();
    useUiThemeStore.getState().init();
    useWallpaperStore.getState().init();
  }, []);

  useEffect(() => {
    useAuthStore.getState().init();
    useDiscordStore.getState().init();
    useNetworkStore.getState().init();
    useAudioSettingsStore.getState().init();
    useSourceStore.getState().init();
    useLocalLibraryStore.getState().init();
    useVisualizerStore.getState().init();
    useSetupStore.getState().init();
    useVideoStore.getState().init();
    // Once per launch, and only if the user hasn't turned it off.
    useUpdateStore.getState().init();
  }, []);

  // An upgrade can change what the helper needs, and an import that still
  // succeeds says nothing about whether the *versions* in requirements.txt are
  // satisfied. Letting pip settle that is the only reliable answer, so it runs
  // on the first launch after the version changes — visibly, in the setup step.
  useEffect(() => {
    void usePythonStore.getState().verifyAfterUpgrade();
  }, []);

  // A machine whose Python helper can't run gets the setup step that fixes it,
  // however long ago the guide was completed. Without this the only symptom is
  // signing in failing, which says nothing about the cause.
  //
  // Deferred until the session is known, and skipped entirely for a signed-in
  // one: that answer came from the helper, so it is already working, and the
  // probe costs an interpreter launch of its own.
  useEffect(() => {
    if (pythonChecked.current || authState === "checking" || authState === "signed_in") return;
    pythonChecked.current = true;
    void usePythonStore
      .getState()
      .check()
      .then((status) => {
        if (status && !status.ready) useSetupStore.getState().requireStep("python");
      });
  }, [authState]);

  useEffect(() => {
    // Re-read rather than init once: whether yt-dlp *can* borrow the session
    // depends on there being a cookie sign-in, which this is the change to.
    void useStreamAuthStore.getState().init();
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
      {/* `isolate` keeps the wallpaper's negative z-index inside this shell:
          it then paints above the shell's own background but below everything
          in it, which is exactly where a wallpaper belongs. */}
      <div className="relative isolate flex h-screen w-screen flex-col overflow-hidden bg-black text-fg">
        <Wallpaper />
        <ResizeHandles />
        <TitleBar />
        <div className="flex min-h-0 flex-1 gap-2 p-2 pb-0">
          <Sidebar />
          <div
            className={clsx(
              "app-backdrop flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/60",
              wallpaper && "app-backdrop--sheer",
            )}
          >
            <TopBar />
            <UpdateBanner />
            {/* `relative` lifts the routed content above the backdrop's
                ::before scrim, which would otherwise sit over it. */}
            <main className="relative min-h-0 flex-1 overflow-y-auto">
              <AnimatedRoutes />
            </main>
          </div>
        </div>
        <NowPlayingBar />
      </div>
      <QueueDrawer />
      <CommentsDrawer />
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
      <SetupWizard />
      <UpdateNotes />
      <StreamAuthWarning />
      <Toaster />
      <GlobalShortcuts />
    </HashRouter>
  );
}

export default App;
