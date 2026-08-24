// Phase 5.6 — an artist's full observable discography from MusicBrainz, merged
// with whatever we already hold locally.
//
// Two rules shape this file:
//   1. Matching a MusicBrainz release-group to a local Release is by MBID ONLY.
//      No name-based guessing — that is exactly what produced the 5.8 duplicate
//      mess. MusicBrainz artist identity is canonical.
//   2. Nothing is bulk-seeded. Un-seeded entries render straight from MB data;
//      a row is created only when a user clicks through (see the releases route).
import type { ReleaseType } from "@prisma/client";
import { prisma } from "../config/database.js";
import { peekCached } from "./cache.js";
import { mapReleaseGroupType } from "./catalog/typeMapping.js";
import {
  getArtistDiscography,
  getCoverArtUrls,
  discographyCacheKey,
  type MBDiscographyEntry,
  type DiscographyProgress,
} from "./musicbrainzService.js";

export interface DiscographyEntry {
  /** Release-group MBID — the join key against local rows, and the seed ref. */
  mbid: string;
  title: string;
  /** Release-group first-release-date year. Never a pressing date (3.6 policy). */
  year: string | null;
  type: ReleaseType;
  disambiguation?: string;
  /** Present once the release exists locally; null while un-seeded. */
  releaseId: string | null;
  seeded: boolean;
  coverUrl: string | null;
  avgRating: number | null;
  ratingCount: number;
  /** The viewer's own rating, when signed in and the release is seeded. */
  myRating: number | null;
}

export interface DiscographyGroup {
  key: string;
  label: string;
  entries: DiscographyEntry[];
}

// The display grouping. Order here is the order the page renders them in.
const GROUPS: Array<{ key: string; label: string }> = [
  { key: "albums", label: "Albums" },
  { key: "eps", label: "EPs" },
  { key: "singles", label: "Singles" },
  { key: "mixes", label: "Mixtapes & DJ Mixes" },
  { key: "compilations", label: "Compilations" },
  { key: "live", label: "Live" },
  { key: "other", label: "Other" },
];

/**
 * Which display group a release-group belongs to. "Live" is checked first
 * because MusicBrainz models it as a SECONDARY type on an otherwise ordinary
 * album ("Live" + primary "Album"), and the spec gives live records their own
 * shelf. Everything else defers to the shared type mapping.
 */
export function groupKeyFor(entry: MBDiscographyEntry): string {
  if (entry.secondaryTypes.some((t) => t.toLowerCase() === "live")) return "live";

  const type = mapReleaseGroupType(entry.primaryType, entry.secondaryTypes);
  switch (type) {
    case "ALBUM":
      return "albums";
    case "EP":
      return "eps";
    case "SINGLE":
    case "SONG":
      return "singles";
    case "MIXTAPE":
    case "DJ_MIX":
      return "mixes";
    case "COMPILATION":
      return "compilations";
    default:
      return "other";
  }
}

/** Chronological within a group; undated entries sort last, then by title. */
function byReleaseDate(a: DiscographyEntry, b: DiscographyEntry): number {
  if (a.year && b.year && a.year !== b.year) return a.year.localeCompare(b.year);
  if (a.year && !b.year) return -1;
  if (!a.year && b.year) return 1;
  return a.title.localeCompare(b.title);
}

/**
 * Merge the MusicBrainz discography with local catalog rows, keyed by MBID, and
 * bucket it into display groups. Seeded entries carry cover art, the community
 * rating, and the viewer's rating; un-seeded entries carry MB data alone.
 */
export async function mergeDiscography(
  mbEntries: MBDiscographyEntry[],
  viewerId?: string
): Promise<DiscographyGroup[]> {
  const mbids = mbEntries.map((e) => e.mbid);

  const localRows = mbids.length
    ? await prisma.release.findMany({
        where: { musicbrainzId: { in: mbids } },
        select: { id: true, musicbrainzId: true, coverUrl: true },
      })
    : [];
  const localByMbid = new Map(
    localRows.filter((r) => r.musicbrainzId).map((r) => [r.musicbrainzId as string, r])
  );
  const releaseIds = localRows.map((r) => r.id);

  const [aggregates, myRatings] = await Promise.all([
    releaseIds.length
      ? prisma.rating.groupBy({
          by: ["releaseId"],
          where: { releaseId: { in: releaseIds } },
          _avg: { value: true },
          _count: { value: true },
        })
      : Promise.resolve([]),
    viewerId && releaseIds.length
      ? prisma.rating.findMany({
          where: { userId: viewerId, releaseId: { in: releaseIds } },
          select: { releaseId: true, value: true },
        })
      : Promise.resolve([]),
  ]);
  const aggByRelease = new Map(
    aggregates.map((a) => [a.releaseId, { avg: a._avg.value, count: a._count.value }])
  );
  const mineByRelease = new Map(myRatings.map((r) => [r.releaseId, r.value]));

  const buckets = new Map<string, DiscographyEntry[]>(GROUPS.map((g) => [g.key, []]));

  for (const mb of mbEntries) {
    const local = localByMbid.get(mb.mbid);
    const agg = local ? aggByRelease.get(local.id) : undefined;
    const entry: DiscographyEntry = {
      mbid: mb.mbid,
      title: mb.title,
      year: mb.firstReleaseDate?.slice(0, 4) || null,
      type: mapReleaseGroupType(mb.primaryType, mb.secondaryTypes),
      disambiguation: mb.disambiguation,
      releaseId: local?.id ?? null,
      seeded: Boolean(local),
      coverUrl: local?.coverUrl ?? null,
      avgRating: agg?.avg ?? null,
      ratingCount: agg?.count ?? 0,
      myRating: local ? mineByRelease.get(local.id) ?? null : null,
    };
    (buckets.get(groupKeyFor(mb)) ?? buckets.get("other")!).push(entry);
  }

  return GROUPS.map((g) => ({
    ...g,
    entries: (buckets.get(g.key) ?? []).sort(byReleaseDate),
  })).filter((g) => g.entries.length > 0);
}

// ---------------------------------------------------------------------------
// Progressive assembly.
//
// A prolific artist costs one throttled MusicBrainz request per 100 release
// groups, so the first-ever fetch can take several seconds. Rather than block
// the request, the first call kicks assembly off in the background and reports
// progress; the client polls until it completes. Once cached (7d) it's instant.
// ---------------------------------------------------------------------------

interface Assembly {
  progress: DiscographyProgress;
  error?: unknown;
  promise: Promise<unknown>;
  /** Heartbeat: when this assembly last made real progress (a page landed). */
  lastProgressAt: number;
}
const inFlight = new Map<string, Assembly>();

/**
 * How long an assembly may make NO progress before it is declared stalled.
 *
 * ## The wedge this closes (6.3e)
 *
 * Bob Dylan's page (1,192 release-groups = 12 browse pages) froze at
 * "Fetching from MusicBrainz — 200 of 1192" and stayed there. The assembly runs
 * at the `browse` tier; under sustained interactive load, strict priority meant
 * page 3 never won a slot. `onProgress` never fired again, the `Assembly` carried
 * no error because nothing had failed, and so every poll answered
 * `{ status: "assembling" }` — forever. "In progress" was a state with no exit.
 *
 * Priority ageing (`upstreamPriority.ts`) removes the cause. This is the
 * backstop, and it exists because §1's three outcomes have to hold for JOBS the
 * same way they hold for fetches: pending, complete and failed are distinct, and
 * "pending" must be a state a job can LEAVE. Anything that stops progressing is
 * failed, whatever the reason.
 *
 * 90s is far longer than any legitimate gap: one page costs ~1.1s at the
 * MusicBrainz rate, plus at most one ageing threshold (15s) of queueing. A
 * ninety-second silence is not slowness, it is a stall.
 */
const ASSEMBLY_STALL_MS = 90_000;

/** Thrown at the poller when an assembly stops making progress. */
export class DiscographyStalledError extends Error {
  constructor(artistMbid: string, public readonly progress: DiscographyProgress) {
    super(
      `discography assembly for ${artistMbid} stalled at ` +
        `${progress.fetched}/${progress.total ?? "?"} — no progress for ${ASSEMBLY_STALL_MS}ms`
    );
    this.name = "DiscographyStalledError";
  }
}

/**
 * In-flight assembly count and the age of the oldest one.
 *
 * "Oldest job age" is the metric that would have surfaced the Dylan wedge
 * without anyone having to be looking at the page: an assembly whose age keeps
 * climbing while its progress does not is the wedge, by definition. Exposed on
 * `/api/health/upstream` so a probe can see it.
 */
export function assemblyStats(): {
  inFlight: number;
  oldestAgeMs: number;
  stalledSinceMs: number;
} {
  const now = Date.now();
  let oldestAge = 0;
  let worstSilence = 0;
  for (const state of inFlight.values()) {
    const silence = now - state.lastProgressAt;
    if (silence > worstSilence) worstSilence = silence;
    if (silence > oldestAge) oldestAge = silence;
  }
  return { inFlight: inFlight.size, oldestAgeMs: oldestAge, stalledSinceMs: worstSilence };
}

export type DiscographyState =
  | { status: "complete"; entries: MBDiscographyEntry[] }
  | {
      status: "assembling";
      progress: DiscographyProgress;
      /**
       * How long this assembly has gone without a page landing.
       *
       * Measured live against Bob Dylan (1,192 groups / 12 pages) while
       * MusicBrainz was degraded: the assembly completed in 49.5s but sat at
       * 67% for **20.5 seconds** with no progress while page 9 was retried.
       * That gap is the entire reported "stall" — the job was healthy and the
       * UI had no way to say so, because a progress bar that has not moved
       * looks identical whether the work is retrying or dead.
       *
       * The watchdog is the answer to a job that has genuinely stopped; this is
       * the answer to one that is merely slow, and the two need different words.
       */
      stalledForMs: number;
    };

/**
 * Cached discography, or an in-progress assembly with live progress.
 * A failed assembly is surfaced (thrown) to the NEXT caller and cleared, so the
 * client gets a retry-able error instead of polling a dead job forever.
 */
export async function getDiscographyState(artistMbid: string): Promise<DiscographyState> {
  const hit = await peekCached<MBDiscographyEntry[]>(discographyCacheKey(artistMbid));
  if (hit) return { status: "complete", entries: hit };

  const existing = inFlight.get(artistMbid);
  if (existing) {
    if (existing.error) {
      inFlight.delete(artistMbid); // let the next attempt start fresh
      throw existing.error;
    }

    // The watchdog. Evaluated on the POLL rather than on a timer deliberately:
    // a timer per assembly is a handle to leak and a thing to cancel on every
    // exit path, and the client is already polling — which is precisely the
    // caller that needs the answer. An assembly nobody is watching does not
    // need to be told it has stalled.
    if (Date.now() - existing.lastProgressAt > ASSEMBLY_STALL_MS) {
      inFlight.delete(artistMbid); // free the slot so a retry starts clean
      const stalled = new DiscographyStalledError(artistMbid, existing.progress);
      console.error(`[ALERT][discography] ${stalled.message}`);
      // The orphaned assembly is deliberately NOT abandoned mid-flight: if it
      // does eventually finish it still populates the 7d cache, which makes the
      // retry instant. What it can no longer do is hold a person on a progress
      // bar that will never move.
      existing.promise.catch(() => {});
      throw stalled;
    }
    return {
      status: "assembling",
      progress: existing.progress,
      stalledForMs: Date.now() - existing.lastProgressAt,
    };
  }

  const state: Assembly = {
    progress: { fetched: 0, total: null },
    promise: Promise.resolve(),
    lastProgressAt: Date.now(),
  };
  state.promise = getArtistDiscography(artistMbid, (p) => {
    state.progress = p;
    state.lastProgressAt = Date.now(); // heartbeat: a page landed
  })
    .then((entries) => {
      inFlight.delete(artistMbid); // now served from the cache
      prefetchCoverArt(entries); // warm CAA for the entries users actually open
      return entries;
    })
    .catch((err) => {
      state.error = err; // kept so the next poll surfaces it
      return [];
    });
  inFlight.set(artistMbid, state);

  return { status: "assembling", progress: state.progress, stalledForMs: 0 };
}

// Cover art for obscure releases loads visibly late. Once a discography is
// assembled we warm the Cover Art Archive cache for the entries most likely to
// be looked at, so a click finds the URL already resolved. This is deliberately
// small and best-effort: CAA is a separate host with no MusicBrainz rate limit,
// but there is no reason to fetch art for hundreds of live bootlegs nobody will
// open. Failures are ignored — this is a nicety, never a dependency.
const PREFETCH_LIMIT = 24;

/**
 * The entries whose artwork is worth fetching ahead of a click: studio albums
 * and EPs, no live records, capped.
 *
 * Exported because the 6.2e pre-warmer needs the SAME set — "the default view"
 * is the depth Blake ruled for warming, and that is precisely this rule. Two
 * copies of it would drift, and the drift would be invisible: the pre-warmer
 * would warm covers the discography page never asks for, or miss ones it does,
 * and either way the symptom is only ever "warming didn't seem to help".
 */
export function coverPrefetchSet(
  entries: MBDiscographyEntry[],
  limit = PREFETCH_LIMIT
): MBDiscographyEntry[] {
  return entries
    .filter((e) => {
      const t = (e.primaryType ?? "").toLowerCase();
      const live = e.secondaryTypes.some((s) => s.toLowerCase() === "live");
      return !live && (t === "album" || t === "ep");
    })
    .slice(0, limit);
}

function prefetchCoverArt(entries: MBDiscographyEntry[]): void {
  const worthwhile = coverPrefetchSet(entries);

  // `browse` tier: these are speculative, and before 6.1.4 this line alone put
  // 24 simultaneous requests on the Cover Art Archive — measured — which is what
  // the cover of the release someone then clicked had to queue behind. The gate
  // inside `getCoverArtUrls` now bounds them; the fan-out here can stay simple.
  void Promise.allSettled(worthwhile.map((e) => getCoverArtUrls(e.mbid, "browse")));
}

/**
 * Whether an assembly is already running for this artist. A refresh during that
 * window is pointless — the in-flight run writes the cache after any bust — so
 * the route reports it instead of burning the caller's rate-limit slot.
 */
export function isAssembling(artistMbid: string): boolean {
  return inFlight.has(artistMbid);
}

/** Await any in-flight assemblies. Used by tests. */
export async function settleDiscographies(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight.values()].map((a) => a.promise));
    // A failed assembly stays in the map until someone polls it; drop those so
    // this can't spin forever.
    for (const [mbid, a] of inFlight) if (a.error) inFlight.delete(mbid);
  }
}
