import type { ReactNode } from "react";
import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

type CarouselProps = {
  title: string;
  children: ReactNode;
};

export function Carousel({ title, children }: CarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollBy(amount: number) {
    scrollRef.current?.scrollBy({ left: amount, behavior: "smooth" });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <div className="flex gap-1">
          <button
            onClick={() => scrollBy(-400)}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-muted hover:text-fg"
            aria-label="Scroll left"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => scrollBy(400)}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-muted hover:text-fg"
            aria-label="Scroll right"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="no-scrollbar flex gap-4 overflow-x-auto pb-1">
        {children}
      </div>
    </section>
  );
}
