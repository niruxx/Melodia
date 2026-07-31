import { AnimatePresence, motion } from "framer-motion";
import { Monitor } from "lucide-react";
import { useNetworkStore } from "../store/networkStore";

export function IncomingControlRequestModal() {
  const incomingRequest = useNetworkStore((s) => s.incomingRequest);
  const respondToRequest = useNetworkStore((s) => s.respondToRequest);

  return (
    <AnimatePresence>
      {incomingRequest && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/60"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18 }}
            className="fixed left-1/2 top-1/2 z-[60] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface-2 p-6 text-center shadow-2xl"
          >
            <div className="brand-mark mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-white">
              <Monitor size={26} />
            </div>
            <h2 className="mt-4 text-lg font-bold">Incoming control request</h2>
            <p className="mt-1 text-sm text-muted">
              <span className="font-semibold text-fg">{incomingRequest.fromName}</span> wants to
              control playback on this device.
            </p>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => respondToRequest(false)}
                className="flex-1 rounded-full bg-surface-3 py-2.5 text-sm font-semibold text-fg hover:bg-surface"
              >
                Decline
              </button>
              <button
                onClick={() => respondToRequest(true)}
                className="flex-1 rounded-full bg-accent py-2.5 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
              >
                Accept
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
