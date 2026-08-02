import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type Comment = {
  id: string | null;
  /** "root" for top-level entries; otherwise the parent comment's id. */
  parent: string;
  author: string | null;
  authorThumbnail: string | null;
  authorIsUploader: boolean;
  authorIsVerified: boolean;
  text: string;
  likeCount: number | null;
  timeText: string | null;
  isPinned: boolean;
};

export type CommentSort = "top" | "new";

type RawResult = {
  comments: Comment[];
  disabled: boolean;
  fetched: number;
  reachedLimit: boolean;
};

export type CommentsEntry = {
  comments: Comment[];
  disabled: boolean;
  /** True when the fetch hit its cap, i.e. there are probably more. */
  reachedLimit: boolean;
  limit: number;
};

const INITIAL_LIMIT = 50;
const MAX_LIMIT = 300;
const REPLIES_PER_THREAD = 3;

/** Sort changes the result set, so it has to be part of the cache identity. */
function cacheKey(videoId: string, sort: CommentSort) {
  return `${videoId}:${sort}`;
}

type CommentsStore = {
  isOpen: boolean;
  sort: CommentSort;
  /** videoId:sort currently being fetched, so a stale reply can't overwrite. */
  loadingKey: string | null;
  error: string | null;
  cache: Record<string, CommentsEntry>;

  setOpen: (value: boolean) => void;
  setSort: (sort: CommentSort) => void;
  load: (videoId: string, limit?: number) => Promise<void>;
  loadMore: (videoId: string) => Promise<void>;
  entryFor: (videoId: string | undefined) => CommentsEntry | undefined;
};

export const useCommentsStore = create<CommentsStore>((set, get) => ({
  isOpen: false,
  sort: "top",
  loadingKey: null,
  error: null,
  cache: {},

  setOpen: (value) => set({ isOpen: value }),

  setSort: (sort) => set({ sort, error: null }),

  load: async (videoId, limit = INITIAL_LIMIT) => {
    const { sort, cache } = get();
    const key = cacheKey(videoId, sort);

    const cached = cache[key];
    if (cached && cached.limit >= limit) return;

    set({ loadingKey: key, error: null });
    try {
      const result = await invoke<RawResult>("ytm_get_comments", {
        videoId,
        limit,
        sort,
        repliesPerThread: REPLIES_PER_THREAD,
      });
      // Another track (or sort) was selected while this was in flight.
      if (get().loadingKey !== key) return;
      set((s) => ({
        loadingKey: null,
        cache: {
          ...s.cache,
          [key]: {
            comments: result.comments ?? [],
            disabled: result.disabled,
            reachedLimit: result.reachedLimit,
            limit,
          },
        },
      }));
    } catch (e) {
      if (get().loadingKey !== key) return;
      set({ loadingKey: null, error: String(e) });
    }
  },

  /**
   * yt-dlp exposes no incremental cursor, so "more" means re-requesting with a
   * higher cap and replacing the batch rather than appending to it.
   */
  loadMore: async (videoId) => {
    const { sort, cache } = get();
    const current = cache[cacheKey(videoId, sort)];
    const next = Math.min(MAX_LIMIT, (current?.limit ?? INITIAL_LIMIT) * 2);
    if (current && current.limit >= next) return;
    await get().load(videoId, next);
  },

  entryFor: (videoId) => (videoId ? get().cache[cacheKey(videoId, get().sort)] : undefined),
}));
