import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, ChevronDown, Loader2, Pin, ThumbsUp, X } from "lucide-react";
import clsx from "clsx";
import { usePlayerStore } from "../store/playerStore";
import { useCommentsStore, type Comment, type CommentSort } from "../store/commentsStore";

const SORTS: { id: CommentSort; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "new", label: "Newest" },
];

function formatLikes(count: number | null): string | null {
  if (!count) return null;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export function CommentsDrawer() {
  const isOpen = useCommentsStore((s) => s.isOpen);
  const setOpen = useCommentsStore((s) => s.setOpen);
  const sort = useCommentsStore((s) => s.sort);
  const setSort = useCommentsStore((s) => s.setSort);
  const loadingKey = useCommentsStore((s) => s.loadingKey);
  const error = useCommentsStore((s) => s.error);
  const load = useCommentsStore((s) => s.load);
  const loadMore = useCommentsStore((s) => s.loadMore);
  const cache = useCommentsStore((s) => s.cache);

  const track = usePlayerStore((s) => s.currentTrack());
  // Local files have no YouTube video behind them to comment on.
  const videoId = track && !track.id.startsWith("local:") ? track.id : undefined;
  const entry = videoId ? cache[`${videoId}:${sort}`] : undefined;
  const loading = loadingKey !== null;

  useEffect(() => {
    if (isOpen && videoId) void load(videoId);
  }, [isOpen, videoId, sort, load]);

  const { topLevel, repliesByParent } = useMemo(() => {
    const all = entry?.comments ?? [];
    const replies = new Map<string, Comment[]>();
    for (const c of all) {
      if (c.parent === "root") continue;
      const list = replies.get(c.parent) ?? [];
      list.push(c);
      replies.set(c.parent, list);
    }
    return { topLevel: all.filter((c) => c.parent === "root"), repliesByParent: replies };
  }, [entry]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-black/30"
          />
          <motion.aside
            initial={{ x: 384, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 384, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed right-0 top-0 z-50 flex h-full w-96 flex-col border-l border-border bg-surface"
          >
            <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
                Comments
              </h3>
              <button
                onClick={() => setOpen(false)}
                className="text-muted transition-colors hover:text-fg"
                aria-label="Close comments"
              >
                <X size={18} />
              </button>
            </div>

            {track && (
              <div className="shrink-0 truncate px-4 pb-2 text-xs text-muted">{track.title}</div>
            )}

            <div className="flex shrink-0 gap-2 px-4 pb-3">
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSort(s.id)}
                  className={clsx(
                    "pill px-3 py-1 text-xs font-semibold transition-colors",
                    sort === s.id
                      ? "bg-fg text-black"
                      : "bg-surface-2 text-fg hover:bg-surface-3",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
              {!videoId && (
                <p className="pt-8 text-center text-sm text-muted">
                  {track
                    ? "Local files don't have YouTube comments."
                    : "Play something to see its comments."}
                </p>
              )}

              {videoId && loading && !entry && (
                <div className="flex flex-col items-center gap-3 pt-10 text-sm text-muted">
                  <Loader2 size={22} className="animate-spin text-accent" />
                  Loading comments…
                </div>
              )}

              {videoId && error && !loading && (
                <p className="pt-8 text-center text-sm text-red-400">{error}</p>
              )}

              {entry?.disabled && (
                <p className="pt-8 text-center text-sm text-muted">
                  Comments are turned off for this track.
                </p>
              )}

              {entry && !entry.disabled && topLevel.length === 0 && !loading && (
                <p className="pt-8 text-center text-sm text-muted">No comments yet.</p>
              )}

              {topLevel.map((comment, i) => (
                <CommentRow
                  key={comment.id ?? i}
                  comment={comment}
                  replies={comment.id ? repliesByParent.get(comment.id) ?? [] : []}
                />
              ))}

              {entry?.reachedLimit && videoId && (
                <button
                  onClick={() => void loadMore(videoId)}
                  disabled={loading}
                  className="mx-auto mt-1 flex items-center gap-2 rounded-full bg-surface-2 px-4 py-2 text-xs font-semibold text-fg transition-colors hover:bg-surface-3 disabled:opacity-50"
                >
                  {loading && <Loader2 size={13} className="animate-spin" />}
                  Load more
                </button>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function CommentRow({ comment, replies }: { comment: Comment; replies: Comment[] }) {
  const [showReplies, setShowReplies] = useState(false);
  const likes = formatLikes(comment.likeCount);

  return (
    <div className="flex gap-3">
      <Avatar comment={comment} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={clsx(
              "truncate text-xs font-semibold",
              comment.authorIsUploader ? "text-accent" : "text-fg",
            )}
          >
            {comment.author ?? "Unknown"}
          </span>
          {comment.authorIsVerified && (
            <BadgeCheck size={12} className="shrink-0 text-muted" aria-label="Verified" />
          )}
          {comment.isPinned && (
            <Pin size={11} className="shrink-0 text-muted" aria-label="Pinned" />
          )}
          {comment.timeText && (
            <span className="shrink-0 text-[11px] text-muted">{comment.timeText}</span>
          )}
        </div>

        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-fg/90">{comment.text}</p>

        {likes && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-muted">
            <ThumbsUp size={11} />
            {likes}
          </div>
        )}

        {replies.length > 0 && (
          <>
            <button
              onClick={() => setShowReplies((v) => !v)}
              className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline"
            >
              <ChevronDown
                size={12}
                className={clsx("transition-transform", showReplies && "rotate-180")}
              />
              {replies.length} {replies.length === 1 ? "reply" : "replies"}
            </button>
            {showReplies && (
              <div className="mt-2 flex flex-col gap-3 border-l border-border pl-3">
                {replies.map((reply, i) => (
                  <CommentRow key={reply.id ?? i} comment={reply} replies={[]} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Avatar({ comment }: { comment: Comment }) {
  const [failed, setFailed] = useState(false);
  const initial = (comment.author ?? "?").replace(/^@/, "").charAt(0).toUpperCase();

  if (!comment.authorThumbnail || failed) {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-muted">
        {initial}
      </div>
    );
  }
  return (
    <img
      src={comment.authorThumbnail}
      alt=""
      onError={() => setFailed(true)}
      className="h-8 w-8 shrink-0 rounded-full object-cover"
    />
  );
}
