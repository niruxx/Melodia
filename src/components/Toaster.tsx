import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import { useToastStore, type ToastKind } from "../store/toastStore";

const icons = {
  info: Info,
  success: CheckCircle2,
  error: TriangleAlert,
} as const;

const tone: Record<ToastKind, string> = {
  info: "text-fg",
  success: "text-accent",
  error: "text-red-400",
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    // Sits just above the now-playing bar. `pointer-events-none` on the stack
    // keeps toasts from blocking clicks; each toast re-enables them for itself.
    <div className="pointer-events-none fixed bottom-[110px] right-4 z-[60] flex flex-col items-end gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = icons[t.kind];
          return (
            <motion.button
              key={t.id}
              layout
              initial={{ opacity: 0, x: 24, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.96 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              onClick={() => dismiss(t.id)}
              className="pointer-events-auto flex max-w-xs items-center gap-2.5 rounded-lg border border-border bg-surface-2/95 px-3.5 py-2.5 text-left text-sm shadow-xl shadow-black/40 backdrop-blur"
            >
              <Icon size={16} className={clsx("shrink-0", tone[t.kind])} />
              <span className="min-w-0 flex-1">{t.message}</span>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
