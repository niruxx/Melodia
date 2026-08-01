import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";

type CarouselProps = {
  title: string;
  children: ReactNode;
};

const railVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};

export function Carousel({ title, children }: CarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const updateEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setAtStart(el.scrollLeft <= 1);
    // Treat a rail that doesn't overflow as "at both ends" so both arrows
    // disable rather than teasing a scroll that can't happen.
    setAtEnd(el.scrollLeft >= maxScroll - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateEdges();
    el.addEventListener("scroll", updateEdges, { passive: true });
    const observer = new ResizeObserver(updateEdges);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", updateEdges);
      observer.disconnect();
    };
  }, [updateEdges, children]);

  function scrollBy(amount: number) {
    scrollRef.current?.scrollBy({ left: amount, behavior: "smooth" });
  }

  const arrowClass =
    "flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-muted transition-all hover:bg-surface-3 hover:text-fg disabled:pointer-events-none disabled:opacity-30";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <div className="flex gap-1">
          <button
            onClick={() => scrollBy(-400)}
            disabled={atStart}
            className={arrowClass}
            aria-label="Scroll left"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => scrollBy(400)}
            disabled={atEnd}
            className={arrowClass}
            aria-label="Scroll right"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="relative">
        <motion.div
          ref={scrollRef}
          variants={railVariants}
          initial="hidden"
          animate="show"
          className="no-scrollbar flex gap-4 overflow-x-auto pb-1"
        >
          {children}
        </motion.div>
        {/* Edge fades hint that there's more content past the cut. */}
        <div
          className={clsx(
            "pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-base to-transparent transition-opacity",
            atStart && "opacity-0",
          )}
        />
        <div
          className={clsx(
            "pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-base to-transparent transition-opacity",
            atEnd && "opacity-0",
          )}
        />
      </div>
    </section>
  );
}
