// Charts — rank releases within a genre or year by a Bayesian weighted rating,
// with recency-weighted review likes as the tiebreak. The Bayesian prior pulls
// thinly-rated releases toward the global mean so a single 5★ can't top a
// broadly-loved record; `minRatings` is a gate that stays 0 for now but lets us
// require a floor of ratings once the catalog is dense enough.
import type { Prisma, ReleaseType } from "@prisma/client";
import { prisma } from "../config/database.js";
import { genreCanonicalMap, normalizeGenre } from "./genreVocabulary.js";

// Bayesian prior strength: how many "phantom" votes at the global mean each
// release starts with. Higher = more skeptical of thinly-rated releases.
const PRIOR_WEIGHT = 5;
// A like's weight halves every this-many days — recent enthusiasm counts more.
const LIKE_HALF_LIFE_DAYS = 30;
const DAY_MS = 86_400_000;

export interface ChartEntry {
  id: string;
  title: string;
  artistName: string;
  artistId: string | null;
  year: string | null;
  type: ReleaseType;
  coverUrl: string | null;
  coverColor: string | null;
  genres: string[];
  avgRating: number | null;
  ratingCount: number;
  weightedRating: number;
}

export interface ChartOptions {
  minRatings?: number; // gate: only rank releases with at least this many ratings (default 0)
  limit?: number;
}

/**
 * A URL slug to the stored genre tag, by the historical rule: every hyphen is a
 * word break. Kept only as the fallback inside `resolveGenreSlug` — see there
 * for why it cannot be the whole answer.
 */
export function slugToTag(slug: string): string {
  return slug.toLowerCase().replace(/-/g, " ").trim();
}

/**
 * Resolve a URL slug to the genre tag we actually store.
 *
 * `slugToTag` alone turns EVERY hyphen into a space, which round-trips only for
 * genres that contain no hyphen of their own. `detroit techno` -> slug
 * `detroit-techno` -> `detroit techno` works; `post-rock` -> slug `post-rock` ->
 * `post rock` does not, and `{ genres: { has: "post rock" } }` matches nothing.
 * So every hyphenated genre — post-rock, singer-songwriter, post-hardcore,
 * synth-pop, lo-fi, alt-country — had a dead page.
 *
 * That was survivable while the catalog stored BOTH spellings, because the
 * space-form absorbed the traffic. 6.3b canonicalized on MusicBrainz's spelling
 * and moved 109 releases behind the broken half of the round-trip, which is how
 * a latent bug became `/genre/post-rock` returning nothing for the most common
 * genre we have.
 *
 * The vocabulary map is the fix: it is keyed on the same separator-insensitive
 * normal form the slug reduces to, so it answers "which stored tag is this
 * slug?" exactly, for both shapes. Anything outside the vocabulary falls back to
 * the old rule rather than 404ing.
 */
export async function resolveGenreSlug(slug: string): Promise<string> {
  const raw = slug.toLowerCase().trim();
  if (!raw) return "";
  try {
    const vocabulary = await genreCanonicalMap();
    const canonical = vocabulary.get(normalizeGenre(raw));
    if (canonical) return canonical;
  } catch {
    // Vocabulary unavailable — degrade to the historical rule rather than
    // failing a page that used to work.
  }
  return slugToTag(raw);
}

async function rankReleases(
  where: Prisma.ReleaseWhereInput,
  opts: ChartOptions = {}
): Promise<ChartEntry[]> {
  const minRatings = opts.minRatings ?? 0;
  const limit = opts.limit ?? 50;

  const releases = await prisma.release.findMany({ where });
  if (releases.length === 0) return [];
  const ids = releases.map((r) => r.id);

  // Bayesian prior mean C = the global average rating value across the catalog.
  const globalAgg = await prisma.rating.aggregate({ _avg: { value: true } });
  const C = globalAgg._avg.value ?? 0;

  // Per-release rating aggregates (avg + count), one grouped query.
  const grouped = await prisma.rating.groupBy({
    by: ["releaseId"],
    where: { releaseId: { in: ids } },
    _avg: { value: true },
    _count: { value: true },
  });
  const ratingByRelease = new Map(
    grouped.map((g) => [g.releaseId, { avg: g._avg.value ?? 0, count: g._count.value }])
  );

  // Recency-weighted likes summed across each release's reviews, one query.
  const likes = await prisma.reviewLike.findMany({
    where: { review: { releaseId: { in: ids } } },
    select: { createdAt: true, review: { select: { releaseId: true } } },
  });
  const now = Date.now();
  const likeWeight = new Map<string, number>();
  for (const like of likes) {
    const ageDays = (now - like.createdAt.getTime()) / DAY_MS;
    const w = Math.pow(0.5, ageDays / LIKE_HALF_LIFE_DAYS);
    const rid = like.review.releaseId;
    likeWeight.set(rid, (likeWeight.get(rid) ?? 0) + w);
  }

  return releases
    .map((r) => {
      const rt = ratingByRelease.get(r.id);
      const v = rt?.count ?? 0;
      const R = rt?.avg ?? 0;
      // WR = (v·R + m·C) / (v + m): shrink the release mean toward the global
      // mean in proportion to how few ratings it has.
      const weightedRating = (v * R + PRIOR_WEIGHT * C) / (v + PRIOR_WEIGHT);
      return {
        entry: {
          id: r.id,
          title: r.title,
          artistName: r.artistName,
          artistId: r.artistId,
          year: r.releaseDate ? r.releaseDate.toISOString().slice(0, 4) : null,
          type: r.type,
          coverUrl: r.coverUrl,
          coverColor: r.coverColor,
          genres: r.genres,
          avgRating: v > 0 ? R : null,
          ratingCount: v,
          weightedRating,
        } satisfies ChartEntry,
        likeWeight: likeWeight.get(r.id) ?? 0,
      };
    })
    .filter((x) => x.entry.ratingCount >= minRatings)
    .sort(
      (a, b) =>
        b.entry.weightedRating - a.entry.weightedRating ||
        b.likeWeight - a.likeWeight ||
        b.entry.ratingCount - a.entry.ratingCount
    )
    .slice(0, limit)
    .map((x) => x.entry);
}

/** Top releases tagged with `tag` (a stored genre string, e.g. "detroit techno"). */
export function getGenreChart(tag: string, opts?: ChartOptions): Promise<ChartEntry[]> {
  return rankReleases({ genres: { has: tag } }, opts);
}

/** Top releases whose original release year is `year`. */
export function getYearChart(year: number, opts?: ChartOptions): Promise<ChartEntry[]> {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  return rankReleases({ releaseDate: { gte: start, lt: end } }, opts);
}

export interface GenreCount {
  tag: string; // stored genre string ("detroit techno")
  slug: string; // URL form ("detroit-techno")
  count: number; // releases carrying the tag
}

/** The most-represented genres in the catalog — the active-genres rail. */
export async function getActiveGenres(limit = 12): Promise<GenreCount[]> {
  const rows = await prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
    SELECT unnest(genres) AS tag, COUNT(*) AS count
    FROM "Release"
    GROUP BY tag
    ORDER BY count DESC, tag ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({ tag: r.tag, slug: r.tag.replace(/\s+/g, "-"), count: Number(r.count) }));
}
