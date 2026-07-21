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

interface LastfmTag {
  name: string;
  /** Last.fm popularity weight, 0–100 relative to the top tag. */
  count?: number | string;
}
interface TopTagsResponse {
  toptags?: { tag?: LastfmTag[] | LastfmTag };
}
interface ArtistTopTagsResponse {
  toptags?: { tag?: LastfmTag[] | LastfmTag };
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

// ---------------------------------------------------------------------------
// Tag quality (Phase 5.6.1)
//
// Last.fm tags are folksonomy, so the raw top-5 is often half junk: personal
// collection tags ("albums i own"), bare opinions ("awesome"), and the artist's
// own name. We widen the candidate pool, drop the noise, and rank what's left by
// Last.fm's own popularity weight — album-level tags always outranking the
// artist fallback, because they describe THIS record.
// ---------------------------------------------------------------------------

const MAX_GENRES = 5;
// Pull a wide pool so there's something left after filtering.
const CANDIDATE_POOL = 30;
// Below this relative weight a tag is noise rather than signal.
const MIN_TAG_WEIGHT = 5;

const JUNK_TAG_PATTERNS: RegExp[] = [
  /^seen live$/,
  /\bown\b|\bowned\b|\bcollection\b|\bwishlist\b|\bto ?buy\b|\bto ?listen\b/,
  /^(my|our) /,
  /favou?rite|^best\b|\bbest of\b|^top \d+/,
  /^(awesome|amazing|great|good|cool|nice|beautiful|masterpiece|perfect|classic|epic|chill|banger)s?$/,
  /^(album|albums|music|song|songs|track|tracks|artist|band|singer)s?$/,
  /^(vinyl|cd|cassette|tape|mp3|flac|spotify|lastfm|last\.fm)$/,
  /^\d{4}$/, // a bare year is a date, not a genre
  /^(male|female) vocalis/,
  /^under \d+/,
];

function tagWeight(t: LastfmTag): number {
  const n = typeof t.count === "string" ? Number(t.count) : t.count;
  return Number.isFinite(n) ? (n as number) : 0;
}

/**
 * Drop folksonomy noise. Also drops tags that merely echo the artist or album
 * title — true of most releases and useless as a genre.
 */
function isUsableTag(tag: string, artist: string, album?: string): boolean {
  if (tag.length < 2 || tag.length > 40) return false;
  const a = artist.toLowerCase();
  const b = (album ?? "").toLowerCase();
  if (tag === a || tag === b) return false;
  return !JUNK_TAG_PATTERNS.some((re) => re.test(tag));
}

function cleanTags(raw: LastfmTag[], artist: string, album?: string): string[] {
  const scored = raw
    .map((t) => ({ name: t.name?.trim().toLowerCase(), weight: tagWeight(t) }))
    .filter((t): t is { name: string; weight: number } => Boolean(t.name));

  // Only apply the popularity floor when Last.fm actually gave us weights.
  // Some responses omit `count` entirely; treating every tag as weight 0 there
  // would discard the whole set rather than filtering noise out of it.
  const hasWeights = scored.some((t) => t.weight > 0);

  return scored
    .filter((t) => !hasWeights || t.weight >= MIN_TAG_WEIGHT)
    .filter((t) => isUsableTag(t.name, artist, album))
    .sort((x, y) => y.weight - x.weight)
    .map((t) => t.name);
}

/** Quality-filtered album tags, most popular first. Best-effort. */
export async function getAlbumGenres(artist: string, album: string): Promise<string[]> {
  if (!lastfmConfigured()) return [];
  try {
    const data = await getAlbumTags(artist, album);
    return cleanTags(asArray(data?.toptags?.tag).slice(0, CANDIDATE_POOL), artist, album).slice(
      0,
      MAX_GENRES
    );
  } catch {
    return [];
  }
}

/** Quality-filtered artist tags. Best-effort. */
export async function getArtistGenres(artist: string): Promise<string[]> {
  if (!lastfmConfigured()) return [];
  const a = normalizeForLastfm(artist);
  const key = `lastfm:artisttags:${a}`.toLowerCase();
  try {
    const data = await cached(key, WEEK, () =>
      lastfmFetch<ArtistTopTagsResponse>("artist.gettoptags", { artist: a })
    );
    return cleanTags(asArray(data?.toptags?.tag).slice(0, CANDIDATE_POOL), artist).slice(
      0,
      MAX_GENRES
    );
  } catch {
    return [];
  }
}

/**
 * Genres for a release: album-level tags first (they describe THIS record), then
 * topped up from the artist's tags only if the album is thinly tagged — common
 * for DJ mixes and obscurities. Previously this was all-or-nothing, so a single
 * weak album tag suppressed the artist's much richer set entirely.
 */
export async function getGenresWithFallback(artist: string, album: string): Promise<string[]> {
  const albumTags = await getAlbumGenres(artist, album);
  if (albumTags.length >= MAX_GENRES) return albumTags;

  const artistTags = await getArtistGenres(artist);
  const merged = [...albumTags];
  for (const t of artistTags) {
    if (merged.length >= MAX_GENRES) break;
    if (!merged.includes(t)) merged.push(t);
  }
  return merged;
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
