import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Card } from "./Card";
import { useLibraryStore } from "../store/libraryStore";
import { usePlayCollection } from "../hooks/usePlayCollection";
import { trackAsCollection } from "../lib/collections";
import type { Track } from "../lib/types";

/** How many songs are on screen at once. */
const SLOT_COUNT = 5;

/** How long a set stays up before the next one fades in. */
const ROTATE_MS = 15_000;

/** Fisher–Yates, on a copy — the store's cache is not ours to reorder. */
function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const railVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

/**
 * A shelf of songs that changes itself every {@link ROTATE_MS}.
 *
 * The pool is everything the library store has cached — the home feed and
 * listening history both fill it — walked in a shuffled order rather than
 * sampled at random, so a rotation never repeats a song until the whole pool
 * has been through.
 */
export function Suggested() {
  const trackCache = useLibraryStore((s) => s.trackCache);
  const playCollection = usePlayCollection();
  const reduceMotion = useReducedMotion();

  const [offset, setOffset] = useState(0);
  // Rotating a card out from under a cursor that was about to click it is the
  // one way this becomes annoying rather than ambient.
  const [paused, setPaused] = useState(false);

  // Shuffled once per change to the cache, not per render — otherwise every
  // unrelated re-render would deal a new hand.
  const pool: Track[] = useMemo(() => shuffled(Object.values(trackCache)), [trackCache]);

  // A pool that grew (history landing after the home feed) invalidates where
  // we were in it.
  useEffect(() => setOffset(0), [pool]);

  // Nothing to rotate through if the pool can't outfill the slots — better a
  // still shelf than one that "changes" to the same five songs.
  const canRotate = pool.length > SLOT_COUNT;

  useEffect(() => {
    if (!canRotate || paused) return;
    const id = setInterval(() => setOffset((o) => (o + SLOT_COUNT) % pool.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [canRotate, paused, pool.length]);

  if (pool.length === 0) return null;

  const shown = Array.from({ length: Math.min(SLOT_COUNT, pool.length) }, (_, i) => {
    return pool[(offset + i) % pool.length];
  });

  return (
    <section
      className="flex flex-col gap-3"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      // Keyboard users get the same reprieve: tabbing into the shelf holds it
      // still until they leave.
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <h2 className="text-lg font-semibold tracking-tight">Suggested</h2>
      <AnimatePresence mode="wait">
        <motion.div
          // Keying on the offset is what makes this a *swap*: the old set
          // exits, then the new one plays its stagger in. The cards animate off
          // their own `cardVariants`, driven by the labels inherited from here
          // — the same arrangement the carousels use.
          key={offset}
          variants={railVariants}
          initial={reduceMotion ? false : "hidden"}
          animate="show"
          exit={reduceMotion ? undefined : "hidden"}
          // Scrolls rather than clips, so a narrow window cuts nothing off:
          // five cards are wider than the panel at its minimum size.
          className="no-scrollbar flex gap-4 overflow-x-auto pb-1"
        >
          {shown.map((track) => {
            const collection = trackAsCollection(track);
            return (
              <Card
                key={collection.id}
                collection={collection}
                onPlay={() => playCollection(collection)}
              />
            );
          })}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
