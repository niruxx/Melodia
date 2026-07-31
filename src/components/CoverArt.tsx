import { Music2 } from "lucide-react";
import { hashSeed } from "../lib/format";
import clsx from "clsx";

type CoverArtProps = {
  seed: string;
  src?: string;
  className?: string;
  rounded?: "md" | "lg" | "full";
};

export function coverGradient(seed: string): string {
  const hash = hashSeed(seed);
  const hueA = hash % 360;
  const hueB = (hueA + 55 + (hash % 40)) % 360;
  return `linear-gradient(135deg, hsl(${hueA} 70% 42%), hsl(${hueB} 65% 30%))`;
}

export function CoverArt({ seed, src, className, rounded = "md" }: CoverArtProps) {
  const radius =
    rounded === "full" ? "rounded-full" : rounded === "lg" ? "rounded-xl" : "rounded-md";

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={clsx(
          "shrink-0 object-cover shadow-lg shadow-black/30",
          radius,
          className,
        )}
      />
    );
  }

  return (
    <div
      className={clsx(
        "relative flex shrink-0 items-center justify-center overflow-hidden shadow-lg shadow-black/30",
        radius,
        className,
      )}
      style={{ backgroundImage: coverGradient(seed) }}
    >
      <Music2 className="h-[35%] w-[35%] text-white/25" strokeWidth={1.5} />
    </div>
  );
}
