/**
 * 6.3 — a warm sweep hands resolved artwork to the release row.
 *
 * Before this, the fleet resolved the right cover every night and threw it away.
 * *One From the Heart* was the proof found in production: `caa:rg:urls:69393ad0…`
 * held a valid Cover Art Archive URL while that release's `coverUrl` column was
 * NULL and the album rendered blank on every surface. The cache had the answer
 * and no way to hand it over, because the on-access heal only fills a cover
 * during a SEED and a GET by internal id is a `findUnique` and nothing more.
 *
 * The guard is deliberately narrow — missing, or sourced from the Discogs
 * fallback. Those are exactly the two populations the 6.3 defects produced
 * (blanks from a 5xx cached as "no art", label scans from ranking a square vinyl
 * label above the declared front). A Cover Art Archive cover we already hold is
 * canonical (§3) and must be left alone, or the sweep would flip-flop nightly.
 *
 * Warming still creates NOTHING: every write below is an UPDATE to a row that
 * already existed, matched by MBID, and a release we do not hold is a no-op.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { warmOnce } from "../../src/services/warmService.js";
import { isDiscogsSourcedCover } from "../../src/services/coverRepair.js";
import { toProxiedUrl, COVER_THUMB_WIDTH } from "../../src/services/coverProxy.js";
import { deleteReleaseEverywhere } from "../../src/services/catalogService.js";
import { discographyCacheKey } from "../../src/services/musicbrainzService.js";
import { runTag } from "../support/runTag.js";

const RUN = runTag("warmcover");

const releaseIds: string[] = [];
const targetIds: string[] = [];
const touchedKeys: string[] = [];

/**
 * A warm target per test, never one shared across them.
 *
 * `needsWarming` only selects targets inside the 26-hour refresh window, so a
 * second sweep of the SAME artist within a run is correctly a no-op — its keys
 * are still fresh from the first. Sharing one target made every test after the
 * first pass vacuously, asserting on a sweep that never ran.
 */
async function warmArtist(name: string): Promise<string> {
  const artistMbid = `${RUN}-artist-${name}`;
  const row = await prisma.warmTarget.create({
    data: { artistMbid, name: `Waits Fixture ${name} ${RUN}`, source: "CURATED", weight: 0 },
  });
  targetIds.push(row.id);
  touchedKeys.push(discographyCacheKey(artistMbid));
  return artistMbid;
}

const DISCOGS_LABEL_SCAN = "https://i.discogs.com/abc/R-725926-1415564276-3493.jpeg";
const CAA_FRONT_500 = "https://coverartarchive.org/release/orig/front-500.jpg";
const CAA_FRONT_LARGE = "https://coverartarchive.org/release/orig/front.jpg";

/** A release-group MBID that is also the Release row's musicbrainzId (§3). */
const groupMbid = (n: string) => `${RUN}-rg-${n}`;

async function release(n: string, coverUrl: string | null) {
  const row = await prisma.release.create({
    data: {
      title: `Cover Repair ${n} ${RUN}`,
      artistName: `Waits Fixture ${RUN}`,
      musicbrainzId: groupMbid(n),
      type: "ALBUM",
      genres: [],
      coverUrl,
    },
  });
  releaseIds.push(row.id);
  touchedKeys.push(`caa:rg:urls:${groupMbid(n)}`);
  return row;
}

function stubUpstream(groups: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/release-group?artist=")) {
        return new Response(
          JSON.stringify({
            "release-group-count": groups.length,
            "release-groups": groups.map((g) => ({
              id: groupMbid(g),
              title: `Cover Repair ${g} ${RUN}`,
              "primary-type": "Album",
            })),
          }),
          { status: 200 }
        );
      }
      // Every release-group resolves to one approved front.
      if (u.includes("coverartarchive.org/release-group/")) {
        return new Response(
          JSON.stringify({
            images: [
              {
                front: true,
                approved: true,
                types: ["Front"],
                image: CAA_FRONT_LARGE,
                thumbnails: { "500": CAA_FRONT_500, "1200": CAA_FRONT_LARGE },
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    })
  );
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await redis.del("warm:sweep:lock").catch(() => {});
});

afterAll(async () => {
  if (targetIds.length) await prisma.warmTarget.deleteMany({ where: { id: { in: targetIds } } });
  for (const id of releaseIds) await deleteReleaseEverywhere(id).catch(() => {});
  if (touchedKeys.length) await redis.del(...touchedKeys).catch(() => {});
  await prisma.$disconnect();
  await redis.quit().catch(() => {});
});

describe("warm sweep repairs stored covers", () => {
  it("fills a NULL cover with the resolved front (the One From the Heart shape)", async () => {
    const artist = await warmArtist("blank");
    const row = await release("blank", null);
    stubUpstream(["blank"]);

    const result = await warmOnce({ only: [artist] });
    expect(result.attempted.map((a) => a.artistMbid)).toContain(artist);

    const after = await prisma.release.findUnique({ where: { id: row.id } });
    expect(after?.coverUrl, "a blank release stayed blank while the cache held its art").not.toBeNull();
    expect(after?.coverUrl).toBe(toProxiedUrl(CAA_FRONT_500, COVER_THUMB_WIDTH));
  }, 60_000);

  it("replaces a Discogs-sourced cover — the label scans (Small Change shape)", async () => {
    const artist = await warmArtist("labelscan");
    const stored = toProxiedUrl(DISCOGS_LABEL_SCAN, COVER_THUMB_WIDTH)!;
    const row = await release("labelscan", stored);
    expect(isDiscogsSourcedCover(stored)).toBe(true);
    stubUpstream(["labelscan"]);

    const result = await warmOnce({ only: [artist] });
    expect(result.attempted.map((a) => a.artistMbid)).toContain(artist);

    const after = await prisma.release.findUnique({ where: { id: row.id } });
    expect(after?.coverUrl).toBe(toProxiedUrl(CAA_FRONT_500, COVER_THUMB_WIDTH));
  }, 60_000);

  it("leaves an existing Cover Art Archive cover alone", async () => {
    const artist = await warmArtist("keepcaa");
    const stored = toProxiedUrl("https://coverartarchive.org/release/keep/front-500.jpg", COVER_THUMB_WIDTH)!;
    const row = await release("keepcaa", stored);
    expect(isDiscogsSourcedCover(stored)).toBe(false);
    stubUpstream(["keepcaa"]);

    const result = await warmOnce({ only: [artist] });
    expect(result.attempted.map((a) => a.artistMbid)).toContain(artist);

    const after = await prisma.release.findUnique({ where: { id: row.id } });
    // Canonical art is not re-litigated nightly.
    expect(after?.coverUrl).toBe(stored);
  }, 60_000);

  it("creates nothing for a release-group we do not hold", async () => {
    const artist = await warmArtist("nothheld");
    const absent = groupMbid("nothelddontcreate");
    touchedKeys.push(`caa:rg:urls:${absent}`);
    stubUpstream(["nothelddontcreate"]);

    const result = await warmOnce({ only: [artist] });
    expect(result.attempted.map((a) => a.artistMbid)).toContain(artist);

    // The "creates NOTHING" contract at the top of warmService.ts.
    expect(await prisma.release.findUnique({ where: { musicbrainzId: absent } })).toBeNull();
  }, 60_000);
});
