import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import { useContextMenuStore } from "../store/contextMenuStore";

const MARGIN = 8;

export function ContextMenu() {
  const open = useContextMenuStore((s) => s.open);
  const x = useContextMenuStore((s) => s.x);
  const y = useContextMenuStore((s) => s.y);
  const items = useContextMenuStore((s) => s.items);
  const close = useContextMenuStore((s) => s.close);

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Flip the menu back inside the viewport if opening at the cursor would
  // overflow the right/bottom edge. Layout effect so it never paints offscreen.
  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN)),
      y: Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN)),
    });
  }, [open, x, y, items]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    // Capture phase so a scroll inside any container still dismisses.
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open, close]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
          style={{ left: pos.x, top: pos.y, transformOrigin: "top left" }}
          className="fixed z-[70] min-w-[13rem] overflow-hidden rounded-lg border border-border bg-surface-2/95 p-1 shadow-2xl shadow-black/60 backdrop-blur"
        >
          {items.map((item, i) =>
            item.kind === "separator" ? (
              <div key={i} className="my-1 h-px bg-border" />
            ) : (
              <button
                key={i}
                onClick={() => {
                  item.onSelect();
                  close();
                }}
                className={clsx(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                  item.danger
                    ? "text-red-400 hover:bg-red-500/15"
                    : "text-fg hover:bg-surface-3",
                )}
              >
                {item.icon && <item.icon size={15} className="shrink-0 text-muted" />}
                <span className="truncate">{item.label}</span>
              </button>
            ),
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
