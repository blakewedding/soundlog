// Spotify — supplemental, optional source. Behind a config guard: when
// SPOTIFY_CLIENT_ID/SECRET are absent, none of this runs and the catalog works
// without it. When present, it adds a search source and enriches releases
// (spotifyId + higher-resolution cover art). Client-credentials flow, 24h cache.
import { redis } from "../config/redis.js";
import { env } from "../config/env.js";
import { cached, keyPart } from "./cache.js";
import { mapSpotifyType } from "./catalog/typeMapping.js";
import type { SourceCandidate, ReleaseDetail } from "./sources/types.js";

const TOKEN_KEY = "spotify:token";
const DAY = 60 * 60 * 24;

export function spotifyConfigured(): boolean {
  return Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET);
}

async function getToken(): Promise<string> {
  if (!spotifyConfigured()) throw new Error("Spotify credentials are not configured");
  const cachedToken = await redis.get(TOKEN_KEY);
  if (cachedToken) return cachedToken;

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString("base64"),
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Spotify token request failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  await redis.set(TOKEN_KEY, data.access_token, "EX", data.expires_in - 60);
  return data.access_token;
}

async function spotifyFetch<T>(path: string): Promise<T | null> {
  const token = await getToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

interface SpotifyImage {
  url: string;
  width: number;
  height: number;
}
interface SpotifyAlbum {
  id: string;
  name: string;
  album_type?: string;
  total_tracks?: number;
  release_date?: string;
  artists?: Array<{ id: string; name: string }>;
  images?: SpotifyImage[];
  genres?: string[];
}
interface SpotifySearchResponse {
  albums?: { items: SpotifyAlbum[] };
}

function largestImage(images?: SpotifyImage[]): SpotifyImage | undefined {
  return images?.slice().sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
}

function toCandidate(album: SpotifyAlbum): SourceCandidate {
  return {
    source: "spotify",
    spotifyId: album.id,
    title: album.name,
    artistName: album.artists?.map((a) => a.name).join(", ") || "Unknown Artist",
    artistId: album.artists?.[0]?.id,
    year: album.release_date?.slice(0, 4) || undefined,
    type: mapSpotifyType(album.album_type, album.total_tracks),
    coverUrl: largestImage(album.images)?.url,
  };
}

/** Album search, normalized to candidates. Cached 24h. */
export async function searchSpotify(query: string): Promise<SourceCandidate[]> {
  if (!spotifyConfigured()) return [];
  const key = `spotify:search:${query.toLowerCase()}`;
  const albums = await cached(key, DAY, async () => {
    const data = await spotifyFetch<SpotifySearchResponse>(
      `/search?type=album&limit=20&q=${encodeURIComponent(query)}`
    );
    return data?.albums?.items ?? [];
  });
  return albums.map(toCandidate);
}

/** Full album detail by Spotify id. Cached 24h. */
export async function getSpotifyAlbumDetail(spotifyId: string): Promise<ReleaseDetail | null> {
  if (!spotifyConfigured()) return null;
  const key = `spotify:album:${spotifyId}`;
  const album = await cached(key, DAY, () => spotifyFetch<SpotifyAlbum>(`/albums/${spotifyId}`));
  if (!album) return null;
  const base = toCandidate(album);
  return {
    ...base,
    releaseDate: album.release_date,
    trackCount: album.total_tracks,
    genres: album.genres?.length ? album.genres : undefined,
  };
}

export interface SpotifyMatch {
  spotifyId: string;
  coverUrl?: string;
  coverWidth?: number;
}

/**
 * Find a Spotify album matching an artist + title, for enrichment. Returns the
 * spotifyId and its largest cover (with width, so callers can prefer it over a
 * lower-resolution cover). Best-effort — null when nothing matches or Spotify is
 * unconfigured. Never throws, so it can't break a seed.
 */
export async function findSpotifyMatch(artist: string, title: string): Promise<SpotifyMatch | null> {
  if (!spotifyConfigured()) return null;
  const key = `spotify:match:v2:${keyPart(artist)}:${keyPart(title)}`;
  try {
    return await cached(key, DAY, async () => {
      const data = await spotifyFetch<SpotifySearchResponse>(
        `/search?type=album&limit=1&q=${encodeURIComponent(`${title} ${artist}`)}`
      );
      const album = data?.albums?.items?.[0];
      if (!album) return null;
      const image = largestImage(album.images);
      return { spotifyId: album.id, coverUrl: image?.url, coverWidth: image?.width };
    });
  } catch {
    return null;
  }
}
