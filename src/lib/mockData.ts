export type { Track, Collection } from "./types";
import type { Track, Collection } from "./types";

const artists = [
  "Nova Ember",
  "Glass Horizon",
  "Midnight Runner",
  "Paper Static",
  "Coral Drift",
  "Vellum",
  "Echo Valley",
  "Kite Season",
];

const songWords = [
  "Static",
  "Afterglow",
  "Halflight",
  "Tidewater",
  "Payphones",
  "Vertigo",
  "Marigold",
  "Concrete",
  "Wildfire",
  "Cassette",
  "Skyline",
  "Undertow",
  "Paper Moon",
  "Amber",
  "Low Beam",
  "Nightshade",
  "Fever Dream",
  "Overpass",
  "Static Bloom",
  "Windowseat",
  "Gravity",
  "Slow Burn",
  "Neon Rain",
  "Backroads",
];

const albumNames = [
  "Late Bloomer",
  "Departures",
  "Soft Static",
  "The Long Way Round",
  "Field Recordings",
  "Between Stations",
  "Low Tide",
  "Paper Cities",
];

function seededRandom(seed: number) {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

function buildTracks(): Track[] {
  const rand = seededRandom(42);
  const tracks: Track[] = [];
  let trackNum = 0;
  for (const artist of artists) {
    const albumsForArtist = 1 + Math.floor(rand() * 2);
    for (let a = 0; a < albumsForArtist; a++) {
      const album = albumNames[(artists.indexOf(artist) + a) % albumNames.length];
      const trackCount = 5 + Math.floor(rand() * 5);
      for (let t = 0; t < trackCount; t++) {
        trackNum++;
        const title = songWords[Math.floor(rand() * songWords.length)];
        tracks.push({
          id: `t${trackNum}`,
          title: `${title}${rand() > 0.7 ? " (Reprise)" : ""}`,
          artist,
          album,
          duration: 150 + Math.floor(rand() * 120),
        });
      }
    }
  }
  return tracks;
}

export const allTracks: Track[] = buildTracks();

function tracksByAlbum(album: string): string[] {
  return allTracks.filter((t) => t.album === album).map((t) => t.id);
}

export const albums: Collection[] = albumNames.map((name, i) => ({
  id: `album-${i}`,
  title: name,
  subtitle: allTracks.find((t) => t.album === name)?.artist ?? "Various Artists",
  kind: "album",
  trackIds: tracksByAlbum(name),
}));

function pickRandomTrackIds(count: number, seed: number): string[] {
  const rand = seededRandom(seed);
  const ids = new Set<string>();
  while (ids.size < count && ids.size < allTracks.length) {
    ids.add(allTracks[Math.floor(rand() * allTracks.length)].id);
  }
  return Array.from(ids);
}

export const playlists: Collection[] = [
  {
    id: "playlist-quick-picks",
    title: "Quick Picks",
    subtitle: "Made for you",
    kind: "playlist",
    trackIds: pickRandomTrackIds(12, 7),
  },
  {
    id: "playlist-focus",
    title: "Deep Focus",
    subtitle: "Instrumentals & ambient",
    kind: "playlist",
    trackIds: pickRandomTrackIds(10, 13),
  },
  {
    id: "playlist-drive",
    title: "Night Drive",
    subtitle: "Synth & slow burn",
    kind: "playlist",
    trackIds: pickRandomTrackIds(14, 19),
  },
  {
    id: "playlist-throwback",
    title: "On Repeat",
    subtitle: "Your most played",
    kind: "playlist",
    trackIds: pickRandomTrackIds(9, 23),
  },
  {
    id: "playlist-chill",
    title: "Rainy Day",
    subtitle: "Slow and soft",
    kind: "playlist",
    trackIds: pickRandomTrackIds(11, 29),
  },
];

export const allCollections: Collection[] = [...playlists, ...albums];

export function getCollection(id: string): Collection | undefined {
  return allCollections.find((c) => c.id === id);
}

export function getTrack(id: string): Track | undefined {
  return allTracks.find((t) => t.id === id);
}

export function tracksFor(collection: Collection): Track[] {
  return collection.trackIds.map(getTrack).filter((t): t is Track => Boolean(t));
}

export const recentlyPlayed: Track[] = pickRandomTrackIds(20, 101)
  .map(getTrack)
  .filter((t): t is Track => Boolean(t));

export const madeForYou: Collection[] = [
  {
    id: "playlist-discover",
    title: "Discover Mix",
    subtitle: "Fresh finds based on your taste",
    kind: "playlist",
    trackIds: pickRandomTrackIds(10, 31),
  },
  {
    id: "playlist-artist-radio",
    title: `${artists[0]} Radio`,
    subtitle: "Similar artists and more",
    kind: "playlist",
    trackIds: pickRandomTrackIds(10, 37),
  },
  {
    id: "playlist-supermix",
    title: "Your Supermix",
    subtitle: "A blend of your favorites",
    kind: "playlist",
    trackIds: pickRandomTrackIds(10, 41),
  },
];
