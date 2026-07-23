// Shared definition of "this row is test debris".
//
// Imported by BOTH the operator script (scripts/purge-test-fixtures.ts) and the
// suite's global teardown (tests/support/globalTeardown.ts), so the two can
// never drift apart — a pattern added for a new fixture is honoured everywhere
// at once.
import { prisma } from "../../src/config/database.js";
import { es } from "../../src/config/elasticsearch.js";
import {
  RELEASE_INDEX,
  ARTIST_INDEX,
  USER_INDEX,
  LIST_INDEX,
  LABEL_INDEX,
} from "../../src/config/elasticsearch.js";
import { deleteReleaseEverywhere } from "../../src/services/catalogService.js";

/**
 * Real MusicBrainz identifiers are UUIDs. Every fixture id the suites generate
 * ("disco-rg-<run>-7", "seedres-<run>", "caahttp-<run>") is not, which makes
 * this the single most reliable discriminator and one that cannot match real
 * catalogue data.
 */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Anchored so real titles ("Record Collection") and artists are never caught. */
export const FIXTURE_TITLE = /^Record \d+$/;
export const FIXTURE_ARTIST = /^Prolific [a-z0-9]{6,}$/;

/** Hostnames that only ever appear in tests. */
export const FIXTURE_HOST = /\.example(\.|\/|$)/;

export interface ReleaseShape {
  title: string;
  artistName: string;
  musicbrainzId: string | null;
  coverUrl: string | null;
}

export function isFixtureRelease(r: ReleaseShape): boolean {
  if (r.musicbrainzId && !UUID.test(r.musicbrainzId)) return true;
  if (FIXTURE_TITLE.test(r.title) && FIXTURE_ARTIST.test(r.artistName)) return true;
  if (r.coverUrl && FIXTURE_HOST.test(r.coverUrl)) return true;
  return false;
}

export function isFixtureArtist(a: { name: string; musicbrainzId: string | null }): boolean {
  return (a.musicbrainzId != null && !UUID.test(a.musicbrainzId)) || FIXTURE_ARTIST.test(a.name);
}

export interface FixtureReport {
  releases: { id: string; label: string }[];
  artists: { id: string; label: string }[];
  labels: { id: string; label: string }[];
}

/** Everything in Postgres that looks synthetic. Read-only. */
export async function findFixtureRows(): Promise<FixtureReport> {
  const [releases, artists, labels] = await Promise.all([
    prisma.release.findMany({
      select: { id: true, title: true, artistName: true, musicbrainzId: true, coverUrl: true },
    }),
    prisma.artist.findMany({ select: { id: true, name: true, musicbrainzId: true } }),
    prisma.label.findMany({ select: { id: true, name: true, musicbrainzId: true } }),
  ]);

  return {
    releases: releases
      .filter(isFixtureRelease)
      .map((r) => ({ id: r.id, label: `"${r.title}" — ${r.artistName} [${r.musicbrainzId ?? "no mbid"}]` })),
    artists: artists
      .filter(isFixtureArtist)
      .map((a) => ({ id: a.id, label: `${a.name} [${a.musicbrainzId ?? "-"}]` })),
    labels: labels
      .filter((l) => l.musicbrainzId != null && !UUID.test(l.musicbrainzId))
      .map((l) => ({ id: l.id, label: `${l.name} [${l.musicbrainzId}]` })),
  };
}

/** Delete every synthetic row, from both stores. Returns how many went. */
export async function purgeFixtureRows(): Promise<number> {
  const found = await findFixtureRows();

  // deleteReleaseEverywhere is the only sanctioned removal path for a Release —
  // it cleans the search index too, so this cannot create ES orphans.
  for (const r of found.releases) await deleteReleaseEverywhere(r.id).catch(() => {});
  for (const a of found.artists) {
    await prisma.artist.delete({ where: { id: a.id } }).catch(() => {});
    await es.delete({ index: ARTIST_INDEX, id: a.id }).catch(() => {});
  }
  for (const l of found.labels) {
    await prisma.label.delete({ where: { id: l.id } }).catch(() => {});
    await es.delete({ index: LABEL_INDEX, id: l.id }).catch(() => {});
  }

  return found.releases.length + found.artists.length + found.labels.length;
}

/** Every document id currently in an index. */
async function allDocIds(index: string): Promise<string[]> {
  const ids: string[] = [];
  let from = 0;
  for (;;) {
    const res = await es.search({ index, from, size: 1000, _source: false, query: { match_all: {} } });
    const hits = res.hits.hits;
    if (hits.length === 0) break;
    ids.push(...hits.map((h) => h._id as string));
    from += hits.length;
    if (from >= 10_000) break; // ES from+size ceiling; past this, rebuild instead
  }
  return ids;
}

/**
 * Delete documents whose Postgres row no longer exists.
 *
 * Postgres is truth and Elasticsearch is a rebuildable index (CLAUDE.md §5), so
 * "no corresponding row" is an exact, safe definition of garbage — no pattern
 * matching, and real data cannot be caught by it. This is what accumulates when
 * a delete bypasses deleteReleaseEverywhere, or when a test creates a user
 * directly and removes it with prisma.deleteMany.
 */
export async function purgeOrphanDocs(
  report: (line: string) => void = () => {},
  dryRun = false
): Promise<number> {
  const targets: [string, () => Promise<{ id: string }[]>][] = [
    [RELEASE_INDEX, () => prisma.release.findMany({ select: { id: true } })],
    [ARTIST_INDEX, () => prisma.artist.findMany({ select: { id: true } })],
    [LABEL_INDEX, () => prisma.label.findMany({ select: { id: true } })],
    [USER_INDEX, () => prisma.user.findMany({ select: { id: true } })],
    [LIST_INDEX, () => prisma.list.findMany({ select: { id: true } })],
  ];

  let total = 0;
  for (const [index, liveRows] of targets) {
    let docIds: string[];
    try {
      docIds = await allDocIds(index);
    } catch {
      report(`  ${index.padEnd(9)} (index missing — skipped)`);
      continue;
    }
    const live = new Set((await liveRows()).map((r) => r.id));
    const orphans = docIds.filter((id) => !live.has(id));
    report(`  ${index.padEnd(9)} ${docIds.length} docs, ${live.size} live rows, ${orphans.length} orphaned`);

    if (!dryRun) {
      for (const id of orphans) await es.delete({ index, id }).catch(() => {});
    }
    total += orphans.length;
  }
  return total;
}
