// Orchestrates the metadata sources into a catalog. Talks to sources only
// through the MetadataSource interface (via the registry), so Spotify — or any
// source — is added/removed by env config alone. MusicBrainz is canonical:
// dedupe prefers musicbrainzId, cover art prefers the Cover Art Archive, and
// artists are anchored on their MB artist MBID.
import type { Artist, Label, Release, ReleaseType } from "@prisma/client";
import { prisma } from "../config/database.js";
import { getConfiguredSources, getSource } from "./sources/registry.js";
import type { SourceCandidate, ReleaseDetail, SourceName } from "./sources/types.js";
import { dedupeMerge, candidateKey } from "./catalog/merge.js";
import {
  esSearchReleases,
  esSearchArtists,
  esSearchUsers,
  esSearchLists,
  esSearchLabels,
  indexRelease,
  indexArtist,
  indexLabel,
  deindexRelease,
} from "./searchService.js";
import {
  findReleaseGroupMbid,
  getCoverArtUrls,
  lookupReleaseGroup,
  lookupArtist,
  getReleaseGroupLabel,
  lookupLabel,
} from "./musicbrainzService.js";
import { getGenresWithFallback, getSimilarArtists } from "./lastfmService.js";
import { findSpotifyMatch, spotifyConfigured } from "./spotifyService.js";
import { findDiscogsCover, getDiscogsMasterYear, getDiscogsLabel } from "./discogsService.js";
import { parseReleaseDate, earliestReleaseDate } from "./catalog/releaseDate.js";

// Below this many Elasticsearch hits we consider results "thin" and fan out to
// the live sources for discovery.
const THIN_RESULTS = 5;

export interface CatalogSearchResult {
  ref: string; // internal id, or "mb:"/"discogs:"/"spotify:"<sourceId> for unseeded
  releaseId?: string;
  artistId?: string; // internal Artist id, when the release is seeded
  title: string;
  artistName: string;
  year?: string;
  type: ReleaseType;
  coverUrl?: string;
}

// ---------------------------------------------------------------------------
// Search: Elasticsearch first, fan out to sources on thin results.
// ---------------------------------------------------------------------------

export async function searchCatalog(q: string, type?: string): Promise<CatalogSearchResult[]> {
  const seeded = await esSearchReleases(q, type);
  const seededResults: CatalogSearchResult[] = seeded.map((h) => ({
    ref: h.id,
    releaseId: h.id,
    artistId: h.artistId,
    title: h.title,
    artistName: h.artistName,
    year: h.year,
    type: h.type,
    coverUrl: h.coverUrl,
  }));

  if (seeded.length >= THIN_RESULTS) return seededResults;

  const sources = getConfiguredSources();
  const lists = await Promise.all(
    sources.map((s) =>
      s.search(q).catch((err) => {
        console.warn(`[catalog] ${s.name} search failed:`, (err as Error).message);
        return [] as SourceCandidate[];
      })
    )
  );
  const merged = dedupeMerge(lists.flat());

  // Drop candidates already represented by a seeded release (by title+artist).
  const seededKeys = new Set(seeded.map((h) => candidateKey(h)));
  const external = merged.filter((c) => !seededKeys.has(candidateKey(c)));

  // Link candidates that are already in our DB (so clicking goes to the row).
  const linked = await Promise.all(
    external.map(async (c) => {
      const existing = await findExistingRelease(c);
      return existing
        ? { ...candidateToResult(c), ref: existing.id, releaseId: existing.id, artistId: existing.artistId ?? undefined }
        : candidateToResult(c);
    })
  );

  return [...seededResults, ...linked];
}

export interface ArtistSearchResult {
  id: string;
  name: string;
  type: string | null;
  area: string | null;
  releaseCount: number;
}

/** Search seeded artists (ES), enriched with how many of their releases we hold. */
export async function searchArtists(q: string, size = 5): Promise<ArtistSearchResult[]> {
  const hits = await esSearchArtists(q, size);
  return Promise.all(
    hits.map(async (h) => ({
      id: h.id,
      name: h.name,
      type: h.type ?? null,
      area: h.area ?? null,
      releaseCount: await prisma.release.count({ where: { artistId: h.id } }),
    }))
  );
}

export interface MemberSearchResult {
  id: string;
  username: string;
  displayName?: string | null;
}

/** Search members (users) in Elasticsearch. */
export async function searchMembers(q: string, size = 10): Promise<MemberSearchResult[]> {
  const hits = await esSearchUsers(q, size);
  return hits.map((h) => ({ id: h.id, username: h.username, displayName: h.displayName ?? null }));
}

export interface ListSearchResult {
  id: string;
  title: string;
  username: string;
  itemCount: number;
}

/** Search public lists in Elasticsearch (private lists are never indexed). */
export async function searchLists(q: string, size = 10): Promise<ListSearchResult[]> {
  const hits = await esSearchLists(q, size);
  return hits.map((h) => ({ id: h.id, title: h.title, username: h.username, itemCount: h.itemCount }));
}

export interface LabelSearchResult {
  id: string;
  name: string;
  area: string | null;
  releaseCount: number;
}

/** Search labels (ES), enriched with how many of their releases we hold. */
export async function searchLabels(q: string, size = 10): Promise<LabelSearchResult[]> {
  const hits = await esSearchLabels(q, size);
  return Promise.all(
    hits.map(async (h) => ({
      id: h.id,
      name: h.name,
      area: h.area ?? null,
      releaseCount: await prisma.release.count({ where: { labelId: h.id } }),
    }))
  );
}

function refFor(c: SourceCandidate): string {
  if (c.releaseId) return c.releaseId;
  if (c.musicbrainzId) return `mb:${c.musicbrainzId}`;
  if (c.discogsId) return `discogs:${c.discogsId}`; // discogsId is "master:N"/"release:N"
  if (c.spotifyId) return `spotify:${c.spotifyId}`;
  return c.title; // unreachable in practice; every source sets an id
}

function candidateToResult(c: SourceCandidate): CatalogSearchResult {
  return {
    ref: refFor(c),
    releaseId: c.releaseId,
    title: c.title,
    artistName: c.artistName,
    year: c.year,
    type: c.type,
    coverUrl: c.coverUrl,
  };
}

// ---------------------------------------------------------------------------
// Resolve + seed a Release.
// ---------------------------------------------------------------------------

/** Resolve a search `ref` (internal id or "<source>:<id>") to a Release, seeding it if new. */
export async function resolveRelease(ref: string): Promise<Release | null> {
  const sep = ref.indexOf(":");
  if (sep !== -1) {
    const prefix = ref.slice(0, sep);
    const id = ref.slice(sep + 1); // may itself be qualified, e.g. "release:9459"
    if (prefix === "mb") return seedFromSource("musicbrainz", id);
    if (prefix === "discogs") return seedFromSource("discogs", id);
    if (prefix === "spotify") return seedFromSource("spotify", id);
  }
  return prisma.release.findUnique({ where: { id: ref } });
}

async function seedFromSource(name: SourceName, id: string): Promise<Release | null> {
  const source = getSource(name);
  if (!source || !source.isConfigured()) return null;
  const detail = await source.lookupRelease(id);
  return detail ? persistRelease(detail) : null;
}

/**
 * Persist a release detail: attach a canonical MBID, dedupe, resolve cover art
 * (Cover Art Archive → source cover → Discogs; Spotify if higher-res), resolve
 * and seed the Artist (MB artist MBID canonical), enrich genres via Last.fm,
 * create the row, and index it. Returns an existing row (enriched) when the
 * release is already in the catalog.
 */
// How long a first-access request will wait for the slow enrichment stages
// before answering with the canonical skeleton and finishing in the background.
// Sized so a warm/uncontended seed returns complete, while a seed queued behind
// a saturated MusicBrainz throttle still answers promptly instead of hanging.
const ENRICH_BUDGET_MS = 1_500;

// In-flight background enrichments, so tests (and shutdown) can await them
// rather than racing a detached promise.
const pendingEnrichments = new Set<Promise<unknown>>();

/** Await every background enrichment currently in flight. Used by tests. */
export async function settleEnrichments(): Promise<void> {
  while (pendingEnrichments.size > 0) {
    await Promise.allSettled([...pendingEnrichments]);
  }
}

function track<T>(p: Promise<T>): Promise<T> {
  pendingEnrichments.add(p);
  void p.finally(() => pendingEnrichments.delete(p));
  return p;
}

/** Resolve to the promise's value, or to `null` if it outruns the budget. */
function withBudget<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms).unref?.()),
  ]);
}

export async function persistRelease(detail: ReleaseDetail): Promise<Release> {
  const startedAt = Date.now();
  const stages: Record<string, number> = {};
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const s = Date.now();
    try {
      return await fn();
    } finally {
      stages[name] = Date.now() - s;
    }
  };

  let mbid = detail.musicbrainzId ?? null;
  if (!mbid) {
    mbid = await timed("mb.match", () => findReleaseGroupMbid(detail.artistName, detail.title));
  }

  const existing = await findExistingRelease({ ...detail, musicbrainzId: mbid ?? undefined });
  if (existing) return enrichExisting(existing, detail, mbid);

  // ---- Stage 1: the skeleton -----------------------------------------------
  // Everything canonical we already hold, written immediately so the release is
  // real (and resumable) the moment MusicBrainz answers. A MusicBrainz
  // first-release-date IS the group-level date, so it's canonical here; a
  // Discogs date may be a pressing, so that waits for enrichment.
  let release: Release;
  try {
    release = await timed("persist.skeleton", () =>
      prisma.release.create({
        data: {
          musicbrainzId: mbid,
          discogsId: detail.discogsId ?? null,
          spotifyId: detail.spotifyId ?? null,
          title: detail.title,
          artistName: detail.artistName,
          releaseDate:
            detail.source === "musicbrainz" ? parseReleaseDate(detail.releaseDate) : null,
          genres: detail.genres ?? [],
          type: detail.type,
          trackCount: detail.trackCount ?? null,
          lastfmUrl: detail.lastfmUrl ?? null,
        },
      })
    );
  } catch (err) {
    // Concurrent seed hit a unique constraint — return the winner.
    if ((err as { code?: string }).code === "P2002") {
      const found = await findExistingRelease({ ...detail, musicbrainzId: mbid ?? undefined });
      if (found) return found;
    }
    throw err;
  }
  await indexRelease(release);

  // ---- Stage 2: enrichment --------------------------------------------------
  // Slow, best-effort, and individually fault-isolated. Runs in the background;
  // the request waits only up to ENRICH_BUDGET_MS for it. Anything still missing
  // is healed on the next access by enrichExisting, so this is resumable.
  const enrichment = track(
    enrichNewRelease(release, detail, mbid, timed).catch((err) => {
      console.warn(`[seed] enrichment failed for ${release.id}:`, (err as Error).message);
      return null;
    })
  );

  const enriched = await withBudget(enrichment, ENRICH_BUDGET_MS);
  logSeedTimings(release, mbid, stages, startedAt, enriched !== null);
  return enriched ?? release;
}

/**
 * The slow half of seeding: cover art, Spotify supplement, artist, label,
 * genres, and the refined original release date. Each stage is fault-isolated —
 * one upstream having a bad day must not discard the others' results.
 */
async function enrichNewRelease(
  release: Release,
  detail: ReleaseDetail,
  mbid: string | null,
  timed: <T>(name: string, fn: () => Promise<T>) => Promise<T>
): Promise<Release> {
  const data: Record<string, unknown> = {};
  const attempt = async (name: string, fn: () => Promise<void>) => {
    try {
      await timed(name, fn);
    } catch (err) {
      console.warn(`[seed] stage ${name} failed for ${release.id}:`, (err as Error).message);
    }
  };

  await attempt("covers", async () => {
    const covers = await resolveCovers(detail, mbid);
    // Spotify is supplemental — only when configured, and only to enrich.
    if (spotifyConfigured()) {
      const match = await findSpotifyMatch(detail.artistName, detail.title);
      if (match) {
        if (!release.spotifyId && match.spotifyId) data.spotifyId = match.spotifyId;
        if (match.coverUrl && preferSpotifyCover(covers.thumb, match.coverWidth)) {
          covers.thumb = match.coverUrl;
          covers.large ??= match.coverUrl;
        }
      }
    }
    if (covers.thumb) data.coverUrl = covers.thumb;
    if (covers.large) data.coverUrlLarge = covers.large;
  });

  await attempt("artist", async () => {
    const artistId = await resolveArtistId(detail, mbid);
    if (artistId) data.artistId = artistId;
  });

  await attempt("label", async () => {
    const labelId = await resolveLabelId(detail, mbid);
    if (labelId) data.labelId = labelId;
  });

  await attempt("genres", async () => {
    if (release.genres.length) return;
    const genres = await getGenresWithFallback(detail.artistName, detail.title);
    if (genres.length) data.genres = genres;
  });

  await attempt("releaseDate", async () => {
    const original = await groupLevelReleaseDate(mbid, detail.discogsId);
    const fallback = detail.source === "spotify" ? parseReleaseDate(detail.releaseDate) : null;
    const best = original ?? fallback;
    // Only ever move the date EARLIER — never overwrite an original with a reissue.
    if (best && (!release.releaseDate || best.getTime() < release.releaseDate.getTime())) {
      data.releaseDate = best;
    }
  });

  if (Object.keys(data).length === 0) return release;
  const updated = await prisma.release.update({ where: { id: release.id }, data });
  await indexRelease(updated);
  return updated;
}

/**
 * One structured line per seed, so first-access latency is diagnosable from logs
 * without a profiler: which stage burned the time, and whether the response went
 * out complete or as a skeleton with enrichment still running.
 */
function logSeedTimings(
  release: Release,
  mbid: string | null,
  stages: Record<string, number>,
  startedAt: number,
  completeWithinBudget: boolean
): void {
  console.info(
    JSON.stringify({
      evt: "seed.timing",
      releaseId: release.id,
      mbid,
      title: release.title,
      totalMs: Date.now() - startedAt,
      servedAs: completeWithinBudget ? "enriched" : "skeleton",
      budgetMs: ENRICH_BUDGET_MS,
      stages,
    })
  );
}

// ---------------------------------------------------------------------------
// Artists — MB artist MBID is the canonical identity.
// ---------------------------------------------------------------------------

/**
 * Resolve (and seed, if new) the Artist row for a release being persisted.
 * The artist MBID comes from the MB detail itself, or from the release-group's
 * artist credit when the release arrived via another source. Best-effort:
 * returns null rather than blocking a seed.
 */
async function resolveArtistId(detail: ReleaseDetail, mbid: string | null): Promise<string | null> {
  try {
    let artistMbid = detail.source === "musicbrainz" ? detail.artistId : undefined;
    if (!artistMbid && mbid) {
      const rg = await lookupReleaseGroup(mbid); // cached 7d
      artistMbid = rg?.["artist-credit"]?.[0]?.artist?.id;
    }
    if (!artistMbid) return null;

    const existing = await prisma.artist.findUnique({ where: { musicbrainzId: artistMbid } });
    if (existing) return existing.id;

    const mb = await lookupArtist(artistMbid);
    const artist = await prisma.artist.create({
      data: {
        musicbrainzId: artistMbid,
        name: mb?.name ?? detail.artistName,
        sortName: mb?.["sort-name"] ?? null,
        type: mb?.type ?? null,
        area: mb?.area?.name ?? null,
        beginDate: mb?.["life-span"]?.begin ?? null,
      },
    });
    await indexArtist(artist);
    return artist.id;
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      // Concurrent seed created the artist — reuse it.
      const artistMbid = detail.source === "musicbrainz" ? detail.artistId : undefined;
      if (artistMbid) {
        const winner = await prisma.artist.findUnique({ where: { musicbrainzId: artistMbid } });
        if (winner) return winner.id;
      }
    }
    console.warn("[catalog] artist resolution failed:", (err as Error).message);
    return null;
  }
}

/**
 * Resolve the primary Label for a release, creating and indexing it on first
 * sight. MusicBrainz is canonical (label credits on the release-group's
 * releases); Discogs is the fallback when MB has no label. Best-effort — a
 * failure never blocks the release write.
 */
async function resolveLabelId(detail: ReleaseDetail, mbid: string | null): Promise<string | null> {
  try {
    // MusicBrainz primary.
    const mb = mbid ? await getReleaseGroupLabel(mbid) : null;
    if (mb) {
      const existing = await prisma.label.findUnique({ where: { musicbrainzId: mb.mbid } });
      if (existing) return existing.id;
      const full = await lookupLabel(mb.mbid);
      const label = await prisma.label.create({
        data: {
          musicbrainzId: mb.mbid,
          name: full?.name ?? mb.name,
          area: full?.area?.name ?? null,
          founded: full?.["life-span"]?.begin ?? null,
        },
      });
      await indexLabel(label);
      return label.id;
    }

    // Discogs fallback, keyed by a namespace-qualified "label:N" id.
    if (detail.discogsId) {
      const dc = await getDiscogsLabel(detail.discogsId);
      if (dc) {
        const existing = await prisma.label.findUnique({ where: { discogsId: dc.discogsId } });
        if (existing) return existing.id;
        const label = await prisma.label.create({
          data: { discogsId: dc.discogsId, name: dc.name },
        });
        await indexLabel(label);
        return label.id;
      }
    }
    return null;
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      // Concurrent seed created the label — reuse the winner.
      const mb = mbid ? await getReleaseGroupLabel(mbid) : null;
      if (mb) {
        const winner = await prisma.label.findUnique({ where: { musicbrainzId: mb.mbid } });
        if (winner) return winner.id;
      }
      if (detail.discogsId) {
        const dc = await getDiscogsLabel(detail.discogsId);
        if (dc) {
          const winner = await prisma.label.findUnique({ where: { discogsId: dc.discogsId } });
          if (winner) return winner.id;
        }
      }
    }
    console.warn("[catalog] label resolution failed:", (err as Error).message);
    return null;
  }
}

export async function getArtistWithReleases(id: string): Promise<{
  artist: Artist;
  releases: Release[];
} | null> {
  const artist = await prisma.artist.findUnique({ where: { id } });
  if (!artist) return null;
  const releases = await prisma.release.findMany({
    where: { artistId: id },
    orderBy: { releaseDate: "desc" },
  });
  return { artist, releases };
}

// Fill in ids/covers/artist we didn't have before, without clobbering existing data.
async function enrichExisting(
  existing: Release,
  detail: ReleaseDetail,
  mbid: string | null
): Promise<Release> {
  const data: Record<string, unknown> = {};
  if (!existing.musicbrainzId && mbid) data.musicbrainzId = mbid;
  if (!existing.discogsId && detail.discogsId) data.discogsId = detail.discogsId;
  if (!existing.spotifyId && detail.spotifyId) data.spotifyId = detail.spotifyId;
  // Self-heal the release date toward the original (group/master level), never
  // later — this repairs rows seeded from a reissue pressing.
  const original = await groupLevelReleaseDate(
    mbid ?? existing.musicbrainzId,
    existing.discogsId ?? detail.discogsId
  );
  if (original && (!existing.releaseDate || original.getTime() < existing.releaseDate.getTime())) {
    data.releaseDate = original;
  }
  if (!existing.artistId) {
    const artistId = await resolveArtistId(detail, mbid ?? existing.musicbrainzId);
    if (artistId) data.artistId = artistId;
  }
  if (!existing.labelId) {
    const labelId = await resolveLabelId(detail, mbid ?? existing.musicbrainzId);
    if (labelId) data.labelId = labelId;
  }
  // Self-heal missing artwork on access, through the full fallback chain.
  if (!existing.coverUrl) {
    const covers = await resolveCovers(detail, mbid ?? existing.musicbrainzId);
    if (covers.thumb) data.coverUrl = covers.thumb;
    if (!existing.coverUrlLarge && covers.large) data.coverUrlLarge = covers.large;
  } else if (!existing.coverUrlLarge) {
    const effectiveMbid = mbid ?? existing.musicbrainzId;
    const caa = effectiveMbid ? await getCoverArtUrls(effectiveMbid) : null;
    const large = caa?.large ?? detail.coverUrl ?? existing.coverUrl;
    if (large) data.coverUrlLarge = large;
  }
  if (Object.keys(data).length === 0) return existing;

  const updated = await prisma.release.update({ where: { id: existing.id }, data });
  await indexRelease(updated);
  return updated;
}

async function resolveCovers(
  detail: ReleaseDetail,
  mbid: string | null
): Promise<{ thumb: string | null; large: string | null }> {
  if (mbid) {
    const caa = await getCoverArtUrls(mbid);
    if (caa) return { thumb: caa.thumb, large: caa.large };
  }
  if (detail.coverUrl) return { thumb: detail.coverUrl, large: detail.coverUrl };
  // Discogs cover-art fallback when the Cover Art Archive has nothing:
  // by id when the detail carries one, otherwise by artist+title match (an
  // mb:-seeded release has no discogsId even when Discogs has the artwork).
  if (detail.discogsId) {
    const discogs = getSource("discogs");
    if (discogs?.isConfigured()) {
      const cover = await discogs.getCoverArt(detail);
      if (cover) return { thumb: cover, large: cover };
    }
  }
  const matched = await findDiscogsCover(detail.artistName, detail.title);
  if (matched) return { thumb: matched, large: matched };
  return { thumb: null, large: null };
}

function preferSpotifyCover(current: string | null, spotifyWidth?: number): boolean {
  if (!current) return true;
  return (spotifyWidth ?? 0) > 500; // CAA front thumbnail is 500px
}

async function findExistingRelease(c: {
  musicbrainzId?: string;
  discogsId?: string;
  spotifyId?: string;
  title: string;
  artistName: string;
}): Promise<Release | null> {
  if (c.musicbrainzId) {
    const r = await prisma.release.findUnique({ where: { musicbrainzId: c.musicbrainzId } });
    if (r) return r;
  }
  if (c.discogsId) {
    const r = await prisma.release.findUnique({ where: { discogsId: c.discogsId } });
    if (r) return r;
  }
  if (c.spotifyId) {
    const r = await prisma.release.findUnique({ where: { spotifyId: c.spotifyId } });
    if (r) return r;
  }
  return prisma.release.findFirst({
    where: {
      title: { equals: c.title, mode: "insensitive" },
      artistName: { equals: c.artistName, mode: "insensitive" },
    },
  });
}

/**
 * The ORIGINAL release date for a work, from group/master-level sources only —
 * the MusicBrainz release-group's first-release-date and/or the Discogs master's
 * original year, whichever is earliest. Never an individual pressing (which is
 * usually a reissue). Returns null when no group/master date is available.
 */
async function groupLevelReleaseDate(
  mbid: string | null | undefined,
  discogsId: string | null | undefined
): Promise<Date | null> {
  const candidates: Array<string | null | undefined> = [];
  if (mbid) {
    const rg = await lookupReleaseGroup(mbid).catch(() => null);
    candidates.push(rg?.["first-release-date"]);
  }
  if (discogsId) {
    const year = await getDiscogsMasterYear(discogsId).catch(() => null);
    if (year) candidates.push(String(year));
  }
  const earliest = earliestReleaseDate(candidates);
  return earliest ? parseReleaseDate(earliest) : null;
}

/**
 * Re-derive the original release date for every seeded release and heal any that
 * are stored later than their true original (reissue-year bug). Only ever moves
 * a date earlier. Returns the rows that changed, for reporting.
 */
export async function reenrichReleaseDates(): Promise<
  Array<{ id: string; title: string; artistName: string; before: Date | null; after: Date }>
> {
  const rows = await prisma.release.findMany();
  const changes = [];
  for (const row of rows) {
    const original = await groupLevelReleaseDate(row.musicbrainzId, row.discogsId);
    if (original && (!row.releaseDate || original.getTime() < row.releaseDate.getTime())) {
      const updated = await prisma.release.update({
        where: { id: row.id },
        data: { releaseDate: original },
      });
      await indexRelease(updated);
      changes.push({
        id: row.id,
        title: row.title,
        artistName: row.artistName,
        before: row.releaseDate,
        after: original,
      });
    }
  }
  return changes;
}

/**
 * Link any release with no artist row to its artist. Prefers the MusicBrainz
 * release-group's artist credit (seeding the artist if needed); for releases
 * without an MB link (e.g. Discogs-only seeds) falls back to an existing artist
 * row whose name matches exactly — but only when exactly one such row exists, so
 * same-name artists are never conflated. Returns the rows that were linked.
 */
export async function backfillReleaseArtists(): Promise<
  Array<{ id: string; title: string; artistId: string }>
> {
  const orphans = await prisma.release.findMany({ where: { artistId: null } });
  const linked = [];
  for (const row of orphans) {
    let artistId: string | null = null;

    if (row.musicbrainzId) {
      // source "musicbrainz" with no artistId forces the release-group artist-credit lookup.
      const detail: ReleaseDetail = {
        source: "musicbrainz",
        title: row.title,
        artistName: row.artistName,
        type: row.type,
      };
      artistId = await resolveArtistId(detail, row.musicbrainzId);
    }

    if (!artistId) {
      const matches = await prisma.artist.findMany({
        where: { name: { equals: row.artistName, mode: "insensitive" } },
        select: { id: true },
      });
      if (matches.length === 1) artistId = matches[0].id;
    }

    if (artistId) {
      const updated = await prisma.release.update({ where: { id: row.id }, data: { artistId } });
      await indexRelease(updated);
      linked.push({ id: row.id, title: row.title, artistId });
    }
  }
  return linked;
}

/**
 * One-shot backfill: seed the primary Label for every release that has none,
 * MusicBrainz-first with a Discogs fallback (same policy as fresh seeds).
 * Idempotent — re-runnable, only touches rows still missing a labelId.
 */
export async function backfillReleaseLabels(): Promise<
  Array<{ id: string; title: string; labelId: string }>
> {
  const orphans = await prisma.release.findMany({ where: { labelId: null } });
  const linked = [];
  for (const row of orphans) {
    const detail: ReleaseDetail = {
      source: row.musicbrainzId ? "musicbrainz" : "discogs",
      title: row.title,
      artistName: row.artistName,
      type: row.type,
      discogsId: row.discogsId ?? undefined,
    };
    const labelId = await resolveLabelId(detail, row.musicbrainzId);
    if (labelId) {
      await prisma.release.update({ where: { id: row.id }, data: { labelId } });
      linked.push({ id: row.id, title: row.title, labelId });
    }
  }
  return linked;
}

/** A label with its releases (newest first) — powers the /label/:id page. */
export async function getLabelWithReleases(id: string): Promise<{
  label: Label;
  releases: Release[];
} | null> {
  const label = await prisma.label.findUnique({ where: { id } });
  if (!label) return null;
  const releases = await prisma.release.findMany({
    where: { labelId: id },
    orderBy: { releaseDate: "desc" },
  });
  return { label, releases };
}

// ---------------------------------------------------------------------------
// Deletion — the ONLY sanctioned way to remove a Release. Postgres deletes
// don't cascade into Elasticsearch, so any delete path that bypasses this
// helper leaves an orphaned search hit (see the Phase 3 README note).
// ---------------------------------------------------------------------------

/**
 * Remove a release and its user data (ratings, logs, reviews, list items) from
 * Postgres, then its Elasticsearch document. Idempotent; returns whether a row
 * was actually deleted.
 */
export async function deleteReleaseEverywhere(releaseId: string): Promise<boolean> {
  const existing = await prisma.release.findUnique({ where: { id: releaseId }, select: { id: true } });
  if (!existing) {
    await deindexRelease(releaseId); // clear any orphaned doc regardless
    return false;
  }
  await prisma.$transaction([
    prisma.rating.deleteMany({ where: { releaseId } }),
    prisma.log.deleteMany({ where: { releaseId } }),
    prisma.listItem.deleteMany({ where: { releaseId } }),
    prisma.review.deleteMany({ where: { releaseId } }), // likes/comments cascade
    prisma.release.delete({ where: { id: releaseId } }),
  ]);
  await deindexRelease(releaseId);
  return true;
}

// ---------------------------------------------------------------------------
// Read model.
// ---------------------------------------------------------------------------

/** Recently added releases — interim "Popular this week" until Phase 4 activity data. */
export async function getRecentReleases(limit = 12) {
  const releases = await prisma.release.findMany({
    orderBy: { id: "desc" }, // cuids are time-sortable; proxy for created order
    take: limit,
    include: { artist: { select: { id: true, name: true } } },
  });
  return releases.map((r) => ({
    id: r.id,
    title: r.title,
    artistName: r.artistName,
    artist: r.artist,
    year: r.releaseDate?.toISOString().slice(0, 4) ?? null,
    genres: r.genres,
    coverUrl: r.coverUrl,
    type: r.type,
  }));
}

/**
 * Shape a Release for the API: metadata, genres, rating summary, similar
 * artists — plus the caller's own rating/review ids when a userId is present.
 */
export async function toReleaseDTO(release: Release, userId?: string) {
  const [agg, artist, label, similarArtists, myRating, myReview] = await Promise.all([
    prisma.rating.aggregate({
      where: { releaseId: release.id },
      _avg: { value: true },
      _count: true,
    }),
    release.artistId
      ? prisma.artist.findUnique({
          where: { id: release.artistId },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
    release.labelId
      ? prisma.label.findUnique({
          where: { id: release.labelId },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
    getSimilarArtists(release.artistName),
    userId
      ? prisma.rating.findUnique({
          where: { userId_releaseId: { userId, releaseId: release.id } },
          select: { value: true },
        })
      : Promise.resolve(null),
    userId
      ? prisma.review.findUnique({
          where: { userId_releaseId: { userId, releaseId: release.id } },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);
  return {
    id: release.id,
    title: release.title,
    artistName: release.artistName,
    artist,
    label,
    releaseDate: release.releaseDate ? release.releaseDate.toISOString() : null,
    genres: release.genres,
    coverUrl: release.coverUrl,
    coverUrlLarge: release.coverUrlLarge,
    type: release.type,
    trackCount: release.trackCount,
    musicbrainzId: release.musicbrainzId,
    discogsId: release.discogsId,
    spotifyId: release.spotifyId,
    avgRating: agg._avg.value ?? undefined,
    ratingCount: agg._count,
    similarArtists,
    myRating: myRating?.value,
    myReviewId: myReview?.id,
  };
}
