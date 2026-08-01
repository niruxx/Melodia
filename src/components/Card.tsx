import { motion } from "framer-motion";
import { Copy, Disc3, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CoverArt } from "./CoverArt";
import { usePlayerStore } from "../store/playerStore";
import { useContextMenuStore } from "../store/contextMenuStore";
import { toast } from "../store/toastStore";
import { tracksFor, type Collection } from "../lib/mockData";

type CardProps = {
  collection: Collection;
  /** Resolve tracks to play instantly from the card's hover play button.
   * Falls back to local mock-data lookup when omitted. */
  onPlay?: () => void;
};

export const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: "easeOut" as const } },
};

export function Card({ collection, onPlay }: CardProps) {
  const navigate = useNavigate();
  const playTrack = usePlayerStore((s) => s.playTrack);
  const openMenu = useContextMenuStore((s) => s.openMenu);

  function handlePlay(e: React.MouseEvent) {
    e.stopPropagation();
    if (onPlay) {
      onPlay();
      return;
    }
    const tracks = tracksFor(collection);
    if (tracks.length > 0) playTrack(tracks[0], tracks);
  }

  return (
    <motion.div
      variants={cardVariants}
      whileHover={{ y: -6 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/playlist/${collection.id}`)}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e.clientX, e.clientY, [
          { label: "Open", icon: Disc3, onSelect: () => navigate(`/playlist/${collection.id}`) },
          { label: "Play", icon: Play, onSelect: () => handlePlay(e) },
          {
            label: "Copy name",
            icon: Copy,
            onSelect: () => {
              navigator.clipboard
                .writeText(collection.title)
                .then(() => toast.info("Copied to clipboard"))
                .catch(() => toast.error("Couldn't copy to clipboard"));
            },
          },
        ]);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") navigate(`/playlist/${collection.id}`);
      }}
      className="group w-40 shrink-0 cursor-pointer rounded-lg bg-surface p-4 text-left shadow-md transition-colors duration-200 hover:bg-surface-2 hover:shadow-xl hover:shadow-black/40 sm:w-44"
    >
      <div className="relative">
        <CoverArt
          seed={collection.id}
          src={collection.thumbnail}
          rounded="md"
          className="aspect-square w-full shadow-lg shadow-black/50"
        />
        <motion.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.94 }}
          onClick={handlePlay}
          className="absolute bottom-2 right-2 flex h-11 w-11 translate-y-2 items-center justify-center rounded-full text-black opacity-0 shadow-lg shadow-black/50 transition-[opacity,transform] duration-200 group-hover:translate-y-0 group-hover:opacity-100"
          style={{ backgroundColor: "var(--accent-dynamic-1)" }}
          aria-label={`Play ${collection.title}`}
        >
          <Play size={18} fill="currentColor" />
        </motion.button>
      </div>
      <div className="mt-4 truncate text-sm font-semibold text-fg">{collection.title}</div>
      <div className="mt-1 truncate text-xs text-muted">{collection.subtitle}</div>
    </motion.div>
  );
}
