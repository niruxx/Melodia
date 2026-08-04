import { useState } from "react";
import { motion } from "framer-motion";
import { Shuffle } from "lucide-react";
import clsx from "clsx";

type ShuffleButtonProps = {
  onClick: () => void;
  /** Current shuffle state. Omit for the "shuffle play" action, which starts
   *  something shuffled rather than toggling a mode. */
  active?: boolean;
  size?: number;
  className?: string;
  label?: string;
};

/**
 * The shuffle control, in both the places it means something different.
 *
 * Turning shuffle *on* spins the glyph a full turn; turning it off just
 * settles it back. As with the heart, the animation carries the direction of
 * the change, so you can tell which way it went without reading the colour —
 * which matters here, because the only other signal is a muted-to-accent
 * shift that's easy to miss in peripheral vision.
 *
 * With no `active` prop this is the shuffle-*play* button, which has no state
 * to reflect, so every press spins.
 */
export function ShuffleButton({
  onClick,
  active,
  size = 16,
  className,
  label = "Shuffle",
}: ShuffleButtonProps) {
  const [press, setPress] = useState(0);
  // `active` is the state *before* this press, so a press while inactive is
  // the one turning it on. Undefined means the action button: always a spin.
  const [spinning, setSpinning] = useState(true);

  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={() => {
        setSpinning(active === undefined ? true : !active);
        setPress((n) => n + 1);
        onClick();
      }}
      className={clsx("relative", className)}
      aria-pressed={active}
      aria-label={label}
    >
      <motion.span
        key={press}
        initial={press === 0 ? false : spinning ? { rotate: 0 } : { scale: 0.8 }}
        animate={spinning ? { rotate: 360 } : { scale: 1 }}
        transition={
          spinning
            ? { duration: 0.5, ease: [0.22, 1, 0.36, 1] }
            : { type: "spring", stiffness: 500, damping: 18 }
        }
        className="block"
      >
        <Shuffle size={size} />
      </motion.span>
    </motion.button>
  );
}
