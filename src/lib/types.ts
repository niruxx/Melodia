export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  thumbnail?: string;
  /** Per-playlist handle YouTube requires to remove or reorder this entry.
   * Only present on playlists the signed-in account owns. */
  setVideoId?: string;
  /** SoundCloud tracks only — their share link, since (unlike a YouTube
   * videoId) a bare SoundCloud track id can't be turned into a URL on its
   * own. */
  permalinkUrl?: string;

  // Read from local files' tags only; streaming sources don't carry them.
  /** Who the album is credited to, which is what albums are grouped by — a
   * compilation's tracks each have their own `artist`. */
  albumArtist?: string;
  composers?: string[];
  genres?: string[];
  performers?: string[];
  producers?: string[];
  trackNumber?: number;
  discNumber?: number;
  year?: number;
};

export type PlaylistPrivacy = "PUBLIC" | "UNLISTED" | "PRIVATE";

export type Collection = {
  id: string;
  title: string;
  subtitle: string;
  kind: "playlist" | "album";
  trackIds: string[];
  thumbnail?: string;
  /** True only for playlists the signed-in account can edit. */
  owned?: boolean;
  description?: string;
  privacy?: PlaylistPrivacy;
};

/** Commands a controller sends to the device it's remotely controlling. */
export type RemoteCommand =
  | { cmd: "play_track"; track: Track; queue: Track[] }
  | { cmd: "toggle_play" }
  | { cmd: "next" }
  | { cmd: "prev" }
  | { cmd: "jump_to"; index: number }
  | { cmd: "seek"; seconds: number }
  | { cmd: "set_volume"; volume: number }
  | { cmd: "toggle_shuffle" }
  | { cmd: "cycle_repeat" };

/** Playback state a controlled device streams back to its controller. */
export type RemoteState = {
  queue: Track[];
  queueIndex: number;
  isPlaying: boolean;
  progress: number;
  volume: number;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
};
