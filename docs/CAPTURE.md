# Capturing screenshots and the demo GIF

The README references these files by exact name. Drop a replacement into
`docs/` with the same name and it appears — no README edit needed. The three
that don't exist yet sit in a commented-out gallery block in the README
(search `Gallery slots`); uncomment it once you've taken them.

Capture at a **1280×800** window — the size `tauri.conf.json` opens by default
— so every shot crops consistently.

**Before you start:**

- Sign in. Empty states make for poor screenshots.
- Play something, so the player bar isn't empty in every shot.
- Pick the palette you want the project to be recognised by and keep it for the
  whole set. Half the value of a gallery is that it looks like one app.
- Turn the album-art wallpaper **off** for the general shots — it changes the
  background every 60 seconds, which makes a consistent set impossible. Turn it
  on only for its own shot, last.

## Stills

Currently referenced by the README:

| File | What to show | How to get there |
|---|---|---|
| `screenshot.png` | Home, full window | Launch signed in. Scroll so the **Suggested** shelf and a couple of feed shelves are visible. This is the hero image — it's worth retaking until it's right. |
| `now-playing.png` | Fullscreen player | Play something, press <kbd>F</kbd>. Let the visualizer run so the bars aren't flat. |
| `settings.png` | Settings, scrolled to Theme | Gear icon → scroll to the Theme section. |
| `command-palette.png` | Command palette | <kbd>Ctrl</kbd>+<kbd>K</kbd>, type a couple of letters so results show. |

Waiting on captures — the README block that uses them is commented out:

| File | What to show | How to get there |
|---|---|---|
| `themes.png` | Theme picker | Settings → Theme. Pick a non-default palette first so it's obviously themeable. |
| `wallpaper.png` | Album-art wallpaper | Settings → Theme → **Use album art as the background**, then close Settings and let a colourful sleeve come up. Frame the sidebar *and* content panel — the point is that the whole window takes the colour. |
| `demo.gif` | See below | |

Optional extras, if you want to widen the gallery — add matching rows to the
README yourself:

| File | What to show | How to get there |
|---|---|---|
| `setup-wizard.png` | First-run wizard | Settings → "Run the setup guide again". The **Set up the music service** step (two green ticks) is the interesting one for 1.0. |
| `update-banner.png` | Update notification | Only appears when a newer release exists. Easiest with a throwaway tag published on GitHub. |
| `mini-player.png` | Mini player | Click the picture-in-picture icon in the player bar. Crop tight to the window. |
| `comments.png` | Comments panel | Play a track, click the speech-bubble icon in the player bar. Wait for load. |

## Demo GIF (`demo.gif`)

Aim for **10–15 seconds, ≤900px wide, under ~5 MB** so GitHub renders it
inline instead of forcing a click-through.

A sequence that covers the app without dragging:

1. Home, scroll a shelf (~2s)
2. Open a playlist, click a track — playback starts (~3s)
3. Press <kbd>F</kbd> for the fullscreen player, visualizer moving (~3s)
4. Settings → Theme, switch palette so the whole UI re-tints (~4s)

Any recorder works — [ScreenToGif](https://www.screentogif.com/) on Windows,
[Kap](https://getkap.co/) on macOS, [Peek](https://github.com/phw/peek) on
Linux. Record at 15–20 fps; higher just inflates the file for no benefit.

If it lands over ~5 MB, cut frame rate before resolution — motion tolerates a
lower frame rate better than the UI tolerates being unreadable.

## State of the current images

All four — `screenshot.png`, `now-playing.png`, `settings.png` and
`command-palette.png` — were retaken against **1.0.0** and are current. They
were captured on a 4K display at 225% scaling (a ~2884×1804 native grab,
downscaled to 1600px wide), which is why they stay sharp at the README's
900px display width.

Two things to know if you retake them:

- **The search prompt rotates.** It cycles through twelve languages every two
  seconds, starting from English at mount, so a capture lands on whichever one
  is up. For the English prompt, capture at a multiple of 24 seconds after
  launch (24.8s works, and the library has loaded by then).
- **The Suggested shelf rotates too**, every 15 seconds — so the hero shot's
  five cards are whatever came up. Nothing to control there, just don't expect
  to reproduce a given set.
