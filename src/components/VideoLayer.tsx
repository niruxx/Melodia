import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import clsx from "clsx";
import { usePlayerStore } from "../store/playerStore";
import { useVideoStore } from "../store/videoStore";

/** Beyond this the video is nudged by seeking; below it, left alone. */
const SYNC_TOLERANCE_SECONDS = 0.35;

/**
 * A muted music video layered over the now-playing view.
 *
 * The Rust engine stays the single source of audio *and* of time — this
 * element only ever follows it. That's what keeps the equalizer, visualiser,
 * fades and output-device routing working; letting the webview play the muxed
 * stream instead would bypass all of them (and cap out at 360p).
 */
export function VideoLayer({ className }: { className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const source = useVideoStore((s) => s.source);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  // Follow play/pause. Position is handled separately so a routine tick can't
  // fight the user's own transport actions.
  useEffect(() => {
    const video = ref.current;
    if (!video || !source) return;
    if (isPlaying) {
      void video.play().catch(() => {
        // Autoplay refusal only matters for audible media; muted playback is
        // allowed, so there's nothing actionable to report here.
      });
    } else {
      video.pause();
    }
  }, [isPlaying, source]);

  // Correct drift against the engine's reported position. Subscribing
  // imperatively keeps ~4 position events/second out of React's render path.
  useEffect(() => {
    return usePlayerStore.subscribe((state, prev) => {
      if (state.progress === prev.progress) return;
      const video = ref.current;
      if (!video || video.readyState < 1) return;
      if (Math.abs(video.currentTime - state.progress) > SYNC_TOLERANCE_SECONDS) {
        video.currentTime = state.progress;
      }
    });
  }, []);

  if (!source) return null;

  return (
    <motion.video
      key={source.url}
      ref={ref}
      src={source.url}
      muted
      playsInline
      // The audio engine decides when the track ends; a video that runs short
      // or long must not restart or freeze the visual.
      loop
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className={clsx("h-full w-full object-cover", className)}
    />
  );
}
