import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useUiStore } from "../store/uiStore";
import { SHORTCUTS } from "../hooks/useKeyboardShortcuts";

export function ShortcutsOverlay() {
  const open = useUiStore((s) => s.isShortcutsOpen);
  const close = () => useUiStore.getState().setShortcutsOpen(false);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
            className="fixed inset-0 z-[65] bg-black/60"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18 }}
            className="fixed left-1/2 top-1/2 z-[65] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface-2 p-6 shadow-2xl"
          >
            <button
              onClick={close}
              className="absolute right-4 top-4 text-muted hover:text-fg"
              aria-label="Close"
            >
              <X size={18} />
            </button>

            <h2 className="text-lg font-bold">Keyboard shortcuts</h2>

            <div className="mt-5 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
              {SHORTCUTS.map((s) => (
                <div key={s.label} className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-muted">{s.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {s.keys.map((k) => (
                      <kbd
                        key={k}
                        className="rounded border border-border bg-surface-3 px-1.5 py-0.5 font-sans text-[11px] font-medium text-fg"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
