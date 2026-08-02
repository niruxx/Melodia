# Capturing screenshots and the demo GIF

The README references these files. Drop them into `docs/` with these exact
names, then uncomment the corresponding block in `README.md` (search for
`Additional captures`).

Capture at a **1280×800** window — the size `tauri.conf.json` opens by
default — so every shot crops consistently. Sign in first: empty states make
for poor screenshots.

## Stills

| File | What to show | How to get there |
|---|---|---|
| `screenshot.png` | Home, full window | Launch signed in. Retake — the current one predates the ambient background and new icon. |
| `now-playing.png` | Fullscreen player | Play something, press <kbd>F</kbd>. Let the visualizer run so the bars aren't flat. |
| `settings.png` | Settings, scrolled to Theme | Gear icon → scroll to the Theme section. |
| `command-palette.png` | Command palette | <kbd>Ctrl</kbd>+<kbd>K</kbd>, type a couple of letters so results show. |
| `themes.png` | Theme picker | Settings → Theme. Pick a non-default palette first so it's obviously themeable. |
| `comments.png` | Comments panel | Play a track, click the speech-bubble icon in the player bar. Wait for load. |

Optional extras, if you want to widen the gallery later — add matching rows to
the README yourself:

| File | What to show | How to get there |
|---|---|---|
| `setup-wizard.png` | First-run wizard | Settings → "Run the setup guide again", then step to the theme page. |
| `mini-player.png` | Mini player | Click the picture-in-picture icon in the player bar. Crop tight to the window. |

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

## Note on the existing images

`screenshot.png`, `now-playing.png`, `settings.png` and `command-palette.png`
are still referenced and still broadly accurate about layout, but they were
taken before the ambient background gradient, the theme system, the real app
icon, and the share/comments controls landed. Worth retaking all four.
