import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Monitor, X } from "lucide-react";
import { useNetworkStore } from "../store/networkStore";

export function DeviceConnectModal() {
  const open = useNetworkStore((s) => s.isDeviceModalOpen);
  const onClose = useNetworkStore((s) => s.closeDeviceModal);
  const peers = useNetworkStore((s) => s.peers);
  const role = useNetworkStore((s) => s.role);
  const connectedPeerName = useNetworkStore((s) => s.connectedPeerName);
  const connecting = useNetworkStore((s) => s.connecting);
  const error = useNetworkStore((s) => s.error);
  const connect = useNetworkStore((s) => s.connect);
  const disconnect = useNetworkStore((s) => s.disconnect);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/60"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18 }}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface-2 p-6 shadow-2xl"
          >
            <button
              onClick={onClose}
              className="absolute right-4 top-4 text-muted hover:text-fg"
              aria-label="Close"
            >
              <X size={18} />
            </button>

            <h2 className="text-lg font-bold">Connect to a device</h2>
            <p className="mt-1 text-sm text-muted">
              Play from other devices on your network running Melodia.
            </p>

            {role === "controller" && connectedPeerName ? (
              <div className="mt-6 flex items-center justify-between rounded-lg bg-surface-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Monitor size={18} className="text-accent" />
                  <div className="text-sm font-medium">Playing on {connectedPeerName}</div>
                </div>
                <button
                  onClick={() => disconnect()}
                  className="rounded-full bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-black"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="mt-6 flex flex-col gap-2">
                {peers.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted">
                    Looking for devices on your network...
                  </p>
                )}
                {peers.map((peer) => (
                  <div
                    key={peer.id}
                    className="flex items-center justify-between rounded-lg bg-surface-3 px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <Monitor size={18} className="text-muted" />
                      <div className="text-sm font-medium">{peer.name}</div>
                    </div>
                    <button
                      onClick={() => connect(peer)}
                      disabled={connecting}
                      className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-black transition-transform hover:scale-105 disabled:opacity-50"
                    >
                      {connecting ? <Loader2 size={14} className="animate-spin" /> : "Connect"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
