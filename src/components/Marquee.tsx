import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

type MarqueeProps = {
  text: string;
  className?: string;
  /** Pixels per second the text travels while scrolling. */
  speed?: number;
};

/**
 * Shows `text` on one line, scrolling it back and forth only when it actually
 * overflows its container. Non-overflowing text renders as a plain truncated
 * span so short titles never move.
 */
export function Marquee({ text, className, speed = 30 }: MarqueeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const inner = textRef.current;
    if (!container || !inner) return;

    const measure = () => {
      // scrollWidth/clientWidth on the container would both clamp; compare the
      // text's own width against the container's visible width instead.
      const diff = inner.scrollWidth - container.clientWidth;
      setOverflow(diff > 1 ? diff : 0);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [text]);

  const duration = overflow > 0 ? Math.max(4, (overflow / speed) * 2) : 0;

  return (
    <div ref={containerRef} className={clsx("group/marquee overflow-hidden", className)}>
      <span
        ref={textRef}
        className={clsx(
          "inline-block whitespace-nowrap",
          overflow > 0 && "group-hover/marquee:animate-[marquee_var(--marquee-duration)_linear_infinite]",
        )}
        style={
          overflow > 0
            ? ({
                "--marquee-shift": `-${overflow}px`,
                "--marquee-duration": `${duration}s`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {text}
      </span>
    </div>
  );
}
