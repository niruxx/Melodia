import { Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CoverArt } from "./CoverArt";
import { usePlayerStore } from "../store/playerStore";
import { tracksFor, type Collection } from "../lib/mockData";

type CardProps = {
  collection: Collection;
  /** Resolve tracks to play instantly from the card's hover play button.
   * Falls back to local mock-data lookup when omitted. */
  onPlay?: () => void;
};

export function Card({ collection, onPlay }: CardProps) {
  const navigate = useNavigate();
  const playTrack = usePlayerStore((s) => s.playTrack);

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
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/playlist/${collection.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") navigate(`/playlist/${collection.id}`);
      }}
      className="group w-40 shrink-0 cursor-pointer rounded-md bg-surface p-4 text-left shadow-md transition-colors duration-200 hover:bg-surface-2 sm:w-44"
    >
      <div className="relative">
        <CoverArt
          seed={collection.id}
          src={collection.thumbnail}
          rounded="md"
          className="aspect-square w-full shadow-lg shadow-black/50"
        />
        <button
          onClick={handlePlay}
          className="absolute bottom-2 right-2 flex h-11 w-11 translate-y-2 items-center justify-center rounded-full bg-accent text-black opacity-0 shadow-lg shadow-black/40 transition-all duration-200 hover:scale-105 hover:bg-accent group-hover:translate-y-0 group-hover:opacity-100"
          aria-label={`Play ${collection.title}`}
        >
          <Play size={18} fill="currentColor" />
        </button>
      </div>
      <div className="mt-4 truncate text-sm font-semibold text-fg">{collection.title}</div>
      <div className="mt-1 truncate text-xs text-muted">{collection.subtitle}</div>
    </div>
  );
}
