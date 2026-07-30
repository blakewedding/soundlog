/**
 * Artist pre-warming — Phase 6.2e, the anticipation half for artists we do NOT
 * hold yet.
 *
 * `prewarmService` finishes releases already in the catalog. This is its sibling
 * for the opposite population: the artists a stranger will look for on their
 * first visit, none of whom we hold at launch. A cold artist with a large
 * discography is measurably the worst experience the product has — verified on
 * the phone 2026-07-29, where warm artists (The Cure, Zappa) scrolled fluidly
 * and a fully cold John Coltrane visibly lagged the scroll.
 *
 * ## It creates NOTHING
 *
 * This is the whole reason it is allowed to exist. The obvious reading of
 * "pre-warm popular artists" is "bulk-seed their releases", which would overturn
 * `discographyService`'s "nothing is bulk-seeded" law and spend ~13 minutes of
 * MusicBrainz throttle per artist on records nobody has opened. It does neither.
 * Every layer below is a CACHE:
 *
 *   mb:artist:search:<name>        the search box's last keystroke
 *   mb:rg:search:<name>            the same query's album hits
 *   mb:artist:v2:<mbid>            the click that materializes the Artist row
 *   mb:artist:discography:<mbid>   the grid itself
 *   caa:rg:urls:<mbid> + w200 renditions on disk   the tiles
 *
 * With those warm, a stranger's path is: search (Redis), click (a Postgres write
 * with no upstream call, because `materializeArtistByMbid` reads `lookupArtist`
 * which is cached), grid (Redis), tiles (our own disk). No Release row is
 * created, no Artist row is created, and the Artist row is still born from the
 * click exactly as it is today.
 *
 * Not pre-creating the Artist row is deliberate and load-bearing, not laziness:
 * `searchArtists` computes `releaseCount` as a live count for SEEDED artists, so
 * an Artist row with no releases returns 0, and `Search.tsx` renders 0 as
 * "0 releases" — which its own comment calls a dead end — where `null` renders
 * "Not in the catalog yet — open to add". Materializing the list would turn every
 * invitation on it into a row that looks broken.
 *
 * ## Why nightly, and why that is not the same as often
 *
 * Every MusicBrainz cache in `musicbrainzService` has a 7-day TTL, so there is no
 * such thing as warming something once: a run tonight is fully cold again in a
 * week. Rather than a weekly 30-minute cliff, this refreshes only what is inside
 * `REFRESH_WINDOW_SECONDS` of expiring — with a 7-day TTL and a nightly sweep
 * that is naturally about a seventh of the list per night, a few minutes of
 * `background`-tier gate time instead of half an hour.
 *
 * Warming is idempotent for free: every layer goes through `cached()`, so a
 * target that is already warm costs Redis GETs and no upstream call at all. The
 * TTL selection exists to bound how much REAL work a night can start, not to
 * avoid harmless repetition.
 *
 * ## Failure is always the next night's problem
 *
 * Nothing here is anyone's dependency. A layer that throws is recorded in
 * `lastResult` and skipped; because `cached()` never writes on a throw (§2), a
 * failed discography assembly simply is not cached, and the next sweep retries
 * it. A definitive empty answer IS cached (§1) and correctly stops being retried.
 */
import { env } from "../config/env.js";
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { ttlOf } from "./cache.js";
import { runAtTier } from "./upstreamPriority.js";
import { COVER_THUMB_WIDTH } from "./coverProxy.js";
import { ensureVariant } from "./coverCache.js";
import { coverPrefetchSet } from "./discographyService.js";
import {
  getArtistDiscography,
  getCoverArtUrls,
  lookupArtist,
  searchMusicBrainzArtists,
  searchReleaseGroups,
  discographyCacheKey,
} from "./musicbrainzService.js";

/**
 * How close to expiry a target must be before tonight's sweep refreshes it.
 * 26 hours rather than 24: a nightly timer drifts, and a target that expires 25
 * hours from now would otherwise be missed tonight and be cold for an hour
 * tomorrow before the sweep reaches it.
 */
const REFRESH_WINDOW_SECONDS = 26 * 60 * 60;

/** Guards against two overlapping sweeps in one process. */
let sweeping = false;

/**
 * A cross-process claim, in Redis so it is honest under the §7a topology the
 * project warns about rather than silently assuming one process. Short-lived: it
 * is a concurrency guard, NOT a memory of having tried — the TTL selection above
 * is what stops needless re-warming, and a failed target must stay retryable.
 */
const SWEEP_LOCK_KEY = "warm:sweep:lock";
const SWEEP_LOCK_SECONDS = 60 * 30;

export interface WarmLayerResult {
  /** Layers that did real upstream work or confirmed a warm cache. */
  warmed: string[];
  /** Layers that threw. Recorded, never fatal. */
  failed: string[];
  /** Release-groups in the discography, once known. */
  releaseGroups: number | null;
  /** Cover renditions confirmed on disk afterwards. */
  covers: number;
}

export interface WarmTargetOutcome extends WarmLayerResult {
  artistMbid: string;
  name: string;
}

export interface WarmSweepResult {
  /** Enabled targets inspected. */
  considered: number;
  /** Targets that needed warming and were attempted. */
  attempted: WarmTargetOutcome[];
  /** Targets already warm beyond the refresh window. */
  skipped: number;
  /** True when another sweep held the lock and this one did nothing. */
  lockedOut: boolean;
}

/**
 * Whether this target needs work tonight.
 *
 * The discography key is the bellwether. It is the expensive layer, and every
 * layer for a given target is written in the same sweep, so they expire together
 * — checking one is checking all of them, and checking the costly one means a
 * cheap layer can never drag a whole artist into an unnecessary refresh.
 */
async function needsWarming(artistMbid: string): Promise<boolean> {
  const ttl = await ttlOf(discographyCacheKey(artistMbid));
  return ttl === null || ttl < REFRESH_WINDOW_SECONDS;
}

/**
 * Warm one artist. Every layer is individually fault-isolated — an upstream
 * having a bad day must not cost us the layers that would have succeeded.
 */
export async function warmTarget(artistMbid: string, name: string): Promise<WarmTargetOutcome> {
  const result: WarmTargetOutcome = {
    artistMbid,
    name,
    warmed: [],
    failed: [],
    releaseGroups: null,
    covers: 0,
  };

  const layer = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
      result.warmed.push(label);
    } catch (err) {
      result.failed.push(label);
      console.warn(`[warm] ${name} — ${label} failed:`, (err as Error).message);
    }
  };

  // The identity layers first: they are one request each, and if MusicBrainz dies
  // partway through this artist we would rather hold the cheap wins than nothing.
  //
  // Searching by the target's own name warms the exact key the search box will
  // ask for. It does NOT warm prefixes — "radioh" is a different key, and
  // as-you-type will still fan out for it. That is a known and deliberate limit
  // of this job; the fix is a prefix-capable artist index, filed separately.
  await layer("search.artist", async () => {
    await searchMusicBrainzArtists(name);
  });
  await layer("search.releaseGroup", async () => {
    await searchReleaseGroups(name);
  });
  await layer("artist.lookup", async () => {
    await lookupArtist(artistMbid);
  });

  // The expensive layer, and the one that makes a cold Coltrane feel like a warm
  // Cure. Costs ceil(release-groups / 100) throttled requests on a miss, nothing
  // on a hit.
  let entries: Awaited<ReturnType<typeof getArtistDiscography>> = [];
  await layer("discography", async () => {
    entries = await getArtistDiscography(artistMbid);
    result.releaseGroups = entries.length;
  });

  // Covers last, because they depend on the discography's entries, and warming
  // the DATA without the TILES would leave the scroll-lag exactly where it was —
  // what lagged on the phone was artwork, not metadata.
  //
  // The set is `coverPrefetchSet`, the same rule the discography page itself
  // prefetches with, so we warm precisely what the default view asks for.
  if (entries.length) {
    await layer("covers", async () => {
      const worthwhile = coverPrefetchSet(entries);
      const settled = await Promise.allSettled(
        worthwhile.map(async (e) => {
          const urls = await getCoverArtUrls(e.mbid, "background");
          // `null` is a legitimate answer — plenty of release-groups genuinely
          // have no artwork on file (§1) — and is not a failure to record.
          if (!urls?.thumb) return false;
          // Warming the rendition, not just the URL: the URL alone still leaves
          // the visitor's first tile paying a fetch-and-encode. `ensureVariant`
          // returns null rather than throwing when the bytes cannot be had.
          const variant = await ensureVariant(urls.thumb, COVER_THUMB_WIDTH);
          return variant !== null;
        })
      );
      result.covers = settled.filter((s) => s.status === "fulfilled" && s.value).length;
    });
  }

  return result;
}

/**
 * One sweep, entirely at the `background` tier so every upstream call it makes
 * yields to any click or browse arriving while it works.
 *
 * Sequential across targets on purpose, for `prewarmService`'s reason: the
 * MusicBrainz gate serialises them anyway, and going one at a time keeps the
 * queue shallow enough that an arriving interactive call waits for at most the
 * one slot already in flight.
 */
export interface WarmSweepOptions {
  batchSize?: number;
  /**
   * Restrict the sweep to these artist MBIDs. Omitted, it sweeps the whole
   * enabled list, which is the production behaviour.
   *
   * Two callers want this and both are legitimate. An operator re-warming a
   * single artist after a failure should not have to wait behind the list
   * (`warm-run.ts --only <mbid>`); and a test must be able to sweep its own
   * fixtures without touching real rows.
   *
   * The second is not a hypothetical convenience. Without it, fixtures ordered
   * below 490 real targets meant a stubbed test sweep warmed **The Beatles, Led
   * Zeppelin and 18 others**, caching `[]` as their discography and `{}` as
   * their artist lookup for seven days — the poisoned-cache failure this phase
   * had just finished fixing elsewhere, reintroduced from the test side. A
   * scoping rule that depends on getting a batch size right is a rule that will
   * be got wrong; this one cannot select a row the caller did not name.
   */
  only?: string[];
  /**
   * Reported per target as it finishes. Exists for the operator script: the
   * first run against a cold list is half an hour of work someone is sitting
   * and watching, and a job that prints one line at the end is indistinguishable
   * from a hung one. Same idiom as `getArtistDiscography`'s progress callback.
   */
  onProgress?: (outcome: WarmTargetOutcome, done: number, total: number) => void;
}

export async function warmOnce({
  batchSize = env.WARM_BATCH_SIZE,
  only,
  onProgress,
}: WarmSweepOptions = {}): Promise<WarmSweepResult> {
  const result: WarmSweepResult = { considered: 0, attempted: [], skipped: 0, lockedOut: false };

  if (sweeping) {
    result.lockedOut = true;
    return result;
  }
  const claimed = await redis.set(SWEEP_LOCK_KEY, "1", "EX", SWEEP_LOCK_SECONDS, "NX");
  if (claimed !== "OK") {
    result.lockedOut = true;
    return result;
  }
  sweeping = true;

  try {
    const targets = await prisma.warmTarget.findMany({
      where: { enabled: true, ...(only ? { artistMbid: { in: only } } : {}) },
      orderBy: [{ weight: "desc" }, { name: "asc" }],
      select: { id: true, artistMbid: true, name: true },
    });
    result.considered = targets.length;

    // Counted up front so progress can be reported against a real denominator —
    // "3/412" is a job you can wait for, "3 so far" is not.
    const due: typeof targets = [];
    for (const t of targets) {
      if (await needsWarming(t.artistMbid)) due.push(t);
      else result.skipped++;
    }
    const plan = due.slice(0, batchSize);

    for (const target of plan) {
      const outcome = await runAtTier("background", () =>
        warmTarget(target.artistMbid, target.name)
      );
      result.attempted.push(outcome);
      onProgress?.(outcome, result.attempted.length, plan.length);

      // `lastWarmedAt` records the ATTEMPT and `lastResult` the OUTCOME, kept
      // apart for 6.1.5's reason: a sweep that fixes nothing logs identically to
      // one that fixes everything unless the two are recorded separately.
      await prisma.warmTarget.update({
        where: { id: target.id },
        data: {
          lastWarmedAt: new Date(),
          lastResult: outcome.failed.length
            ? `failed: ${outcome.failed.join(",")} (warmed ${outcome.warmed.join(",") || "none"})`
            : `ok: ${outcome.releaseGroups ?? 0} release-groups, ${outcome.covers} covers`,
        },
      });
    }
  } finally {
    sweeping = false;
    await redis.del(SWEEP_LOCK_KEY).catch(() => {});
  }

  return result;
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the periodic sweep, if configured on. Returns whether it started.
 *
 * Disabled by default (`WARM_INTERVAL_MINUTES=0`) so no test run, CI job or
 * laptop makes unattended upstream calls — same discipline as `startPrewarming`,
 * and for the same reason.
 *
 * `setInterval` has NO leading call, so the first sweep is one interval after
 * boot rather than at boot. That is 6.1.5's lesson stated in code: a verification
 * plan that says "check immediately after deploy" is unfalsifiable against this
 * shape. The operator script (`scripts/warm-run.ts`) exists so the first run is a
 * command someone watches, not a timer someone waits for.
 */
export function startWarming(): boolean {
  if (timer || env.WARM_INTERVAL_MINUTES <= 0) return false;

  timer = setInterval(() => {
    void warmOnce({})
      .then((r) => {
        if (r.lockedOut) return console.warn("[warm] sweep skipped — another sweep holds the lock");
        if (r.attempted.length) {
          const groups = r.attempted.reduce((n, a) => n + (a.releaseGroups ?? 0), 0);
          const covers = r.attempted.reduce((n, a) => n + a.covers, 0);
          const failed = r.attempted.filter((a) => a.failed.length).length;
          console.log(
            `[warm] warmed ${r.attempted.length} artist(s), ${groups} release-groups, ` +
              `${covers} covers, ${failed} with failures, ${r.skipped} still warm`
          );
        }
      })
      .catch((err) => console.warn("[warm] sweep failed:", (err as Error).message));
  }, env.WARM_INTERVAL_MINUTES * 60_000);
  // Never hold the process open for a background nicety.
  timer.unref?.();

  console.log(`[warm] artist pre-warming every ${env.WARM_INTERVAL_MINUTES}m`);
  return true;
}

/** Stop the periodic sweep. Used by tests and graceful shutdown. */
export function stopWarming(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
