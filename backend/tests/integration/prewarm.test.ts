/**
 * 6.1.4 — catalog pre-warming.
 *
 * The two properties that matter are not "does it enrich" (that is
 * `reenrichRelease`, already covered) but the two ways a background sweep can do
 * harm: creating rows nobody asked for, and competing with people for the gate.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { prewarmOnce } from "../../src/services/prewarmService.js";
import { settleEnrichments } from "../../src/services/enrichmentState.js";

const RUN = `prewarm${Date.now().toString(36)}`;
const created: string[] = [];
/**
 * `prewarmOnce` sweeps the WHOLE catalog — that is what it does, and scoping it
 * to fixtures would test something else. On a developer's seeded dev database it
 * therefore marks REAL releases as attempted, and those markers last a week.
 * Snapshot the keys that existed before the suite and delete only the delta, so
 * the run leaves Redis exactly as it found it.
 */
let preExistingMarkers = new Set<string>();

/** A release that looks like one the pre-warmer should want: no cover, no label. */
async function incompleteRelease(title: string, ratings = 0) {
  const release = await prisma.release.create({
    data: {
      title: `${title} ${RUN}`,
      artistName: `Artist ${RUN}`,
      musicbrainzId: `${RUN}-${title}`,
      coverUrl: null,
      labelId: null,
      genres: [],
      type: "ALBUM",
    },
  });
  created.push(release.id);
  return release;
}

beforeAll(async () => {
  preExistingMarkers = new Set(await redis.keys("prewarm:tried:*"));
});

beforeEach(() => {
  // Every upstream call the sweep might make, stubbed: this test is about the
  // sweep's discipline, and it must never touch a third party.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await settleEnrichments();
});

afterAll(async () => {
  if (created.length) {
    await prisma.rating.deleteMany({ where: { releaseId: { in: created } } });
    await prisma.release.deleteMany({ where: { id: { in: created } } });
  }
  await prisma.release.deleteMany({ where: { musicbrainzId: { startsWith: RUN } } });

  // Every marker this run added, including those on real catalog rows the sweep
  // legitimately picked up. Leaving them would suppress pre-warming of those
  // releases for a week, from a test.
  const after = await redis.keys("prewarm:tried:*");
  const added = after.filter((k) => !preExistingMarkers.has(k));
  if (added.length) await redis.del(...added);
  await prisma.$disconnect();
  await redis.quit().catch(() => {});
});

describe("catalog pre-warming", () => {
  it("never creates a release row — it only finishes ones we already hold", async () => {
    await incompleteRelease("held");
    const before = await prisma.release.count();

    await prewarmOnce(3);
    await settleEnrichments();

    // `discographyService`'s invariant: nothing is bulk-seeded. A background job
    // that quietly started creating rows would overturn a documented law without
    // anyone deciding to.
    expect(await prisma.release.count()).toBe(before);
  }, 60_000);

  it("remembers an attempt, so a legitimately-empty release is not re-swept forever", async () => {
    const release = await incompleteRelease("remembered");

    const first = await prewarmOnce(20);
    await settleEnrichments();
    expect(first.attempted).toContain(release.id);

    // Some releases genuinely have no label and no art (§1: `null` is a real
    // answer). Without a memory of trying, the sweep would converge on re-asking
    // upstream questions it has already had answered.
    const second = await prewarmOnce(20);
    await settleEnrichments();
    expect(second.attempted).not.toContain(release.id);
    expect(second.skipped).toBeGreaterThan(0);
  }, 60_000);

  it("only considers releases that have a source to re-fetch from", async () => {
    const orphan = await prisma.release.create({
      data: {
        title: `Orphan ${RUN}`,
        artistName: `Artist ${RUN}`,
        musicbrainzId: null,
        discogsId: null,
        coverUrl: null,
        labelId: null,
        genres: [],
        type: "ALBUM",
      },
    });
    created.push(orphan.id);

    const result = await prewarmOnce(20);
    await settleEnrichments();

    // A row with neither id can never be healed, so sweeping it would burn a
    // slot on a guaranteed no-op every single cycle.
    expect(result.attempted).not.toContain(orphan.id);
  }, 60_000);
});
