import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Heart } from "lucide-react";
import clsx from "clsx";

type LikeButtonProps = {
  liked: boolean;
  onToggle: () => void;
  size?: number;
  /** Applied to the button, so each surface keeps its own colour and hover. */
  className?: string;
  /** Stop a row's own click handler firing when the heart is pressed. */
  stopPropagation?: boolean;
};

/**
 * The heart, everywhere it appears.
 *
 * Liking gets a spring that overshoots and a ring that expands out of the
 * icon; unliking gets a small squeeze and nothing else. The asymmetry is the
 * point — adding something to your library is worth a flourish, removing it
 * shouldn't be celebrated.
 *
 * Nothing animates on mount: a list of already-liked songs would otherwise pop
 * every heart on the page each time it rendered. The press counter is what
 * separates "the user did this" from "React drew this".
 */
export function LikeButton({
  liked,
  onToggle,
  size = 16,
  className,
  stopPropagation,
}: LikeButtonProps) {
  const [press, setPress] = useState(0);

  return (
    <motion.button
      whileTap={{ scale: 0.85 }}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        setPress((n) => n + 1);
        onToggle();
      }}
      className={clsx("relative", className)}
      aria-pressed={liked}
      aria-label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
    >
      {/* Remounted on every press, so the entrance runs again rather than
          settling at its end state after the first one. */}
      <motion.span
        key={press}
        initial={press === 0 ? false : liked ? { scale: 0.55 } : { scale: 1.25 }}
        animate={{ scale: 1 }}
        transition={
          liked
            ? { type: "spring", stiffness: 520, damping: 11, mass: 0.5 }
            : { duration: 0.18, ease: "easeOut" }
        }
        className="block"
      >
        <Heart size={size} fill={liked ? "currentColor" : "none"} />
      </motion.span>

      {/* Only on the way in. Sized from the icon so it reads as coming out of
          the heart rather than out of the button's padding. */}
      <AnimatePresence>
        {press > 0 && liked && (
          <motion.span
            key={press}
            aria-hidden
            initial={{ opacity: 0.5, scale: 0.5 }}
            animate={{ opacity: 0, scale: 2.1 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            style={{ width: size, height: size }}
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-current"
          />
        )}
      </AnimatePresence>
    </motion.button>
  );
}
