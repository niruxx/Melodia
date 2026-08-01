import { motion } from "framer-motion";
import { Play, Shuffle } from "lucide-react";

type PlayControlsProps = {
  onPlay: () => void;
  onShuffle: () => void;
};

/**
 * The primary play + shuffle pair used at the top of every collection page
 * (Playlist, Liked Songs, Recently Played). Shared so the three pages can't
 * drift apart, and so the play button picks up the adaptive album-art accent
 * the same way the card hover-play button does.
 */
export function PlayControls({ onPlay, onShuffle }: PlayControlsProps) {
  return (
    <div className="flex items-center gap-4">
      <motion.button
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        onClick={onPlay}
        className="flex h-12 w-12 items-center justify-center rounded-full text-black shadow-lg shadow-black/40"
        style={{ backgroundColor: "var(--accent-dynamic-1)" }}
        aria-label="Play"
      >
        <Play size={20} fill="currentColor" className="ml-0.5" />
      </motion.button>
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={onShuffle}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-muted transition-colors hover:bg-surface-3 hover:text-fg"
        aria-label="Shuffle play"
      >
        <Shuffle size={18} />
      </motion.button>
    </div>
  );
}
