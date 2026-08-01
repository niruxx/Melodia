import clsx from "clsx";

/** A shimmering placeholder block. Shape comes entirely from `className`. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton rounded-md", className)} />;
}

/** Mirrors the layout of `Card` so swapping one for the other doesn't shift the page. */
export function CardSkeleton() {
  return (
    <div className="w-40 shrink-0 rounded-lg bg-surface p-4 sm:w-44">
      <Skeleton className="aspect-square w-full" />
      <Skeleton className="mt-4 h-3.5 w-3/4" />
      <Skeleton className="mt-2 h-3 w-1/2" />
    </div>
  );
}

/** Mirrors `Carousel`: a title plus a rail of cards. */
export function CarouselSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <section className="flex flex-col gap-3">
      <Skeleton className="h-5 w-40" />
      <div className="flex gap-4 overflow-hidden pb-1">
        {Array.from({ length: cards }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </section>
  );
}

/** Mirrors the grid of `TrackRow`. */
export function TrackRowSkeleton({ index }: { index: number }) {
  // Deterministic per-row width variation so the list doesn't look like a
  // stack of identical bars, without re-randomizing on every render.
  const titleWidth = ["w-1/2", "w-2/3", "w-3/5", "w-5/12"][index % 4];
  const artistWidth = ["w-1/4", "w-1/3", "w-2/12"][index % 3];

  return (
    <div className="grid grid-cols-[2rem_1fr_auto] items-center gap-4 rounded-lg px-3 py-2 sm:grid-cols-[2rem_1fr_10rem_auto]">
      <Skeleton className="h-3 w-3 justify-self-center rounded-sm" />
      <div className="flex min-w-0 items-center gap-3">
        <Skeleton className="h-10 w-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <Skeleton className={clsx("h-3.5", titleWidth)} />
          <Skeleton className={clsx("mt-2 h-3", artistWidth)} />
        </div>
      </div>
      <Skeleton className="hidden h-3 w-24 sm:block" />
      <Skeleton className="h-3 w-8 justify-self-end" />
    </div>
  );
}

export function TrackListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: rows }, (_, i) => (
        <TrackRowSkeleton key={i} index={i} />
      ))}
    </div>
  );
}

/** Mirrors the card grids on the Library page. */
export function CardGridSkeleton({ cards = 8 }: { cards?: number }) {
  return (
    <div className="flex flex-wrap gap-4">
      {Array.from({ length: cards }, (_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}
