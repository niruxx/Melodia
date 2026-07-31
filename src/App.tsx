import { useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
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
import { IncomingControlRequestModal } from "./components/IncomingControlRequestModal";
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

function App() {
  const authState = useAuthStore((s) => s.state);
  const currentTrack = usePlayerStore((s) => s.currentTrack());
  const isPlaying = usePlayerStore((s) => s.isPlaying);

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
    } else {
      useLibraryStore.getState().reset();
    }
  }, [authState]);

  useEffect(() => {
    if (!currentTrack) return;
    const state = isPlaying ? currentTrack.artist : `${currentTrack.artist} (Paused)`;
    useDiscordStore.getState().updatePresence(currentTrack.title, state, currentTrack.thumbnail);
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.thumbnail, isPlaying]);

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
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/search" element={<Search />} />
                <Route path="/library" element={<Library />} />
                <Route path="/recently-played" element={<RecentlyPlayed />} />
                <Route path="/liked" element={<LikedSongs />} />
                <Route path="/playlist/:id" element={<Playlist />} />
              </Routes>
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
      <IncomingControlRequestModal />
    </HashRouter>
  );
}

export default App;
