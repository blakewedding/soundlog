// Discogs — secondary metadata source and cover-art fallback. Authenticated
// with a personal access token in the Authorization header (never a URL param).
// Authenticated rate limit is 60 req/min, so calls are throttled to ~1/s and
// responses cached in Redis for 24h.
import { env } from "../config/env.js";
import { cached, keyPart } from "./cache.js";

const BASE = "https://api.discogs.com";
const DAY = 60 * 60 * 24;

export function discogsConfigured(): boolean {
  return Boolean(env.DISCOGS_TOKEN);
}

// Discogs requires a descriptive User-Agent, and the token rides in the header.
function discogsHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": "Soundlog/0.1.0 (+https://soundlog.app)" };
  if (env.DISCOGS_TOKEN) headers.Authorization = `Discogs token=${env.DISCOGS_TOKEN}`;
  return headers;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 60 req/min ≈ 1/s; keep a shared ~1.05s gate for headroom under the limit.
let gate: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
function throttle(): Promise<void> {
  const run = gate.then(async () => {
    const gap = Date.now() - lastRequestAt;
    if (gap < 1050) await sleep(1050 - gap);
    lastRequestAt = Date.now();
  });
  gate = run.catch(() => {});
  return run;
}

async function discogsFetch<T>(path: string): Promise<T | null> {
  await throttle();
  const res = await fetch(`${BASE}${path}`, { headers: discogsHeaders() });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export interface DiscogsSearchResult {
  id: number;
  type: string; // "master" | "release" | "artist" | "label"
  title: string; // "Artist - Title"
  year?: string;
  cover_image?: string;
  thumb?: string;
  format?: string[];
}
interface DiscogsSearchResponse {
  results?: DiscogsSearchResult[];
}
export interface DiscogsImage {
  uri: string;
  type: string; // "primary" | "secondary"
  width?: number;
  height?: number;
}
export interface DiscogsRelease {
  id: number;
  title: string;
  year?: number; // for a master: the original year; for a release: the pressing year
  master_id?: number; // present on a specific release, pointing at its master
  artists?: Array<{ name: string; id: number }>;
  labels?: Array<{ name: string; id: number }>;
  genres?: string[];
  styles?: string[];
  formats?: Array<{ name: string; descriptions?: string[] }>;
  images?: DiscogsImage[];
}

/**
 * The image most likely to be an actual front cover.
 *
 * Discogs declares the front itself as `type: "primary"`, and that declaration
 * is the strongest signal available — so it wins unless we can positively see
 * it is a sleeve SPREAD (measurably non-square, e.g. a 600×368 J-card), which
 * is the case squareness was introduced to handle.
 *
 * Squareness alone is not safe as the primary rule, and Tom Waits' *Small
 * Change* is why. A vinyl LABEL scan is a circle cropped to a perfect square,
 * so it scores 0.0000 and beats a real front cover sleeve at 550×545 (0.0091).
 * The stored cover for that release was Discogs image R-725926-1415564276-3493
 * — the Asylum Records "SIDE ONE" label — served as the album's artwork on
 * every surface in the app. Any vinyl release whose Discogs entry includes
 * label scans could produce the same thing.
 *
 * So: trust the declaration, and fall back to squareness only to disprove it or
 * when there is no declaration to trust.
 */
export function pickCoverImage(images: DiscogsImage[] = []): DiscogsImage | null {
  const primary = images.find((i) => i.uri && i.type === "primary");
  // Unmeasurable dimensions can't disprove anything — `isSquareish` is false for
  // them, and falling through on that would hand the choice to a measurable
  // label scan. An undeclared shape is not evidence of a spread.
  if (primary && (!hasDimensions(primary) || isSquareish(primary))) return primary;
  return pickSquarestImage(images);
}

function hasDimensions(image: DiscogsImage): boolean {
  return Boolean(image.width && image.height);
}

/**
 * Closest to square. The tie-break within {@link pickCoverImage}, and the whole
 * rule for entries that declare no primary: cassette/vinyl entries often lead
 * with a full unfolded sleeve scan (e.g. 600×368 J-card spreads) which crop to
 * an unrecognizable smear in square cover tiles.
 */
export function pickSquarestImage(images: DiscogsImage[] = []): DiscogsImage | null {
  let best: DiscogsImage | null = null;
  let bestScore = Infinity;
  for (const image of images) {
    if (!image.uri) continue;
    // Unknown dimensions: usable, but ranked below anything measurable.
    const score =
      image.width && image.height ? Math.abs(Math.log(image.width / image.height)) : 10;
    if (score < bestScore) {
      best = image;
      bestScore = score;
    }
  }
  return best;
}

/** Whether an image is close enough to square to read as a cover tile. */
export function isSquareish(image: DiscogsImage): boolean {
  if (!image.width || !image.height) return false;
  const ratio = image.width / image.height;
  return ratio > 0.8 && ratio < 1.25;
}

/** Release/master search, filtered to releasable types. Cached 24h. */
export async function searchDiscogs(query: string): Promise<DiscogsSearchResult[]> {
  if (!discogsConfigured()) return [];
  const key = `discogs:search:${query.toLowerCase()}`;
  return cached(key, DAY, async () => {
    const data = await discogsFetch<DiscogsSearchResponse>(
      `/database/search?type=release&per_page=10&q=${encodeURIComponent(query)}`
    );
    return (data?.results ?? []).filter((r) => r.type === "master" || r.type === "release");
  });
}

/**
 * Full detail by namespace-qualified id: "master:123" or "release:123".
 * Discogs masters and releases are SEPARATE numeric ID namespaces — the same
 * number is two unrelated records — so the namespace must always travel with
 * the id (regression: release 9459 "Live At The Liquid Room" vs master 9459
 * "Bodycage"). Bare numeric ids are rejected rather than guessed. Cached 24h.
 */
export async function getDiscogsRelease(qualifiedId: string): Promise<DiscogsRelease | null> {
  if (!discogsConfigured()) return null;
  const sep = qualifiedId.indexOf(":");
  if (sep === -1) return null; // ambiguous bare id — never guess a namespace
  const namespace = qualifiedId.slice(0, sep);
  const id = qualifiedId.slice(sep + 1);
  if ((namespace !== "master" && namespace !== "release") || !/^\d+$/.test(id)) return null;

  const key = `discogs:detail:${namespace}:${id}`;
  return cached(key, DAY, () =>
    discogsFetch<DiscogsRelease>(namespace === "master" ? `/masters/${id}` : `/releases/${id}`)
  );
}

/**
 * Primary label for a Discogs id (fallback when MusicBrainz has none). Skips
 * the "Not On Label" placeholder. Returns a namespace-qualified discogs label id.
 */
export async function getDiscogsLabel(
  qualifiedId: string
): Promise<{ discogsId: string; name: string } | null> {
  const detail = await getDiscogsRelease(qualifiedId);
  const label = detail?.labels?.find((l) => l.name && l.name !== "Not On Label");
  return label ? { discogsId: `label:${label.id}`, name: label.name } : null;
}

/**
 * The ORIGINAL release year for a Discogs id, never a pressing year. A master's
 * own `year` is the original; a specific release (pressing) is followed to its
 * master. A standalone release with no master yields null — its `year` is a
 * pressing and must not be treated as the original. Best-effort.
 */
export async function getDiscogsMasterYear(qualifiedId: string): Promise<number | null> {
  if (!discogsConfigured()) return null;
  const detail = await getDiscogsRelease(qualifiedId);
  if (!detail) return null;
  if (qualifiedId.startsWith("master:")) return detail.year ?? null;
  if (detail.master_id) {
    const master = await getDiscogsRelease(`master:${detail.master_id}`);
    return master?.year ?? null;
  }
  return null;
}

/**
 * Best cover image for an artist + title, via Discogs search. Used as the
 * cover-art fallback when the Cover Art Archive has nothing and the release
 * arrived without a Discogs id (e.g. seeded from a MusicBrainz ref, where the
 * merged search candidate's Discogs cover isn't carried by the mb: ref).
 *
 * Walks the top matching releases and prefers a square-ish image (a real front
 * cover) over sleeve spreads; different pressings of the same release often
 * carry better scans than the first hit. Cached 24h, misses included.
 */
// Loose title identity for the cover walk: case/punctuation-folded, leading
// article stripped ("The End…" ≡ "End…"). Keeps us on pressings of the same
// record and away from unrelated search hits.
function titleMatches(candidateCombined: string, wanted: string): boolean {
  const fold = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/^the /, "");
  // Discogs search titles are "Artist - Title"; match on the title portion.
  const sep = candidateCombined.indexOf(" - ");
  const candidateTitle = sep === -1 ? candidateCombined : candidateCombined.slice(sep + 3);
  return fold(candidateTitle).includes(fold(wanted)) || fold(wanted).includes(fold(candidateTitle));
}

export async function findDiscogsCover(artist: string, title: string): Promise<string | null> {
  if (!discogsConfigured()) return null;
  const key = `discogs:covermatch:v5:${keyPart(artist)}:${keyPart(title)}`;
  return cached(key, DAY, async () => {
    const data = await discogsFetch<DiscogsSearchResponse>(
      `/database/search?type=release&per_page=5&q=${encodeURIComponent(`${artist} ${title}`)}`
    );
    // Only pressings of the record we asked about — never an unrelated hit's art.
    const hits = (data?.results ?? []).filter(
      (r) =>
        (r.type === "master" || r.type === "release") &&
        (r.cover_image || r.thumb) &&
        titleMatches(r.title, title)
    );

    // Strict same-pressing policy: the best-matching pressing's own artwork
    // always wins, even when it's a non-square sleeve spread (the client
    // letterboxes those). Later pressings are consulted ONLY when an earlier
    // one has no images at all.
    for (const hit of hits.slice(0, 3)) {
      const detail = await getDiscogsRelease(`${hit.type}:${hit.id}`);
      const best = pickCoverImage(detail?.images); // this pressing's own front
      if (best) return best.uri;
      // Detail lookup failed or had no images — the search thumbnail is still
      // this same pressing's art.
      if (hit.cover_image || hit.thumb) return hit.cover_image ?? hit.thumb ?? null;
    }
    return null;
  });
}
