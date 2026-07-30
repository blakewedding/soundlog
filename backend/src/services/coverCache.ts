/**
 * The bytes half of the cover proxy: fetch an upstream cover once, re-encode it
 * to WebP at the size actually rendered, keep it on local disk, and hand the
 * file to the route to serve.
 *
 * ## Three outcomes, never two (§1)
 *
 * `ensureVariant` resolves to exactly one of:
 *
 *  - a file      → the rendition, ready to serve
 *  - `null`      → upstream says there is genuinely no image here (404 / other
 *                  definitive 4xx), or the bytes are not a decodable image
 *  - **throws**  → we could not tell (429/5xx/timeout/socket). The caller
 *                  answers 503 + Retry-After and writes NOTHING to disk.
 *
 * The disk cache is populated only on the first outcome, which is what keeps a
 * transient Cover Art Archive failure — measured intermittent 500s, one URL
 * failing four times and succeeding on the fifth — from being frozen into a
 * year-long `immutable` response. A cached "this cover doesn't exist" served
 * for a year is the §1 bug with a CDN behind it.
 *
 * ## The cache is regenerable, and is not a backup concern
 *
 * Every byte here can be rebuilt from `Release.coverUrl`, which Postgres holds
 * and `pg_dump` captures. The directory is deliberately outside the backup
 * strategy (see the README's Backups section) — the same reasoning as
 * Elasticsearch under §5: Postgres is truth, this is a rebuildable derivative.
 * It is size-bounded and swept LRU-style rather than trusted to stay small.
 */
import { createHash } from "node:crypto";
import { readdir, stat, unlink, utimes } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { env } from "../config/env.js";
import { writeFileAtomically } from "./atomicWrite.js";
import { UpstreamUnavailableError } from "./musicbrainzService.js";
import { isDiscoveryCoverUrl } from "./coverProxy.js";
import type { CoverWidth } from "./coverProxy.js";
import {
  ambientTier,
  coverArtGate,
  lowerPriorityOf,
  type UpstreamTier,
} from "./upstreamPriority.js";

/** Same set as `mbFetch`: conditions where the resource may well be fine. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
/** Attempts for a LOOKUP — a specific cover for a release we hold. */
const MAX_ATTEMPTS = 3;
/**
 * Attempts for DISCOVERY — a speculative `release-group/.../front-*` thumbnail
 * for something un-seeded. One, per §7, and then degrade.
 *
 * A discography grid asks for dozens of these at once. Retrying each of them
 * three times turns one bad minute at the archive into a hundred requests that
 * make the bad minute worse, and it is the request class we care least about:
 * the tile keeps its placeholder and the next visit tries again.
 */
const DISCOVERY_ATTEMPTS = 1;
const backoffMs = (attempt: number) => Math.min(300 * 2 ** (attempt - 1), 2000);
/**
 * Generous next to MusicBrainz's timeout, because this transfers megabytes over
 * two redirects — the measured baseline was a 1.8–2.4s TTFB on top of a 2.2 MB
 * body. Too tight a timeout here manufactures the exact retryable failures §1
 * then has to protect us from.
 */
const FETCH_TIMEOUT_MS = 12_000;
/** A cover is not 30 MB. Anything claiming to be isn't artwork we will serve. */
const MAX_UPSTREAM_BYTES = 30 * 1024 * 1024;

const WEBP_QUALITY = 80;
/** Refuse absurd pixel dimensions before sharp allocates for them. */
const MAX_INPUT_PIXELS = 50_000_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The cache root, read through a function rather than captured at import.
 *
 * `env` is parsed once at module load, so a test that wants its own directory
 * cannot get one by setting an environment variable — and tests sharing one
 * cache directory is exactly the kind of cross-file coupling that produces a
 * suite which passes alone and fails together. `__resetCoverCacheState(dir)` is
 * the seam.
 */
let cacheRoot = env.COVER_CACHE_DIR;
export function coverCacheDir(): string {
  return cacheRoot;
}

export interface CoverVariant {
  /** Absolute path of the cached WebP rendition. */
  file: string;
  bytes: number;
  /** True when it was already on disk — surfaced as `X-Cover-Cache`. */
  hit: boolean;
  /** Stable content-derived ETag, unaffected by LRU mtime touches. */
  etag: string;
}

/** In-flight renders, so a burst for one cover fetches upstream exactly once. */
const inFlight = new Map<string, Promise<CoverVariant | null>>();

function cacheKey(upstreamUrl: string): string {
  return createHash("sha256").update(upstreamUrl).digest("hex");
}

/**
 * Shard on the first two hex characters. A single flat directory with five
 * renditions of every cover in a growing catalog is a directory listing nobody
 * wants to be holding when it matters.
 */
function variantPath(upstreamUrl: string, width: CoverWidth): string {
  const key = cacheKey(upstreamUrl);
  return path.join(coverCacheDir(), `w${width}`, key.slice(0, 2), `${key}.webp`);
}

export interface EnsureVariantOptions {
  /**
   * The caller knows this artwork is speculative — nobody has asked for it, and
   * nothing is blocked on it. Forces `DISCOVERY_ATTEMPTS` (§7: one attempt).
   *
   * ## Why the URL shape cannot decide this on its own
   *
   * `isDiscoveryCoverUrl` keys off `/release-group/<id>/front[-N]`, which is what
   * a speculative discography TILE looks like. But `getCoverArtUrls` resolves to
   * the archive's actual image URLs, shaped `/release/<id>/<image>-500.jpg` — so
   * artwork the 6.2e warm sweep fetches for release-groups we hold **no row for**
   * was being classified as a lookup and retried three times. Observed live
   * during the first warm run: `[covers] HTTP 500 … (attempt 1/3) — retrying`.
   *
   * Broadening the URL rule to match `/release/…` would be the wrong fix: that is
   * exactly the shape of a stored `coverUrl` for a release we DO hold, where a
   * person is looking at the page and retrying is right. The URL genuinely cannot
   * tell the two apart — only the caller can, so the caller says so.
   */
  speculative?: boolean;
}

/**
 * The cached WebP rendition of `upstreamUrl` at `width`, fetching and rendering
 * it if this is the first ask. See the header for the three outcomes.
 */
export function ensureVariant(
  upstreamUrl: string,
  width: CoverWidth,
  { speculative = false }: EnsureVariantOptions = {}
): Promise<CoverVariant | null> {
  const file = variantPath(upstreamUrl, width);
  // Keyed by rendition, so a speculative warm and a real request for the same
  // cover share one fetch. First caller's effort policy wins, which is the
  // harmless direction: the sweep runs first and alone, and a person arriving
  // mid-flight gets the bytes rather than a second request for them.
  const existing = inFlight.get(file);
  if (existing) return existing;

  const job = renderVariant(upstreamUrl, width, file, speculative).finally(() =>
    inFlight.delete(file)
  );
  inFlight.set(file, job);
  return job;
}

async function renderVariant(
  upstreamUrl: string,
  width: CoverWidth,
  file: string,
  speculative = false
): Promise<CoverVariant | null> {
  const key = cacheKey(upstreamUrl);
  const cached = await stat(file).catch(() => null);
  if (cached?.isFile()) {
    touchForLru(file, cached.mtimeMs);
    return { file, bytes: cached.size, hit: true, etag: etagFor(key, width, cached.size) };
  }

  const source = await fetchUpstreamImage(upstreamUrl, speculative);
  if (!source) return null;

  let encoded: Buffer;
  try {
    encoded = await sharp(source, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "none" })
      // EXIF orientation, honoured before the resize so a rotated scan doesn't
      // come out sideways at every size.
      .rotate()
      // `inside`, never `cover`: cassette J-card spreads and gatefold scans are
      // legitimately non-square, and the web client already letterboxes them
      // (CoverImage detects the ratio). Cropping here would bake an
      // unrecognisable centre crop into the cache.
      .resize(width, width, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY, effort: 4 })
      .toBuffer();
  } catch (err) {
    // Undecodable bytes are a definitive property of what upstream served, not
    // a "try again" — `failOn: "none"` already tolerates truncation, so this is
    // genuinely not an image. Absent, not unavailable.
    console.warn(`[covers] undecodable image at ${upstreamUrl}: ${(err as Error).message}`);
    return null;
  }

  await writeFileAtomically(file, encoded);
  scheduleSweep();

  return { file, bytes: encoded.byteLength, hit: false, etag: etagFor(key, width, encoded.byteLength) };
}

/** Content-derived: the upstream URL fixes the bytes, and the width fixes the render. */
function etagFor(key: string, width: CoverWidth, bytes: number): string {
  return `"${key.slice(0, 16)}-${width}-${bytes.toString(16)}"`;
}

/**
 * Fetch the upstream image. Returns null on a definitive absence, throws
 * `UpstreamUnavailableError` when we could not tell — never the other way
 * round, which is the whole of §1.
 */
/**
 * The three §1 outcomes, as a value — so the whole decision can be made INSIDE
 * the concurrency slot (where the body is read) and acted on outside it.
 */
type UpstreamImageOutcome =
  | { kind: "body"; body: Buffer }
  | { kind: "absent" }
  | { kind: "retryable"; problem: string };

async function fetchUpstreamImage(url: string, speculative = false): Promise<Buffer | null> {
  let lastProblem = "unknown";
  const discovery = isDiscoveryCoverUrl(url);
  // Either signal is enough to make this one attempt. The URL shape catches a
  // speculative discography tile; `speculative` catches the case the URL cannot
  // express — see EnsureVariantOptions.
  const maxAttempts = discovery || speculative ? DISCOVERY_ATTEMPTS : MAX_ATTEMPTS;
  // The same split 6.1.2 drew for RETRIES now also decides ORDER (6.1.4): a
  // speculative `release-group/<mbid>/front-*` tile for something nobody has
  // seeded is `browse`, while a stored coverUrl for a release we hold is a
  // person looking at a page. Both ride one shared budget, because they are the
  // same host — 37 of the former is what made the latter take 18 seconds.
  // …but never a HIGHER tier than the surrounding context allows: the pre-warmer
  // fetching a stored coverUrl is still the pre-warmer, and must not take an
  // interactive slot just because the URL shape looks like a lookup.
  const tier: UpstreamTier = lowerPriorityOf(
    ambientTier(),
    discovery ? "browse" : "interactive"
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let outcome: UpstreamImageOutcome;
    try {
      // The slot is held across the BODY READ, not merely the headers. `fetch`
      // resolves the moment headers arrive, and for an image essentially all of
      // the bytes and all of the time are in the body — releasing at headers
      // would bound how many requests are open while leaving the transfer
      // itself completely unbounded, which is the thing being fixed.
      //
      // The retry backoff below deliberately sleeps OUTSIDE the gate: holding a
      // slot while waiting to try again would starve callers for no work.
      outcome = await coverArtGate.run(tier, async (): Promise<UpstreamImageOutcome> => {
        const res = await fetch(url, {
          headers: { "User-Agent": env.MUSICBRAINZ_USER_AGENT, Accept: "image/*" },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          redirect: "follow",
        });

        if (res.ok) {
          const declared = Number(res.headers.get("content-length") ?? 0);
          if (declared > MAX_UPSTREAM_BYTES) {
            console.warn(`[covers] ${url} declares ${declared} bytes — refusing`);
            return { kind: "absent" };
          }
          const body = Buffer.from(await res.arrayBuffer());
          if (body.byteLength > MAX_UPSTREAM_BYTES) {
            console.warn(`[covers] ${url} delivered ${body.byteLength} bytes — refusing`);
            return { kind: "absent" };
          }
          if (body.byteLength === 0) {
            // A 200 with no body is not an image; treat as absent rather than
            // caching an empty rendition.
            console.warn(`[covers] ${url} returned an empty body`);
            return { kind: "absent" };
          }
          return { kind: "body", body };
        }

        if (!RETRYABLE_STATUS.has(res.status)) return { kind: "absent" }; // 404: no art here
        return { kind: "retryable", problem: `HTTP ${res.status}` };
      });
    } catch (err) {
      // A dropped socket or a timeout says nothing about whether the artwork
      // exists. This is the failure that used to 500 an already-seeded release
      // when an unguarded fetch threw `TypeError: fetch failed`.
      lastProblem = `network error: ${(err as Error).message}`;
      if (attempt < maxAttempts) await sleep(backoffMs(attempt));
      continue;
    }

    if (outcome.kind === "body") return outcome.body;
    if (outcome.kind === "absent") return null;

    lastProblem = outcome.problem;
    console.warn(
      `[covers] ${lastProblem} on ${url} (attempt ${attempt}/${maxAttempts})` +
        (attempt < maxAttempts ? " — retrying" : " — giving up")
    );
    if (attempt < maxAttempts) await sleep(backoffMs(attempt));
  }

  // Still an UpstreamUnavailableError, not a 404: one attempt is a policy about
  // how hard we try, never a claim that the artwork is absent. The route answers
  // 503 + no-store, the tile keeps its placeholder, and a later visit retries.
  throw new UpstreamUnavailableError(
    "coverart",
    `Cover art upstream unavailable after ${maxAttempts} attempt(s) (${lastProblem}): ${url}`
  );
}

/**
 * Keep an LRU signal without a write on every hit: only refresh mtime when it
 * is more than a day stale. Cheap enough to be free, recent enough that the
 * sweeper evicts genuinely cold renditions rather than unlucky ones.
 */
const TOUCH_AFTER_MS = 24 * 60 * 60 * 1000;
function touchForLru(file: string, mtimeMs: number): void {
  if (Date.now() - mtimeMs < TOUCH_AFTER_MS) return;
  const now = new Date();
  void utimes(file, now, now).catch(() => {
    /* a cache whose mtime won't update still serves — not worth a log line */
  });
}

// ---- Size bound ----------------------------------------------------------
//
// Disk discipline: the cache is bounded and swept, never trusted to stay small.
// A crawler walking every release at every width is the normal way an unbounded
// image cache fills a disk, and this box also holds Postgres.

/** Sweep after this many writes rather than on a timer — work follows growth. */
const SWEEP_EVERY_WRITES = 100;
/** Sweep down to this fraction of the bound, so it isn't re-triggered at once. */
const SWEEP_TARGET = 0.9;

let writesSinceSweep = 0;
let sweeping = false;

function scheduleSweep(): void {
  if (++writesSinceSweep < SWEEP_EVERY_WRITES) return;
  writesSinceSweep = 0;
  void sweepCache().catch((err) =>
    console.warn(`[covers] cache sweep failed: ${(err as Error).message}`)
  );
}

interface CacheEntry {
  file: string;
  bytes: number;
  mtimeMs: number;
}

/**
 * Evict least-recently-used renditions until the cache is back under the bound.
 * Returns what it did, which is what makes it usable as an ops command as well
 * as a background sweep.
 */
export async function sweepCache(
  maxBytes = env.COVER_CACHE_MAX_BYTES
): Promise<{ totalBytes: number; files: number; evicted: number; freedBytes: number }> {
  if (sweeping) return { totalBytes: 0, files: 0, evicted: 0, freedBytes: 0 };
  sweeping = true;
  try {
    const entries = await listCache(coverCacheDir());
    const totalBytes = entries.reduce((n, e) => n + e.bytes, 0);
    if (totalBytes <= maxBytes) {
      return { totalBytes, files: entries.length, evicted: 0, freedBytes: 0 };
    }

    entries.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first
    const target = maxBytes * SWEEP_TARGET;
    let remaining = totalBytes;
    let evicted = 0;
    let freedBytes = 0;

    for (const entry of entries) {
      if (remaining <= target) break;
      try {
        await unlink(entry.file);
        remaining -= entry.bytes;
        freedBytes += entry.bytes;
        evicted += 1;
      } catch {
        // Already gone, or not ours to remove — either way, skip it.
      }
    }

    console.log(
      `[covers] swept ${evicted} renditions (${(freedBytes / 1e6).toFixed(1)} MB) — ` +
        `${(remaining / 1e6).toFixed(1)} MB of ${(maxBytes / 1e6).toFixed(0)} MB in use`
    );
    return { totalBytes, files: entries.length, evicted, freedBytes };
  } finally {
    sweeping = false;
  }
}

async function listCache(dir: string): Promise<CacheEntry[]> {
  const out: CacheEntry[] = [];
  const walk = async (current: string): Promise<void> => {
    const dirents = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const dirent of dirents) {
      const full = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        await walk(full);
      } else if (dirent.isFile() && dirent.name.endsWith(".webp")) {
        const info = await stat(full).catch(() => null);
        if (info) out.push({ file: full, bytes: info.size, mtimeMs: info.mtimeMs });
      }
    }
  };
  await walk(dir);
  return out;
}

/** Current cache footprint, for the ops runbook and `/api/health` curiosity. */
export async function cacheStats(): Promise<{ files: number; bytes: number; maxBytes: number }> {
  const entries = await listCache(coverCacheDir());
  return {
    files: entries.length,
    bytes: entries.reduce((n, e) => n + e.bytes, 0),
    maxBytes: env.COVER_CACHE_MAX_BYTES,
  };
}

/** Test seam: drop in-flight state between cases. */
export function __resetCoverCacheState(dir?: string): void {
  inFlight.clear();
  writesSinceSweep = 0;
  if (dir) cacheRoot = dir;
}
