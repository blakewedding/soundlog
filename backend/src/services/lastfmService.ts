// Last.fm — enrichment layer: genre/tag data and similar artists, attached to a
// release after it is seeded. Cached in Redis for 7 days.
import { env } from "../config/env.js";
import { cached } from "./cache.js";

const BASE = "https://ws.audioscrobbler.com/2.0/";
const WEEK = 60 * 60 * 24 * 7;

export function lastfmConfigured(): boolean {
  return Boolean(env.LASTFM_API_KEY);
}

/**
 * Fold typographic Unicode to the ASCII forms Last.fm's catalog actually keys
 * on. MusicBrainz favors typographic characters ("Mix‐Up" with U+2010, curly
 * apostrophes, en/em dashes); querying Last.fm with them misses tags that the
 * ASCII spelling finds.
 */
export function normalizeForLastfm(text: string): string {
  return text
    .replace(/[‐‑‒–—―−]/g, "-") // hyphens/dashes/minus
    .replace(/[‘’‚′]/g, "'") // curly single quotes / prime
    .replace(/[“”„″]/g, '"') // curly double quotes
    .replace(/…/g, "...") // ellipsis
    .replace(/ /g, " ") // no-break space
    .normalize("NFKC");
}

async function lastfmFetch<T>(method: string, params: Record<string, string>): Promise<T | null> {
  if (!env.LASTFM_API_KEY) return null;
  const query = new URLSearchParams({
    method,
    api_key: env.LASTFM_API_KEY,
    format: "json",
    ...params,
  });
  const res = await fetch(`${BASE}?${query.toString()}`);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

interface TopTagsResponse {
  toptags?: { tag?: Array<{ name: string }> | { name: string } };
}
interface SimilarArtistsResponse {
  similarartists?: { artist?: Array<{ name: string }> | { name: string } };
}

function asArray<T>(v: T[] | T | undefined): T[] {
  return Array.isArray(v) ? v : v ? [v] : [];
}

export async function getAlbumTags(artist: string, album: string) {
  const a = normalizeForLastfm(artist);
  const b = normalizeForLastfm(album);
  const key = `lastfm:tags:${a}:${b}`.toLowerCase();
  return cached(key, WEEK, () => lastfmFetch<TopTagsResponse>("album.gettoptags", { artist: a, album: b }));
}

/** Top genre tags for an album (max 5), most popular first. Best-effort. */
export async function getAlbumGenres(artist: string, album: string): Promise<string[]> {
  if (!lastfmConfigured()) return [];
  try {
    const data = await getAlbumTags(artist, album);
    return asArray(data?.toptags?.tag)
      .map((t) => t.name?.trim().toLowerCase())
      .filter((name): name is string => Boolean(name))
      .slice(0, 5);
  } catch {
    return [];
  }
}

interface ArtistTopTagsResponse {
  toptags?: { tag?: Array<{ name: string }> | { name: string } };
}

/** Top genre tags for an artist (max 5). Best-effort. */
export async function getArtistGenres(artist: string): Promise<string[]> {
  if (!lastfmConfigured()) return [];
  const a = normalizeForLastfm(artist);
  const key = `lastfm:artisttags:${a}`.toLowerCase();
  try {
    const data = await cached(key, WEEK, () =>
      lastfmFetch<ArtistTopTagsResponse>("artist.gettoptags", { artist: a })
    );
    return asArray(data?.toptags?.tag)
      .map((t) => t.name?.trim().toLowerCase())
      .filter((name): name is string => Boolean(name))
      .slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * Album genres with an artist-tag fallback: plenty of albums (especially DJ
 * mixes and obscurities) carry no album-level tags even though the artist is
 * richly tagged — better to show the artist's genres than an empty row.
 */
export async function getGenresWithFallback(artist: string, album: string): Promise<string[]> {
  const albumTags = await getAlbumGenres(artist, album);
  if (albumTags.length) return albumTags;
  return getArtistGenres(artist);
}

/** Similar artists by name (max 6). Best-effort. */
export async function getSimilarArtists(artist: string): Promise<string[]> {
  if (!lastfmConfigured()) return [];
  const a = normalizeForLastfm(artist);
  const key = `lastfm:similar:${a}`.toLowerCase();
  try {
    const data = await cached(key, WEEK, () =>
      lastfmFetch<SimilarArtistsResponse>("artist.getsimilar", { artist: a, limit: "6" })
    );
    return asArray(data?.similarartists?.artist)
      .map((a) => a.name?.trim())
      .filter((name): name is string => Boolean(name))
      .slice(0, 6);
  } catch {
    return [];
  }
}
