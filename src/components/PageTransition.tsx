import type { ReactNode } from "react";
import { motion } from "framer-motion";

/**
 * Wraps a route's content so navigations fade/rise instead of snapping.
 * Paired with `AnimatePresence mode="wait"` keyed on the pathname in App.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
