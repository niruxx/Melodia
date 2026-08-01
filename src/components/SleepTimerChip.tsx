import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Moon, X } from "lucide-react";
import { useAudioSettingsStore } from "../store/audioSettingsStore";

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Live countdown shown only while a sleep timer is running. */
export function SleepTimerChip() {
  const endsAt = useAudioSettingsStore((s) => s.sleepTimerEndsAt);
  const cancel = useAudioSettingsStore((s) => s.cancelSleepTimer);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  if (!endsAt) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted"
      title="Sleep timer"
    >
      <Moon size={12} />
      <span className="tabular-nums">{formatRemaining(endsAt - now)}</span>
      <button onClick={cancel} className="hover:text-fg" aria-label="Cancel sleep timer">
        <X size={12} />
      </button>
    </motion.div>
  );
}
