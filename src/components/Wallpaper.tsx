import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLibraryStore } from "../store/libraryStore";
import { useWallpaperStore } from "../store/wallpaperStore";

/** How long each artwork stays before the next fades in. */
const ROTATE_MS = 60_000;

/** Long enough to read as a drift rather than a slideshow transition. */
const FADE_SECONDS = 1.6;

/**
 * Album artwork from the library, blurred out behind the whole app.
 *
 * Sits at a negative z-index inside the shell's stacking context, so it paints
 * over the shell's own background but under every panel — the panels go
 * translucent while this is on, which is what lets it read as the program's
 * background rather than a picture in a box.
 */
export function Wallpaper() {
  const enabled = useWallpaperStore((s) => s.enabled);
  const trackCache = useLibraryStore((s) => s.trackCache);
  const reduceMotion = useReducedMotion();

  const [index, setIndex] = useState(0);
  /** Artwork that failed to load, so a dead URL isn't returned to. */
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  // Shuffled once per change to the cache, then walked — so every artwork gets
  // a turn before any repeats, rather than the same few coming up by chance.
  const art = useMemo(() => {
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const track of Object.values(trackCache)) {
      if (track.thumbnail && !seen.has(track.thumbnail)) {
        seen.add(track.thumbnail);
        urls.push(track.thumbnail);
      }
    }
    for (let i = urls.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [urls[i], urls[j]] = [urls[j], urls[i]];
    }
    return urls;
  }, [trackCache]);

  const usable = art.filter((url) => !broken[url]);

  useEffect(() => setIndex(0), [art]);

  useEffect(() => {
    if (!enabled || usable.length < 2) return;
    const id = setInterval(() => setIndex((i) => i + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, [enabled, usable.length]);

  if (!enabled || usable.length === 0) return null;
  const current = usable[index % usable.length];

  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
      <AnimatePresence initial={false}>
        <motion.img
          key={current}
          src={current}
          alt=""
          // A URL that 404s is dropped from the rotation rather than left as a
          // blank frame for a minute.
          onError={() => setBroken((b) => ({ ...b, [current]: true }))}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : FADE_SECONDS, ease: "easeInOut" }}
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            // Scaled past the edges because a blur of this radius samples
            // nothing beyond them and would otherwise fade to grey at the
            // frame. Saturation compensates for what the blur washes out.
            filter: "blur(64px) saturate(1.3)",
            transform: "scale(1.25)",
          }}
        />
      </AnimatePresence>
      {/* Everything above this is text over a photograph, so the artwork gets
          pushed well down. Tuned against white sleeves, which are the worst
          case by a distance. */}
      <div className="absolute inset-0 bg-black/70" />
    </div>
  );
}
