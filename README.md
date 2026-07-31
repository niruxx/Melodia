<div align="center">

# 🎵 TuneBox

**A modern, cross-platform desktop client for YouTube Music.**

Built with 🦀 [Tauri](https://tauri.app), ⚛️ React + TypeScript, and 🎨 Tailwind CSS — inspired by Spotify's layout, styled as its own thing.

![TuneBox screenshot](docs/screenshot.png)

</div>

---

## ✨ Features

- 🖤 **Modern, Spotify-inspired UI** — dark, dense two-panel sidebar, card grids, a full-width Now Playing bar, and a fullscreen "now playing" view
- 🔐 **Real YouTube Music sign-in** — Google OAuth device-code flow (no password entry, no browser redirect dance)
- 📚 **Real library sync** — your actual playlists, albums, home feed, recently played, and search, pulled live from your account
- 💚 **Liked Songs** — a dedicated, always-pinned playlist for anything you heart
- 📝 **Lyrics** — fetched live and shown in the fullscreen player
- 🎮 **Discord Rich Presence** — optionally show what you're listening to on your Discord profile
- 📡 **Connect to a device** — control playback on another device running TuneBox on your local network (Spotify-Connect-style): pick a device, and playback moves there until you disconnect
- 🪟 **Custom titlebar** — no native window chrome; a slim, draggable, themed titlebar with its own window controls
- 🧩 **Cross-platform** — one codebase targets Windows, macOS, and Linux

> ⚠️ **Playback is currently simulated.** Queue, shuffle, repeat, seeking, and progress all work, but no real audio is streamed yet — that's the next big piece (see the Roadmap section below).

---

## 🧱 Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | [Tauri 2](https://tauri.app) (Rust core + native OS webview) |
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS v4 |
| State | Zustand |
| Motion | Framer Motion |
| Icons | lucide-react |
| YouTube Music data | [ytmusicapi](https://github.com/sigma67/ytmusicapi) via a small Python sidecar process |
| Rich Presence | [discord-rich-presence](https://github.com/vionya/discord-rich-presence) (Rust) |
| LAN device discovery | [mdns-sd](https://github.com/keepsimple1/mdns-sd) (Rust) |

---

## 📋 Prerequisites

You'll need all of the following installed to run TuneBox from source:

- 🟢 **[Node.js](https://nodejs.org/)** (v18+) and npm
- 🦀 **[Rust](https://www.rust-lang.org/tools/install)** (via `rustup`)
- 🪟 **Windows only:** [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (the "Desktop development with C++" workload) — required for Rust to link on Windows
- 🐍 **[Python 3](https://www.python.org/)** + pip — powers the YouTube Music sidecar

---

## 🚀 Getting Started

```bash
# 1. Clone the repo
git clone <this-repo-url>
cd TuneBox

# 2. Install frontend dependencies
npm install

# 3. Install the Python sidecar's dependencies
pip install -r sidecar/requirements.txt

# 4. Launch the app in dev mode (hot-reloading)
npm run tauri dev
```

To build a production binary:

```bash
npm run tauri build
```

---

## 🔑 Connecting Your YouTube Music Account

YouTube Music has no official public API, so TuneBox uses the same OAuth device-code flow YouTube's own TV apps use. Google requires every app to bring **its own OAuth client** — there's no shared/default one to piggyback on.

<details>
<summary><strong>📖 One-time setup: create your free Google OAuth client (~2 minutes)</strong></summary>

<br>

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a new project (or reuse one)
2. Under **APIs & Services → OAuth consent screen**, configure it (External + Testing mode is fine for personal use)
3. Under **APIs & Services → Credentials**, click **Create Credentials → OAuth client ID**
4. Choose application type **"TVs and Limited Input devices"**
5. Copy the generated **Client ID** and **Client Secret**

</details>

Then, in TuneBox:

1. Click **Connect YouTube Music** on the Home screen (or the account icon in the top bar)
2. Paste your **Client ID** and **Client Secret**, and hit **Save & Continue**
3. Click **Sign in with Google** — you'll get a short code and a link
4. Open the link, enter the code, and approve access
5. TuneBox picks it up automatically and loads your real playlists, library, and recently played 🎉

---

## 🎮 Discord Rich Presence (optional)

Show your currently playing song on your Discord profile.

<details>
<summary><strong>📖 One-time setup: create a free Discord Application ID (~1 minute)</strong></summary>

<br>

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, name it "TuneBox" (or anything you like)
3. Copy the **Application ID** from the General Information tab

</details>

Then, in TuneBox:

1. Click the ⚙️ **gear icon** in the top bar
2. Paste your **Discord Application ID** and click **Enable**
3. Make sure Discord desktop is running — your presence will update automatically as you play tracks

---

## 📁 Project Structure

```
TuneBox/
├── src/                    # React frontend
│   ├── components/         # UI components (Sidebar, Card, NowPlayingBar, modals, ...)
│   ├── pages/               # Route pages (Home, Search, Library, Playlist, ...)
│   ├── store/               # Zustand stores (player, auth, library, discord)
│   ├── lib/                 # Types + the ytmusicapi/Tauri command wrappers
│   └── hooks/
├── src-tauri/              # Rust backend
│   └── src/
│       ├── lib.rs           # App entry point, command registration
│       ├── commands.rs      # Tauri commands exposed to the frontend
│       ├── sidecar.rs       # Spawns/talks to the Python sidecar over stdio
│       └── discord.rs       # Discord Rich Presence IPC client
└── sidecar/                # Python sidecar
    └── main.py               # stdin/stdout JSON bridge around ytmusicapi
```

---

## 🗺️ Roadmap / Known Limitations

- 🔇 **No real audio playback yet** — the player is fully functional at the UI/state level (queue, shuffle, repeat, seek), but doesn't stream actual audio. Planned: resolve stream URLs and decode/play them natively in Rust.
- 📦 **No packaged installers yet** — `npm run tauri build` produces a binary, but signed installers/auto-update aren't set up.
- 🔑 **Bring-your-own OAuth client** — by design (see above), for reliability and to avoid shared-credential rate limits.
- 🍎 **One titlebar style everywhere** — the custom titlebar uses the same right-aligned controls on Windows, macOS, and Linux rather than native macOS traffic lights.
- 🔓 **LAN device control has no encryption** — beyond the on-device Accept/Decline prompt, there's no auth on the local control connection; fine for a trusted home network, not intended for untrusted networks.

---

## 🙏 Acknowledgements

- [ytmusicapi](https://github.com/sigma67/ytmusicapi) — the unofficial YouTube Music API this project is built on
- [Tauri](https://tauri.app) — the framework making a lightweight, native cross-platform app possible
