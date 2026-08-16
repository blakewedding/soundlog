// MusicBrainz — the canonical metadata source. No auth, but a descriptive
// User-Agent is mandatory and the rate limit is a hard 1 request/second, so
// every musicbrainz.org call goes through a single shared throttle. Responses
// are cached in Redis for 7 days (this data changes slowly).
//
// Cover art comes from the Cover Art Archive (coverartarchive.org), a separate
// host keyed by MBID with no auth and no MB rate limit.
import { env } from "../config/env.js";
import { cached, invalidateCached, type CacheOptions } from "./cache.js";
import {
  ambientTier,
  coverArtGate,
  PriorityRateGate,
  type UpstreamTier,
} from "./upstreamPriority.js";

const BASE = "https://musicbrainz.org/ws/2";
const CAA_BASE = "https://coverartarchive.org";
const WEEK = 60 * 60 * 24 * 7;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Single shared gate: every MB request is spaced ≥1.1s from the last, regardless
// of how many callers fan out concurrently.
//
// It is a PRIORITY gate, not a FIFO chain (6.1.4). The rate is unchanged — that
// is MusicBrainz's policy, not our knob — but a release someone is looking at no
// longer queues behind a speculative discography browse. Measured before the
// change, on Miles Davis' 8-page discography: an interactive seed's MB work went
// from 2,294ms on an idle gate to 9,034ms mid-assembly, purely from ordering.
const MIN_REQUEST_GAP_MS = 1100;
const gate = new PriorityRateGate(MIN_REQUEST_GAP_MS, "mb");

// Every public function here defaults its tier to `ambientTier()` — the tier of
// the surrounding async context, or `interactive` when nothing set one. A call
// site that forgets to declare itself therefore gets the user-facing tier, which
// is the safe way to be wrong about latency. Only work that genuinely blocks
// nobody opts down: the discography assembly (`browse`) and the pre-warmer
// (`background`), both pinned by tests.

/** Queue depths at the MusicBrainz gate. Diagnostics and tests. */
export function mbGateDepth() {
  return gate.depth();
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
interface MbFetchOptions {
  maxAttempts?: number;
  tier?: UpstreamTier;
}
async function mbFetch<T>(
  path: string,
  { maxAttempts = MAX_ATTEMPTS, tier = ambientTier() }: MbFetchOptions = {}
): Promise<T | null> {
  let lastProblem = "unknown";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Retries ride the same gate at the same tier, so backing off never breaks
    // the 1 req/s contract and a retried browse page cannot jump a click.
    await gate.acquire(tier);
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
interface CoverArtImage {
  front?: boolean;
  approved?: boolean;
  types?: string[];
  image?: string;
  thumbnails?: Record<string, string>;
}
interface CoverArtResponse {
  images?: CoverArtImage[];
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

// ---------------------------------------------------------------------------
// Cache keys.
//
// Exported and built in ONE place each, because the pre-warmer needs to ask how
// much life a cached answer has left (`ttlOf`) and would otherwise re-type these
// strings. The `v2` below is the standing proof that matters: this key has been
// versioned once already, and a hand-copied duplicate would not have moved with
// it — it would simply have started reading a key nothing writes.
// ---------------------------------------------------------------------------

/** Free-text artist search, keyed by the exact lowercased query. */
export const artistSearchCacheKey = (query: string) => `mb:artist:search:${query.toLowerCase()}`;
/** Free-text release-group search, keyed by the exact lowercased query. */
export const releaseGroupSearchCacheKey = (query: string) => `mb:rg:search:${query.toLowerCase()}`;
/** Artist lookup by MBID. v2: aliases were added to the payload. */
export const artistLookupCacheKey = (mbid: string) => `mb:artist:v2:${mbid}`;

/**
 * Free-text release-group search. Best-effort; degrades to [] when MB is busy.
 * A genuine empty answer is cached 7d; a DEGRADED one is never cached — see
 * the note on `searchMusicBrainzArtists`.
 */
export async function searchReleaseGroups(
  query: string,
  cacheOpts: CacheOptions = {}
): Promise<MBReleaseGroup[]> {
  const key = releaseGroupSearchCacheKey(query);
  try {
    return await cached(
      key,
      WEEK,
      async () => {
        const data = await mbFetch<ReleaseGroupSearchResponse>(
          `/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=8`,
          { maxAttempts: DISCOVERY_ATTEMPTS }
        );
        return data?.["release-groups"] ?? [];
      },
      cacheOpts
    );
  } catch (err) {
    if (err instanceof UpstreamUnavailableError) {
      console.warn(`[mb] search degraded (${err.message})`);
      return [];
    }
    throw err;
  }
}

interface ArtistSearchResponse {
  artists?: Array<MBArtist & { score?: number }>;
}

/**
 * Free-text ARTIST search. Best-effort; degrades to [] when MB is busy. Cached 7d.
 *
 * The counterpart to `searchReleaseGroups`, and it did not exist until 6.2d.
 * Its absence was the whole of the cold-artist bug: release search fanned out to
 * MusicBrainz when local results were thin, artist search queried only our own
 * Elasticsearch index, and that index by definition contains only artists we
 * have already seeded. So at launch — when every artist is cold — searching an
 * artist by name returned nothing, and the only route to an artist page was to
 * search one of their ALBUMS, open it, and click through the credit.
 *
 * `DISCOVERY_ATTEMPTS` for the same reason as every other search here (§7):
 * one attempt, degrade to empty. Retrying discovery burns the throttle slots
 * whose exhaustion causes first-access failures, and a person waiting on search
 * is better served by fewer results now.
 *
 * ## The degraded answer is NOT cached, and that placement is the whole point
 *
 * The `try` sits OUTSIDE `cached()`, not inside it. Inside — where it was until
 * 6.2e — the catch returned `[]` as the callback's value, `cached()` wrote it,
 * and a single MusicBrainz 503 became "no artist matches this query" **for seven
 * days**. That is §1's most expensive bug in the discovery path: a retryable
 * condition surfaced as a permanent one, then cached so the retry never happened.
 *
 * Measured, not theorised: a 489-name warming resolution on 2026-07-30 hit 11
 * transient 503s, and every one of those query strings was left holding `[]` with
 * a full week to live — "Elliott Smith", "Mitski", "Sleep" among them. At launch,
 * with every artist cold, that is a search box that silently stops finding an
 * artist because MusicBrainz hiccuped once.
 *
 * §7's "one attempt, degrade to empty" is a policy about how hard we TRY. It was
 * never a claim that the artist does not exist — the same distinction §7 already
 * draws for cover art ("the answer is still 503, never 404"). Degrading the
 * RESPONSE is right; persisting the degradation is not.
 *
 * A genuine empty result — a 200 carrying no artists — still caches, because that
 * is a real answer (§1).
 */
export async function searchMusicBrainzArtists(
  query: string,
  cacheOpts: CacheOptions = {}
): Promise<MBArtist[]> {
  const key = artistSearchCacheKey(query);
  try {
    // Throwing out of the callback is what keeps the degraded answer out of
    // Redis — `cached()` writes only on return (§2, same mechanism that keeps a
    // partial discography assembly uncached). Unchanged under `refresh`: a
    // refresh that degrades throws before the write, so the existing entry
    // survives rather than being replaced by an empty one.
    return await cached(
      key,
      WEEK,
      async () => {
        const data = await mbFetch<ArtistSearchResponse>(
          `/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=8`,
          { maxAttempts: DISCOVERY_ATTEMPTS }
        );
        return data?.artists ?? [];
      },
      cacheOpts
    );
  } catch (err) {
    if (err instanceof UpstreamUnavailableError) {
      console.warn(`[mb] artist search degraded (${err.message})`);
      return [];
    }
    throw err;
  }
}

/** Release-group lookup by MBID, with artist credits. Cached 7d. */
export async function lookupReleaseGroup(
  mbid: string,
  tier: UpstreamTier = ambientTier()
): Promise<MBReleaseGroup | null> {
  const key = `mb:rg:${mbid}`;
  return cached(key, WEEK, () =>
    mbFetch<MBReleaseGroup>(`/release-group/${mbid}?inc=artist-credits&fmt=json`, { tier })
  );
}

/** Artist lookup by MBID. Cached 7d. */
export async function lookupArtist(
  mbid: string,
  tier: UpstreamTier = ambientTier(),
  cacheOpts: CacheOptions = {}
) {
  const key = artistLookupCacheKey(mbid);
  return cached(
    key,
    WEEK,
    () => mbFetch<MBArtist>(`/artist/${mbid}?inc=aliases&fmt=json`, { tier }),
    cacheOpts
  );
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
 * attach the canonical id when a non-MB source seeds a release. A confident
 * match, and a definitive "no strong match", are cached 7d; an UNCONFIRMED one
 * is not cached at all.
 *
 * ## Why the `try` is outside `cached()` (6.2e)
 *
 * It used to be inside, returning `null` on `UpstreamUnavailableError` — so the
 * callback returned a value, `cached()` wrote it, and "we could not reach
 * MusicBrainz just now" was stored as "this release has no MBID" **for a week**.
 *
 * That defeated the very recovery its own comment promised. Seeding without the
 * MBID is fine *because* `enrichExisting` attaches it on a later access — but a
 * later access calls this function again, hit the cached `null`, and attached
 * nothing. The row stayed identity-less for seven days, and MBID is the canonical
 * identity §3 is built on, so dedupe and release↔release-group matching degrade
 * with it.
 *
 * Sibling of the same fix in `searchMusicBrainzArtists`; see the long note there
 * for the measurement that surfaced the class.
 */
export async function findReleaseGroupMbid(
  artist: string,
  title: string,
  tier: UpstreamTier = ambientTier()
): Promise<string | null> {
  const key = `mb:rg:match:${artist}:${title}`.toLowerCase();
  try {
    return await cached(key, WEEK, async () => {
      const query = `artist:"${artist}" AND releasegroup:"${title}"`;
      const data = await mbFetch<ReleaseGroupSearchResponse>(
        `/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=1`,
        { maxAttempts: DISCOVERY_ATTEMPTS, tier }
      );
      const top = data?.["release-groups"]?.[0];
      // MB search scores are 0–100; require a strong match to avoid mis-dedupe.
      // A weak or absent match IS a definitive answer and stays cacheable.
      return top && (top.score === undefined || top.score >= 90) ? top.id : null;
    });
  } catch (err) {
    // Couldn't confirm a match right now — seed without the MBID rather than
    // failing the whole request. Nothing was cached, so the next access really
    // does retry, which is what makes `enrichExisting`'s heal work.
    if (err instanceof UpstreamUnavailableError) return null;
    throw err;
  }
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

/** How many releases inside a group we will probe when the group itself has no
 *  usable front. Earliest-dated first, so the original pressing is tried before
 *  a 2018 reissue. Bounded because a group can hold dozens of pressings and
 *  every probe is a Cover Art Archive slot. */
const CAA_RELEASE_PROBE_LIMIT = 5;

/**
 * The release-level probe gets longer than {@link CAA_TIMEOUT_MS}.
 *
 * 2,500ms is right for the GROUP lookup, where the archive is only one source
 * in a chain (CAA → source cover → Discogs) and moving on is cheap. It is wrong
 * here, where this probe only runs BECAUSE the chain already came up empty, and
 * abandoning it means returning nothing at all.
 *
 * Measured against the live archive, per-release lookups for Tom Waits' *Blue
 * Valentine* took 1.64–1.98s — close enough to 2,500ms that they tripped it
 * under load, and the walk skipped the 1978 original (whose art is intact) to
 * land on a 2018 reissue whose bytes 500. Bailing early cost us the good
 * pressing, not the wait.
 */
const CAA_RELEASE_TIMEOUT_MS = 6000;

/** Thrown-vs-null bookkeeping for one resolution attempt. */
interface CaaOutcome {
  payload: CoverArtResponse | null;
  /** True when we could not TELL (5xx/429/timeout/socket) — never cacheable. */
  unavailable: boolean;
  problem?: string;
}

/**
 * One Cover Art Archive JSON read, mapped onto the three outcomes of §1.
 *
 * The status split is the whole point. This used to be `if (!res.ok) return
 * null`, with the comment "404 = no art on file" — but that branch also caught
 * every 5xx, and `cached()` then wrote the resulting `null` under a SEVEN-DAY
 * TTL. The Cover Art Archive's release-group endpoint answers a persistent 500
 * for a number of real groups (Tom Waits' *Blue Valentine*, *Swordfishtrombones*
 * and *Downtown Train* among them) while the releases inside those groups serve
 * approved front covers perfectly well. Every one of those albums rendered blank
 * across the entire app because a server error had been written down as "this
 * record has no artwork".
 *
 * That is exactly the retryable-treated-as-permanent bug §1 exists to prevent,
 * one layer below the MusicBrainz call it was written for.
 */
async function fetchCoverArtJson(
  path: string,
  tier: UpstreamTier,
  timeoutMs = CAA_TIMEOUT_MS
): Promise<CaaOutcome> {
  // Bounded concurrency (6.1.4), the slot held across the body read for the
  // same reason as the image bytes. The 2.5s timeout was tripping on
  // congestion WE created — 37 simultaneous requests during one discography
  // browse — and a timeout here fails the covers stage, which is how a
  // release ends up reporting `failed` with no artwork.
  try {
    return await coverArtGate.run(tier, async () => {
      const res = await fetch(`${CAA_BASE}${path}`, {
        headers: { "User-Agent": env.MUSICBRAINZ_USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      // A definitive answer: this resource genuinely has no art on file.
      if (res.status === 404) return { payload: null, unavailable: false };
      if (RETRYABLE_STATUS.has(res.status)) {
        return { payload: null, unavailable: true, problem: `HTTP ${res.status}` };
      }
      if (!res.ok) return { payload: null, unavailable: false }; // other 4xx: definitive
      return { payload: (await res.json()) as CoverArtResponse, unavailable: false };
    });
  } catch (err) {
    // A dropped connection tells us NOTHING about whether art exists, so it
    // must not be cached as "no art" for a week.
    return { payload: null, unavailable: true, problem: (err as Error).message };
  }
}

/**
 * The APPROVED FRONT image, or null.
 *
 * Both qualifiers are load-bearing. The previous rule fell back to
 * `images[0]` when nothing was flagged front, which hands the cover slot to
 * whatever happened to be uploaded first — commonly a `Medium` label or disc
 * scan. `Small Change`'s group carries exactly that shape: an approved Front,
 * then an Asylum side-one label typed `Medium`. Picking an arbitrary image is
 * never better than showing the placeholder, because a wrong cover reads as our
 * data being wrong rather than absent.
 */
function selectApprovedFront(payload: CoverArtResponse | null): CoverArtImage | null {
  return (
    payload?.images?.find(
      (i) => (i.front === true || i.types?.includes("Front")) && i.approved !== false
    ) ?? null
  );
}

function toCoverArtUrls(front: CoverArtImage | null): CoverArtUrls | null {
  if (!front) return null;
  const large = front.image ?? front.thumbnails?.["1200"] ?? front.thumbnails?.["500"];
  const thumb = front.thumbnails?.["500"] ?? large;
  return thumb && large ? { thumb, large } : null;
}

export async function getCoverArtUrls(
  releaseGroupMbid: string,
  tier: UpstreamTier = ambientTier(),
  cacheOpts: CacheOptions = {}
): Promise<CoverArtUrls | null> {
  const key = `caa:rg:urls:${releaseGroupMbid}`;
  return cached(key, WEEK, async () => {
    const group = await fetchCoverArtJson(`/release-group/${releaseGroupMbid}`, tier);
    const groupFront = toCoverArtUrls(selectApprovedFront(group.payload));
    if (groupFront) return groupFront;

    // The group endpoint had no usable front. It may be broken (500) or simply
    // representing a release nobody uploaded a front for — either way the art
    // often still exists on a specific release in the group, so ask there
    // before concluding anything. MBID-only throughout (§3): the group's own
    // release list, never a title match.
    const viaRelease = await coverArtFromReleases(releaseGroupMbid, tier);
    if (viaRelease.urls) return viaRelease.urls;

    // Nothing found. WHY decides whether this is cacheable: a definitive
    // "no art anywhere" is worth remembering for a week; an outage is not.
    if (group.unavailable || viaRelease.unavailable) {
      throw new UpstreamUnavailableError(
        "coverartarchive",
        `Cover Art Archive unreachable for ${releaseGroupMbid}: ${
          group.problem ?? viaRelease.problem ?? "unknown"
        }`
      );
    }
    return null; // genuinely no art on file
  }, cacheOpts);
}

/**
 * Walk the releases inside a group, earliest first, for an approved front.
 *
 * Earliest-first matches §4's discipline about dates: the original pressing's
 * sleeve is the one people recognise as the album, and a reissue's alternate
 * artwork is the fallback rather than the answer. Undated pressings sort last.
 */
async function coverArtFromReleases(
  releaseGroupMbid: string,
  tier: UpstreamTier
): Promise<{ urls: CoverArtUrls | null; unavailable: boolean; problem?: string }> {
  let releases: Array<{ id: string; date?: string }>;
  try {
    const data = await mbFetch<{ releases?: Array<{ id: string; date?: string }> }>(
      `/release?release-group=${releaseGroupMbid}&fmt=json&limit=25`,
      { tier }
    );
    releases = data?.releases ?? [];
  } catch (err) {
    // MusicBrainz itself is unreachable — we still cannot tell.
    return { urls: null, unavailable: true, problem: (err as Error).message };
  }

  // `|| "9999"`, not `?? "9999"`: MusicBrainz returns `date: ""` for an undated
  // pressing, and an empty string sorts BEFORE "1978" — which put a dateless
  // reissue ahead of the original sleeve on the first live run of this.
  const ordered = [...releases].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  let unavailable = false;
  let problem: string | undefined;

  for (const release of ordered.slice(0, CAA_RELEASE_PROBE_LIMIT)) {
    const outcome = await fetchCoverArtJson(
      `/release/${release.id}`,
      tier,
      CAA_RELEASE_TIMEOUT_MS
    );
    if (outcome.unavailable) {
      unavailable = true;
      problem ??= outcome.problem;
      continue;
    }
    const urls = toCoverArtUrls(selectApprovedFront(outcome.payload));
    if (urls) return { urls, unavailable: false };
  }
  return { urls: null, unavailable, problem };
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
export async function getReleaseGroupLabel(
  rgMbid: string,
  tier: UpstreamTier = ambientTier()
): Promise<{ mbid: string; name: string } | null> {
  const key = `mb:rg:label:${rgMbid}`;
  return cached(key, WEEK, async () => {
    const data = await mbFetch<LabelBrowseResponse>(
      `/release?release-group=${rgMbid}&inc=labels&limit=10&fmt=json`,
      { tier }
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
export async function lookupLabel(
  mbid: string,
  tier: UpstreamTier = ambientTier()
): Promise<MBLabel | null> {
  const key = `mb:label:${mbid}`;
  return cached(key, WEEK, () => mbFetch<MBLabel>(`/label/${mbid}?fmt=json`, { tier }));
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
    // `browse`, not `interactive`: someone IS watching the artist page's
    // progress line, but they are not blocked on any single page of it, and a
    // click that lands mid-assembly must go first. This is the call that made an
    // interactive seed 3.9× slower before 6.1.4.
    const data = await mbFetch<BrowseReleaseGroupsResponse>(
      `/release-group?artist=${artistMbid}&limit=${BROWSE_PAGE_SIZE}&offset=${offset}&fmt=json`,
      { tier: "browse" }
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

interface GenreAllResponse {
  genres?: Array<{ name?: string }>;
  "genre-count"?: number;
}

/**
 * MusicBrainz's published genre vocabulary (~2,200 entries), walked in pages of
 * 100 through the shared gate at `background` tier — nobody is blocked on this,
 * and it is the only caller that makes ~22 requests in a row.
 *
 * Completeness is checked against upstream's own `genre-count` and a short read
 * THROWS (§2). A truncated vocabulary is worse than none: it would silently
 * reclassify real genres as junk, and `cached()` would then keep that answer for
 * a month. Throwing is what keeps the partial list out of Redis.
 */
export async function fetchGenreVocabulary(): Promise<string[]> {
  const PAGE = 100;
  const names: string[] = [];
  let offset = 0;
  let total: number | null = null;

  do {
    const data = await mbFetch<GenreAllResponse>(
      `/genre/all?fmt=json&limit=${PAGE}&offset=${offset}`,
      { tier: "background" }
    );
    if (!data?.genres) {
      throw new UpstreamUnavailableError(
        "musicbrainz",
        `genre vocabulary page at offset ${offset} returned no genres`
      );
    }
    if (total === null) total = data["genre-count"] ?? 0;
    for (const g of data.genres) if (g.name) names.push(g.name);
    offset += PAGE;
  } while (total !== null && offset < total);

  if (total === null || names.length < total) {
    throw new UpstreamUnavailableError(
      "musicbrainz",
      `genre vocabulary short read (${names.length}/${total ?? "unknown"})`
    );
  }
  return names;
}

export const discographyCacheKey = (artistMbid: string) => `mb:artist:discography:${artistMbid}`;

/**
 * An artist's complete discography, cached 7d by artist MBID. Only ever caches a
 * verified-complete assembly (see assembleDiscography).
 */
export function getArtistDiscography(
  artistMbid: string,
  onProgress?: (p: DiscographyProgress) => void,
  cacheOpts: CacheOptions = {}
): Promise<MBDiscographyEntry[]> {
  return cached(
    discographyCacheKey(artistMbid),
    WEEK,
    () => assembleDiscography(artistMbid, onProgress),
    cacheOpts
  );
}

/** Drop the cached discography so the next read re-browses MusicBrainz. */
export async function bustArtistDiscography(artistMbid: string): Promise<void> {
  await invalidateCached(discographyCacheKey(artistMbid));
}
