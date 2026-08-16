/**
 * Cover repair — resolving artwork for releases we ALREADY hold, and writing it
 * back to the row.
 *
 * Split out of `warmService` in 6.3 because two callers need the same rule and
 * a warm sweep cannot be the repair tool:
 *
 *  - the nightly sweep, which repairs opportunistically as it warms; and
 *  - `scripts/repair-covers.ts`, which repairs a named, scoped population.
 *
 * The sweep alone was never sufficient. `needsWarming` gates on the four
 * METADATA layers, so an artist warmed yesterday is skipped entirely no matter
 * how broken its artwork is — measured on production: `0 of 1 target(s) due`
 * for Tom Waits the day after a sweep. And `coverPrefetchSet` is studio
 * albums/EPs capped at 24, so singles are never in scope: *Downtown Train*,
 * *Goin' Out West*, *Hold On* and *Bottom of the World* were all reported blank
 * and none of them can be reached by a warm sweep.
 *
 * The guard is shared, which is the point of the split: both callers repair
 * exactly the two populations the 6.3 defects produced — a MISSING cover, and a
 * DISCOGS-SOURCED one (the label scans). A Cover Art Archive cover we already
 * hold is canonical (§3) and is left alone, so repair converges instead of
 * flip-flopping between sources.
 */
import { prisma } from "../config/database.js";
import { toProxiedCovers, decodeProxiedCoverPath } from "./coverProxy.js";
import { toSecureCovers } from "./coverUrl.js";
import { indexRelease } from "./searchService.js";
import { getCoverArtUrls, type CoverArtUrls } from "./musicbrainzService.js";
import type { UpstreamTier } from "./upstreamPriority.js";

export type CoverRepairOutcome =
  /** Row updated (or would be, under dryRun) with newly resolved art. */
  | "repaired"
  /** Row holds a canonical cover already; nothing to do. */
  | "kept"
  /** Upstream is definite: this release-group has no approved front. */
  | "no-art"
  /** We could not tell (5xx/429/timeout). NOT recorded as absence (§1). */
  | "unavailable"
  /** No Release row for this release-group — repair creates nothing. */
  | "not-held";

export interface CoverRepairResult {
  mbid: string;
  outcome: CoverRepairOutcome;
  before: string | null;
  after: string | null;
  problem?: string;
}

/**
 * Whether a stored cover came from the Discogs fallback. The proxied form
 * encodes its upstream URL, so this is a pure string test with no network call
 * — the same property §7 relies on for the heal and the rollback.
 */
export function isDiscogsSourcedCover(coverUrl: string): boolean {
  const upstream = decodeProxiedCoverPath(coverUrl)?.upstreamUrl ?? coverUrl;
  try {
    return new URL(upstream).hostname.toLowerCase() === "i.discogs.com";
  } catch {
    return false;
  }
}

/** Whether this stored value is one the 6.3 defects could have produced. */
export function isRepairableCover(coverUrl: string | null): boolean {
  return coverUrl === null || isDiscogsSourcedCover(coverUrl);
}

/**
 * Write already-resolved artwork onto the Release row for a release-group.
 *
 * Warming still creates NOTHING: this is an UPDATE to a row that already
 * exists, matched by MBID (§3), and a no-op when we hold no such row.
 */
export async function persistResolvedCover(
  releaseGroupMbid: string,
  urls: CoverArtUrls,
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<CoverRepairResult> {
  const row = await prisma.release.findUnique({
    where: { musicbrainzId: releaseGroupMbid },
    select: { id: true, coverUrl: true },
  });
  if (!row) return { mbid: releaseGroupMbid, outcome: "not-held", before: null, after: null };

  const before = row.coverUrl;
  if (!isRepairableCover(before)) {
    return { mbid: releaseGroupMbid, outcome: "kept", before, after: before };
  }

  // Normalized at the same single exit every other cover takes: HTTPS, then the
  // proxied `/covers/…` form that encodes its upstream (§7).
  const covers = toProxiedCovers(toSecureCovers({ thumb: urls.thumb, large: urls.large }));
  if (!covers.thumb || covers.thumb === before) {
    return { mbid: releaseGroupMbid, outcome: "kept", before, after: before };
  }

  if (!dryRun) {
    const updated = await prisma.release.update({
      where: { id: row.id },
      data: { coverUrl: covers.thumb, coverUrlLarge: covers.large ?? undefined },
    });
    // Postgres is truth; the index follows and must not block this (§5).
    await indexRelease(updated).catch(() => {});
  }
  return { mbid: releaseGroupMbid, outcome: "repaired", before, after: covers.thumb };
}

/**
 * Resolve artwork for one release-group and write it back.
 *
 * The three outcomes of §1 are preserved all the way out to the caller's
 * report: an unreachable archive is `unavailable`, never `no-art`. A repair run
 * that recorded "no artwork" for a 503 would bake the very bug 6.3 fixed into
 * the rows it was sent to fix.
 */
export async function repairCover(
  releaseGroupMbid: string,
  { dryRun = false, tier = "background" as UpstreamTier }: { dryRun?: boolean; tier?: UpstreamTier } = {}
): Promise<CoverRepairResult> {
  let urls: CoverArtUrls | null;
  try {
    urls = await getCoverArtUrls(releaseGroupMbid, tier);
  } catch (err) {
    return {
      mbid: releaseGroupMbid,
      outcome: "unavailable",
      before: null,
      after: null,
      problem: (err as Error).message,
    };
  }
  if (!urls) {
    const row = await prisma.release.findUnique({
      where: { musicbrainzId: releaseGroupMbid },
      select: { coverUrl: true },
    });
    return { mbid: releaseGroupMbid, outcome: "no-art", before: row?.coverUrl ?? null, after: row?.coverUrl ?? null };
  }
  return persistResolvedCover(releaseGroupMbid, urls, { dryRun });
}
