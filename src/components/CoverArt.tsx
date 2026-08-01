import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Music2 } from "lucide-react";
import { hashSeed } from "../lib/format";
import clsx from "clsx";

type CoverArtProps = {
  seed: string;
  src?: string;
  className?: string;
  rounded?: "md" | "lg" | "full";
  /** Opt into a Framer Motion shared-element transition between mount points. */
  layoutId?: string;
};

export function coverGradient(seed: string): string {
  const hash = hashSeed(seed);
  const hueA = hash % 360;
  const hueB = (hueA + 55 + (hash % 40)) % 360;
  return `linear-gradient(135deg, hsl(${hueA} 70% 42%), hsl(${hueB} 65% 30%))`;
}

export function CoverArt({ seed, src, className, rounded = "md", layoutId }: CoverArtProps) {
  const radius =
    rounded === "full" ? "rounded-full" : rounded === "lg" ? "rounded-xl" : "rounded-md";

  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // A new src is a new image: go back to "not yet loaded" so the fade replays
  // and a previously-failed URL doesn't keep the fallback pinned on.
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  const showImage = src && !failed;

  return (
    <motion.div
      layoutId={layoutId}
      className={clsx(
        "relative flex shrink-0 items-center justify-center overflow-hidden shadow-lg shadow-black/30",
        radius,
        className,
      )}
      // Always paint the procedural gradient underneath so there's never a
      // flash of empty box while the real artwork decodes, and so a broken
      // URL degrades to something reasonable instead of a broken-image icon.
      style={{ backgroundImage: coverGradient(seed) }}
    >
      {!showImage && <Music2 className="h-[35%] w-[35%] text-white/25" strokeWidth={1.5} />}
      {showImage && (
        <img
          src={src}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={clsx(
            "h-full w-full object-cover transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </motion.div>
  );
}
