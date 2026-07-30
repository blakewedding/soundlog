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
}
const inFlight = new Map<string, Assembly>();

export type DiscographyState =
  | { status: "complete"; entries: MBDiscographyEntry[] }
  | { status: "assembling"; progress: DiscographyProgress };

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
    return { status: "assembling", progress: existing.progress };
  }

  const state: Assembly = { progress: { fetched: 0, total: null }, promise: Promise.resolve() };
  state.promise = getArtistDiscography(artistMbid, (p) => {
    state.progress = p;
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

  return { status: "assembling", progress: state.progress };
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
