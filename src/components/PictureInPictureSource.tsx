import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { usePlayerStore } from "../store/playerStore";
import { useVisualizerStore } from "../store/visualizerStore";
import { usePipStore } from "../store/pipStore";
import { toast } from "../store/toastStore";

/** Must match `BAND_COUNT` in `src-tauri/src/analyzer.rs` — same event the
 * in-app Visualizer reads (see `src/components/Visualizer.tsx`). */
const BAND_COUNT = 32;
const SMOOTHING = 0.28;

/** Feed canvas size in device pixels. Never shown on screen — this is only
 * the resolution the floating PiP window renders at. */
const WIDTH = 640;
const HEIGHT = 360;

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}

/**
 * Renders album art + the live spectrum into an offscreen canvas, captures it
 * as a `MediaStream`, and pipes that into a hidden `<video>` — the only kind
 * of element the browser Picture-in-Picture API can float outside the app
 * window. Media Session hooks make the floating window's native play/pause
 * and previous/next-track buttons control real playback.
 *
 * Mounted once near the app root; entirely invisible in the normal window.
 */
export function PictureInPictureSource() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const bandsRef = useRef<number[]>(new Array(BAND_COUNT).fill(0));
  const smoothedRef = useRef<number[]>(new Array(BAND_COUNT).fill(0));
  const artRef = useRef<HTMLImageElement | null>(null);

  const track = usePlayerStore((s) => s.currentTrack());
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const trackRef = useRef(track);
  trackRef.current = track;

  // Spectrum data, same source the in-app Visualizer reads.
  useEffect(() => {
    const unlisten = listen<number[]>("playback:spectrum", (event) => {
      bandsRef.current = event.payload;
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Album art for the background. Loaded with an anonymous CORS request so
  // the canvas stays "origin-clean" — a tainted canvas can't be captured.
  // Falls back to a plain gradient if that fails, rather than breaking PiP.
  useEffect(() => {
    artRef.current = null;
    if (!track?.thumbnail) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      artRef.current = img;
    };
    img.onerror = () => {
      artRef.current = null;
    };
    img.src = track.thumbnail;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [track?.thumbnail]);

  // Draw loop + capture + PiP wiring, set up once.
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const supported =
      typeof document.pictureInPictureEnabled !== "undefined" &&
      document.pictureInPictureEnabled &&
      typeof canvas.captureStream === "function";
    usePipStore.getState().setSupported(supported);
    if (!supported) return;

    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    const draw = () => {
      ctx.clearRect(0, 0, WIDTH, HEIGHT);

      const art = artRef.current;
      if (art) {
        const scale = Math.max(WIDTH / art.width, HEIGHT / art.height);
        const dw = art.width * scale;
        const dh = art.height * scale;
        ctx.drawImage(art, (WIDTH - dw) / 2, (HEIGHT - dh) / 2, dw, dh);
      } else {
        const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
        bg.addColorStop(0, "#18181b");
        bg.addColorStop(1, "#000000");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      }

      // Dim + bottom scrim so text and bars stay legible over any artwork.
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      const scrim = ctx.createLinearGradient(0, HEIGHT * 0.45, 0, HEIGHT);
      scrim.addColorStop(0, "rgba(0,0,0,0)");
      scrim.addColorStop(1, "rgba(0,0,0,0.8)");
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      // Spectrum bars, bottom third of the frame.
      const themed = useVisualizerStore.getState().activeColors();
      const c1 = themed?.[0] ?? "#7c5cff";
      const c2 = themed?.[1] ?? "#ec4899";
      const gradient = ctx.createLinearGradient(0, HEIGHT, 0, HEIGHT * 0.55);
      gradient.addColorStop(0, c1);
      gradient.addColorStop(1, c2);
      ctx.fillStyle = gradient;

      const bands = bandsRef.current;
      const smoothed = smoothedRef.current;
      const barsHeight = HEIGHT * 0.32;
      const gap = 3;
      const barWidth = Math.max(1, (WIDTH - gap * (bands.length - 1)) / bands.length);
      for (let i = 0; i < bands.length; i++) {
        const target = Math.max(0.02, bands[i] ?? 0);
        smoothed[i] = smoothed[i] + (target - smoothed[i]) * SMOOTHING;
        const barHeight = smoothed[i] * barsHeight;
        const x = i * (barWidth + gap);
        ctx.beginPath();
        ctx.roundRect(x, HEIGHT - barHeight, barWidth, barHeight, [2, 2, 0, 0]);
        ctx.fill();
      }

      // Track title / artist.
      const current = trackRef.current;
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#ffffff";
      ctx.font = "600 28px Inter, sans-serif";
      ctx.fillText(ellipsize(ctx, current?.title ?? "Melodia", WIDTH - 48), 24, HEIGHT - 66);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = "400 19px Inter, sans-serif";
      ctx.fillText(ellipsize(ctx, current?.artist ?? "Nothing playing", WIDTH - 48), 24, HEIGHT - 38);

      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    let stream: MediaStream | null = null;
    try {
      stream = canvas.captureStream(30);
      video.srcObject = stream;
      video.muted = true;
      void video.play().catch(() => {});
    } catch {
      usePipStore.getState().setSupported(false);
    }

    const requestToggle = async () => {
      try {
        if (document.pictureInPictureElement === video) {
          await document.exitPictureInPicture();
        } else {
          await video.requestPictureInPicture();
        }
      } catch (e) {
        toast.error(`Couldn't open picture-in-picture: ${e}`);
      }
    };
    usePipStore.getState().setRequestToggle(requestToggle);

    const onEnter = () => usePipStore.getState().setActive(true);
    const onLeave = () => usePipStore.getState().setActive(false);
    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);

    // The floating window's native play/pause button calls video.play()/
    // pause() directly; forward that into real playback rather than just
    // freezing the visual feed while audio keeps going.
    const onVideoPlay = () => {
      if (!usePlayerStore.getState().isPlaying) usePlayerStore.getState().togglePlay();
    };
    const onVideoPause = () => {
      if (usePlayerStore.getState().isPlaying) usePlayerStore.getState().togglePlay();
    };
    video.addEventListener("play", onVideoPlay);
    video.addEventListener("pause", onVideoPause);

    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
      video.removeEventListener("play", onVideoPlay);
      video.removeEventListener("pause", onVideoPause);
      usePipStore.getState().setRequestToggle(null);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Keep the hidden video's paused state (and therefore what the floating
  // window's play/pause button shows) in sync with real playback.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying && video.paused) void video.play().catch(() => {});
    else if (!isPlaying && !video.paused) video.pause();
  }, [isPlaying]);

  // Media Session metadata — also what lets the floating window show
  // previous/next-track buttons, not just generic play/pause.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = track
      ? new MediaMetadata({
          title: track.title,
          artist: track.artist,
          album: track.album,
          artwork: track.thumbnail ? [{ src: track.thumbnail, sizes: "512x512" }] : [],
        })
      : null;
  }, [track?.id, track?.title, track?.artist, track?.album, track?.thumbnail]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const { togglePlay, next, prev, seek } = usePlayerStore.getState();
    navigator.mediaSession.setActionHandler("play", () => togglePlay());
    navigator.mediaSession.setActionHandler("pause", () => togglePlay());
    navigator.mediaSession.setActionHandler("previoustrack", () => prev());
    navigator.mediaSession.setActionHandler("nexttrack", () => next());
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") seek(details.seekTime);
    });
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
      navigator.mediaSession.setActionHandler("seekto", null);
    };
  }, []);

  return (
    <div aria-hidden style={{ position: "fixed", left: -9999, top: -9999, width: 1, height: 1, overflow: "hidden" }}>
      <canvas ref={canvasRef} />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} muted playsInline />
    </div>
  );
}
