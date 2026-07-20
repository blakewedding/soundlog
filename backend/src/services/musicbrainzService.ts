// MusicBrainz — the canonical metadata source. No auth, but a descriptive
// User-Agent is mandatory and the rate limit is a hard 1 request/second, so
// every musicbrainz.org call goes through a single shared throttle. Responses
// are cached in Redis for 7 days (this data changes slowly).
//
// Cover art comes from the Cover Art Archive (coverartarchive.org), a separate
// host keyed by MBID with no auth and no MB rate limit.
import { env } from "../config/env.js";
import { cached } from "./cache.js";

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
export interface MBArtist {
  id: string;
  name: string;
  "sort-name"?: string;
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
  const key = `mb:artist:${mbid}`;
  return cached(key, WEEK, () => mbFetch<MBArtist>(`/artist/${mbid}?fmt=json`));
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
export async function getCoverArtUrls(releaseGroupMbid: string): Promise<CoverArtUrls | null> {
  const key = `caa:rg:urls:${releaseGroupMbid}`;
  return cached(key, WEEK, async () => {
    const res = await fetch(`${CAA_BASE}/release-group/${releaseGroupMbid}`, {
      headers: { "User-Agent": env.MUSICBRAINZ_USER_AGENT, Accept: "application/json" },
    });
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
