import clsx from "clsx";

/**
 * The little animated "this is the track that's playing" equalizer.
 * Bars are staggered by animation-delay so they ripple rather than pulse
 * in lockstep; `paused` freezes them for the paused-but-current state.
 */
export function PlayingBars({ className, paused = false }: { className?: string; paused?: boolean }) {
  return (
    <span className={clsx("flex h-3.5 items-end gap-[2px]", className)} aria-hidden>
      {[0, 160, 320, 80].map((delay, i) => (
        <span
          key={i}
          className={clsx("eq-bar w-[2px] rounded-full bg-current", i % 2 === 0 ? "h-full" : "h-2/3")}
          style={{
            animationDelay: `${delay}ms`,
            animationPlayState: paused ? "paused" : "running",
          }}
        />
      ))}
    </span>
  );
}
