// MusicBrainz — the canonical metadata source. No auth, but a descriptive
// User-Agent is mandatory and the rate limit is a hard 1 request/second, so
// every musicbrainz.org call goes through a single shared throttle. Responses
// are cached in Redis for 7 days (this data changes slowly).
//
// Cover art comes from the Cover Art Archive (coverartarchive.org), a separate
// host keyed by MBID with no auth and no MB rate limit.
import { env } from "../config/env.js";
import { cached, invalidateCached } from "./cache.js";

const BASE = "https://musicbrainz.org/ws/2";
const CAA_BASE = "https://coverartarchive.org";
const WEEK = 60 * 60 * 24 * 7;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Single shared gate: chain every MB request so consecutive calls are ≥1.1s
// apart, regardless of how many callers fan out concurrently.
let gate: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
function throttle(): Promise<void> {
  const run = gate.then(async () => {
    const gap = Date.now() - lastRequestAt;
    if (gap < 1100) await sleep(1100 - gap);
    lastRequestAt = Date.now();
  });
  gate = run.catch(() => {});
  return run;
}

/**
 * A transient upstream failure: the resource may well exist, we just couldn't
 * reach it right now. Callers must NOT treat this as "not found" — surfacing it
 * as a 404 is what made a saturated throttle look like a missing release.
 */
export class UpstreamUnavailableError extends Error {
  constructor(
    public readonly source: string,
    message: string
  ) {
    super(message);
    this.name = "UpstreamUnavailableError";
  }
}

// MusicBrainz answers 503 ("exceeding the allowable rate limit") when a burst
// slips past the throttle — the signature failure when a search fan-out has just
// drained the slots. These are all worth another attempt.
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const backoffMs = (attempt: number) => Math.min(250 * 2 ** (attempt - 1), 2000);

/**
 * Fetch from MusicBrainz, distinguishing three outcomes:
 *   - data            → the resource
 *   - null            → the resource genuinely isn't there (404 / 4xx), safe to cache
 *   - throws Upstream → we couldn't tell; retry-able, MUST NOT be cached
 *
 * Retries ride the same shared throttle, so backing off never breaks the 1 req/s
 * contract with MusicBrainz.
 */
async function mbFetch<T>(path: string, maxAttempts = MAX_ATTEMPTS): Promise<T | null> {
  let lastProblem = "unknown";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await throttle();
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        headers: { "User-Agent": env.MUSICBRAINZ_USER_AGENT, Accept: "application/json" },
      });
    } catch (err) {
      lastProblem = `network error: ${(err as Error).message}`;
      if (attempt < maxAttempts) await sleep(backoffMs(attempt));
      continue;
    }

    if (res.ok) return (await res.json()) as T;

    // A definitive "no such resource" — cacheable, not worth retrying.
    if (!RETRYABLE_STATUS.has(res.status)) return null;

    lastProblem = `HTTP ${res.status}`;
    console.warn(
      `[mb] ${lastProblem} on ${path} (attempt ${attempt}/${maxAttempts}) — retrying`
    );
    if (attempt < maxAttempts) await sleep(backoffMs(attempt));
  }

  throw new UpstreamUnavailableError(
    "musicbrainz",
    `MusicBrainz unavailable after ${maxAttempts} attempts (${lastProblem}): ${path}`
  );
}

// ---- Response shapes (only the fields we use) ----
interface ArtistCredit {
  name: string;
  artist?: { id: string; name: string };
}
export interface MBReleaseGroup {
  id: string;
  title: string;
  "primary-type"?: string | null;
  "secondary-types"?: string[];
  "first-release-date"?: string;
  "artist-credit"?: ArtistCredit[];
}
interface ReleaseGroupSearchResponse {
  "release-groups"?: Array<MBReleaseGroup & { score?: number }>;
}
export interface MBAlias {
  name: string;
  type?: string | null;
  locale?: string | null;
  primary?: boolean | null;
}
export interface MBArtist {
  id: string;
  name: string;
  "sort-name"?: string;
  aliases?: MBAlias[];
  type?: string; // "Person" | "Group" | ...
  disambiguation?: string;
  country?: string;
  area?: { name?: string };
  "life-span"?: { begin?: string };
}
interface CoverArtResponse {
  images?: Array<{
    front?: boolean;
    image?: string;
    thumbnails?: Record<string, string>;
  }>;
}

export interface CoverArtUrls {
  thumb: string; // 500px — lists and detail pages
  large: string; // original upload — lightbox only
}

function creditName(rg: MBReleaseGroup): string {
  const credits = rg["artist-credit"];
  if (credits?.length) return credits.map((c) => c.name).join("");
  return "Unknown Artist";
}
function creditArtistId(rg: MBReleaseGroup): string | undefined {
  return rg["artist-credit"]?.[0]?.artist?.id;
}

// Discovery calls (search, fuzzy matching) are best-effort and latency-sensitive:
// a user waiting on search is better served by fewer results now than by perfect
// results in six seconds. Retrying them would also burn the very throttle slots
// whose exhaustion causes first-access failures, so they get a single attempt and
// degrade to empty rather than propagating an upstream error.
const DISCOVERY_ATTEMPTS = 1;

/** Free-text release-group search. Best-effort; degrades to [] when MB is busy. Cached 7d. */
export async function searchReleaseGroups(query: string): Promise<MBReleaseGroup[]> {
  const key = `mb:rg:search:${query.toLowerCase()}`;
  return cached(key, WEEK, async () => {
    try {
      const data = await mbFetch<ReleaseGroupSearchResponse>(
        `/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=8`,
        DISCOVERY_ATTEMPTS
      );
      return data?.["release-groups"] ?? [];
    } catch (err) {
      if (err instanceof UpstreamUnavailableError) {
        console.warn(`[mb] search degraded (${err.message})`);
        return [];
      }
      throw err;
    }
  });
}

/** Release-group lookup by MBID, with artist credits. Cached 7d. */
export async function lookupReleaseGroup(mbid: string): Promise<MBReleaseGroup | null> {
  const key = `mb:rg:${mbid}`;
  return cached(key, WEEK, () =>
    mbFetch<MBReleaseGroup>(`/release-group/${mbid}?inc=artist-credits&fmt=json`)
  );
}

/** Artist lookup by MBID. Cached 7d. */
export async function lookupArtist(mbid: string) {
  // v2 key: aliases were added to the payload, so old cached entries lack them.
  const key = `mb:artist:v2:${mbid}`;
  return cached(key, WEEK, () => mbFetch<MBArtist>(`/artist/${mbid}?inc=aliases&fmt=json`));
}

// Scripts whose presence means a name won't be readable to a Latin-script
// reader, so it deserves a Latin rendering alongside the original.
const NON_LATIN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Greek}\p{Script=Thai}\p{Script=Devanagari}]/u;

/** Whether a name needs a Latin counterpart for display. */
export function isNonLatin(name: string): boolean {
  return NON_LATIN.test(name);
}

/**
 * A Latin/English rendering for a non-Latin artist name, or null when the name
 * is already Latin (or MusicBrainz offers nothing usable).
 *
 * Preference order mirrors how MusicBrainz models this:
 *   1. a primary alias in an English locale  ("Fishmans")
 *   2. any English-locale alias
 *   3. any alias that is itself Latin script
 *   4. sort-name, if Latin (often the romanization)
 */
export function pickLatinName(artist: MBArtist | null | undefined): string | null {
  if (!artist || !isNonLatin(artist.name)) return null;

  const aliases = (artist.aliases ?? []).filter((a) => a.name && !isNonLatin(a.name));
  const english = aliases.filter((a) => (a.locale ?? "").toLowerCase().startsWith("en"));

  const chosen =
    english.find((a) => a.primary)?.name ??
    english[0]?.name ??
    aliases[0]?.name ??
    (artist["sort-name"] && !isNonLatin(artist["sort-name"]) ? artist["sort-name"] : null);

  // Never return the original back as its own "translation".
  return chosen && chosen !== artist.name ? chosen : null;
}

/**
 * Best confident release-group MBID for an artist + title, or null. Used to
 * attach the canonical id when a non-MB source seeds a release. Cached 7d.
 */
export async function findReleaseGroupMbid(artist: string, title: string): Promise<string | null> {
  const key = `mb:rg:match:${artist}:${title}`.toLowerCase();
  return cached(key, WEEK, async () => {
    const query = `artist:"${artist}" AND releasegroup:"${title}"`;
    try {
      const data = await mbFetch<ReleaseGroupSearchResponse>(
        `/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=1`,
        DISCOVERY_ATTEMPTS
      );
      const top = data?.["release-groups"]?.[0];
      // MB search scores are 0–100; require a strong match to avoid mis-dedupe.
      return top && (top.score === undefined || top.score >= 90) ? top.id : null;
    } catch (err) {
      // Couldn't confirm a match right now — seed without the MBID rather than
      // failing the whole request; enrichExisting attaches it on a later access.
      if (err instanceof UpstreamUnavailableError) return null;
      throw err;
    }
  });
}

/**
 * Front cover URLs from the Cover Art Archive for a release-group MBID, or null
 * when the archive has nothing. `thumb` is the 500px rendition for lists;
 * `large` is the original upload, fetched by clients only for the lightbox.
 * Cached 7d (misses included).
 */
// The Cover Art Archive is frequently slow for obscure releases. It is only ONE
// source in the chain (CAA -> source cover -> Discogs), so waiting on it is
// worse than moving on: bound it and let the next source answer.
const CAA_TIMEOUT_MS = 2500;

export async function getCoverArtUrls(releaseGroupMbid: string): Promise<CoverArtUrls | null> {
  const key = `caa:rg:urls:${releaseGroupMbid}`;
  return cached(key, WEEK, async () => {
    let res: Response;
    try {
      res = await fetch(`${CAA_BASE}/release-group/${releaseGroupMbid}`, {
        headers: { "User-Agent": env.MUSICBRAINZ_USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(CAA_TIMEOUT_MS),
      });
    } catch (err) {
      // A dropped connection tells us NOTHING about whether art exists, so it
      // must not be cached as "no art" for a week. Raise it as retry-able and
      // let the caller decide (cover art is supplemental — callers swallow it).
      throw new UpstreamUnavailableError(
        "coverartarchive",
        `Cover Art Archive unreachable for ${releaseGroupMbid}: ${(err as Error).message}`
      );
    }
    if (!res.ok) return null; // 404 = no art on file
    const data = (await res.json()) as CoverArtResponse;
    const front = data.images?.find((i) => i.front) ?? data.images?.[0];
    if (!front) return null;
    const large = front.image ?? front.thumbnails?.["1200"] ?? front.thumbnails?.["500"];
    const thumb = front.thumbnails?.["500"] ?? large;
    return thumb && large ? { thumb, large } : null;
  });
}

// ---- Labels ----
interface LabelBrowseResponse {
  releases?: Array<{ "label-info"?: Array<{ label?: { id: string; name: string } | null }> }>;
}
export interface MBLabel {
  id: string;
  name: string;
  area?: { name?: string };
  "life-span"?: { begin?: string };
}

/**
 * The primary label MBID+name for a release-group, from the label credits on
 * its releases (one browse call, inc=labels). Skips MusicBrainz's "[no label]"
 * placeholder. Cached 7d (misses too).
 */
export async function getReleaseGroupLabel(rgMbid: string): Promise<{ mbid: string; name: string } | null> {
  const key = `mb:rg:label:${rgMbid}`;
  return cached(key, WEEK, async () => {
    const data = await mbFetch<LabelBrowseResponse>(
      `/release?release-group=${rgMbid}&inc=labels&limit=10&fmt=json`
    );
    for (const rel of data?.releases ?? []) {
      for (const li of rel["label-info"] ?? []) {
        const label = li.label;
        if (label?.id && label.name && label.name !== "[no label]") {
          return { mbid: label.id, name: label.name };
        }
      }
    }
    return null;
  });
}

/** Label lookup by MBID (name, area, founding date). Cached 7d. */
export async function lookupLabel(mbid: string): Promise<MBLabel | null> {
  const key = `mb:label:${mbid}`;
  return cached(key, WEEK, () => mbFetch<MBLabel>(`/label/${mbid}?fmt=json`));
}

export function creditsOf(rg: MBReleaseGroup) {
  return { artistName: creditName(rg), artistId: creditArtistId(rg) };
}

// ---------------------------------------------------------------------------
// Discographies — browse every release-group credited to an artist (Phase 5.6).
// ---------------------------------------------------------------------------

/** One release-group in an artist's discography, as MusicBrainz describes it. */
export interface MBDiscographyEntry {
  mbid: string;
  title: string;
  /** Release-group first-release-date — the ORIGINAL date, never a pressing. */
  firstReleaseDate?: string;
  primaryType?: string | null;
  secondaryTypes: string[];
  disambiguation?: string;
}

interface BrowseReleaseGroupsResponse {
  "release-group-count"?: number;
  "release-groups"?: Array<{
    id: string;
    title: string;
    "first-release-date"?: string;
    "primary-type"?: string | null;
    "secondary-types"?: string[];
    disambiguation?: string;
  }>;
}

// MusicBrainz caps browse results at 100 per request; a prolific artist
// therefore costs several sequential calls through the 1 req/s throttle.
const BROWSE_PAGE_SIZE = 100;
// Safety valve so a pathological artist can't loop forever (100 * 40 = 4000).
const MAX_BROWSE_PAGES = 40;

export interface DiscographyProgress {
  fetched: number;
  /** Total release-groups MusicBrainz reports, once the first page tells us. */
  total: number | null;
}

function toDiscographyEntry(
  rg: NonNullable<BrowseReleaseGroupsResponse["release-groups"]>[number]
): MBDiscographyEntry {
  return {
    mbid: rg.id,
    title: rg.title,
    firstReleaseDate: rg["first-release-date"] || undefined,
    primaryType: rg["primary-type"] ?? null,
    secondaryTypes: rg["secondary-types"] ?? [],
    disambiguation: rg.disambiguation || undefined,
  };
}

/**
 * Walk every page of an artist's release-groups and return the COMPLETE list.
 *
 * Completeness is the whole contract here, because the result gets cached for a
 * week: a half-assembled discography must never be mistaken for the real thing.
 * So this either returns everything or throws:
 *   - a retry-able upstream failure propagates from mbFetch (never cached)
 *   - a definitive miss on the FIRST page means the artist genuinely has no
 *     release-groups → empty list, which IS a legitimate cacheable answer
 *   - a definitive miss on a LATER page, or a short read against the count
 *     MusicBrainz gave us, is a partial assembly → throw
 */
async function assembleDiscography(
  artistMbid: string,
  onProgress?: (p: DiscographyProgress) => void
): Promise<MBDiscographyEntry[]> {
  const entries: MBDiscographyEntry[] = [];
  let total: number | null = null;
  let offset = 0;

  for (let page = 0; page < MAX_BROWSE_PAGES; page++) {
    // Throws UpstreamUnavailableError on a transient failure — deliberately
    // uncaught so `cached` never stores an incomplete discography.
    const data = await mbFetch<BrowseReleaseGroupsResponse>(
      `/release-group?artist=${artistMbid}&limit=${BROWSE_PAGE_SIZE}&offset=${offset}&fmt=json`
    );

    if (!data) {
      if (offset === 0) return []; // genuinely nothing to list — cacheable
      throw new UpstreamUnavailableError(
        "musicbrainz",
        `discography assembly incomplete for ${artistMbid} (definitive miss at offset ${offset})`
      );
    }

    const groups = data["release-groups"] ?? [];
    if (typeof data["release-group-count"] === "number") total = data["release-group-count"];
    entries.push(...groups.map(toDiscographyEntry));
    onProgress?.({ fetched: entries.length, total });

    offset += groups.length;
    if (groups.length === 0) break; // ran off the end
    if (total !== null && entries.length >= total) break; // got them all
  }

  if (total !== null && entries.length < total) {
    throw new UpstreamUnavailableError(
      "musicbrainz",
      `discography assembly incomplete for ${artistMbid} (${entries.length}/${total})`
    );
  }
  return entries;
}

export const discographyCacheKey = (artistMbid: string) => `mb:artist:discography:${artistMbid}`;

/**
 * An artist's complete discography, cached 7d by artist MBID. Only ever caches a
 * verified-complete assembly (see assembleDiscography).
 */
export function getArtistDiscography(
  artistMbid: string,
  onProgress?: (p: DiscographyProgress) => void
): Promise<MBDiscographyEntry[]> {
  return cached(discographyCacheKey(artistMbid), WEEK, () =>
    assembleDiscography(artistMbid, onProgress)
  );
}

/** Drop the cached discography so the next read re-browses MusicBrainz. */
export async function bustArtistDiscography(artistMbid: string): Promise<void> {
  await invalidateCached(discographyCacheKey(artistMbid));
}
