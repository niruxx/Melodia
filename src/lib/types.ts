export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  thumbnail?: string;
};

export type Collection = {
  id: string;
  title: string;
  subtitle: string;
  kind: "playlist" | "album";
  trackIds: string[];
  thumbnail?: string;
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
