/**
 * 6.2e — artist pre-warming.
 *
 * The properties worth testing are the ones that would make this job harmful
 * rather than merely useless:
 *
 *   - it must create NO rows (the whole basis on which it was allowed to exist —
 *     see the service header, and `discographyService`'s bulk-seed invariant);
 *   - it must not re-do work that is already warm, or a nightly sweep becomes a
 *     nightly re-fetch of the entire list;
 *   - a layer that fails must not cost the layers that would have succeeded;
 *   - it must run at the `background` tier, so it always yields to a person.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { warmOnce, warmTarget } from "../../src/services/warmService.js";
import {
  artistLookupCacheKey,
  artistSearchCacheKey,
  discographyCacheKey,
  releaseGroupSearchCacheKey,
} from "../../src/services/musicbrainzService.js";
import { runTag } from "../support/runTag.js";

const RUN = runTag("warm");
const createdTargets: string[] = [];
const touchedKeys: string[] = [];

/** A synthetic MBID-shaped id, tagged so cleanup can find it. */
const mbidFor = (n: string) => `${RUN}-${n}`;

/**
 * EVERY sweep in this file is scoped with `only`, and that is not tidiness.
 *
 * `warmOnce` sweeps the whole enabled list — that is what it does in production,
 * and scoping it by batch size does not work: fixtures sort below 490 real
 * targets, and a sweep whose batch outruns the due fixtures simply continues into
 * real rows. It did. A stubbed run warmed **The Beatles, Led Zeppelin and 18
 * others**, caching `[]` as their discography and `{}` as their artist lookup for
 * seven days — the exact poisoned-cache failure 6.2e had just fixed in
 * `searchMusicBrainzArtists`, reintroduced from the test side and invisible until
 * someone read the table.
 *
 * `prewarm.test.ts` deals with the same hazard by snapshot-and-delta on Redis.
 * This is the stronger version: the sweep cannot SELECT a row the test did not
 * name, so there is nothing to clean up and nothing to remember to clean up.
 */
async function target(name: string, weight = 0) {
  const row = await prisma.warmTarget.create({
    data: { artistMbid: mbidFor(name), name: `${name} ${RUN}`, source: "CURATED", weight },
  });
  createdTargets.push(row.id);
  touchedKeys.push(
    discographyCacheKey(row.artistMbid),
    artistLookupCacheKey(row.artistMbid),
    artistSearchCacheKey(row.name),
    releaseGroupSearchCacheKey(row.name)
  );
  return row;
}

/**
 * MusicBrainz answers that are well-formed but empty. Enough for every layer to
 * succeed and cache, without this suite touching a third party.
 */
function stubUpstream() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/release-group?artist=")) {
        return new Response(JSON.stringify({ "release-group-count": 0, "release-groups": [] }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    })
  );
}

beforeEach(() => {
  stubUpstream();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await redis.del("warm:sweep:lock").catch(() => {});
});

afterAll(async () => {
  // The backstop, not the mechanism: `only` is what keeps real rows out of a
  // sweep. This FAILS the run if one was touched anyway, because the damage is
  // otherwise silent — a real artist with `[]` cached as its discography looks
  // exactly like a real artist with no releases, for a week.
  const realTouched = await prisma.warmTarget.count({
    where: { lastWarmedAt: { not: null }, id: { notIn: createdTargets } },
  });

  if (createdTargets.length) {
    await prisma.warmTarget.deleteMany({ where: { id: { in: createdTargets } } });
  }
  // Cached answers written against synthetic MBIDs would otherwise sit in Redis
  // for a week. Only this run's keys — never a pattern that could reach real ones.
  if (touchedKeys.length) await redis.del(...touchedKeys).catch(() => {});
  await prisma.$disconnect();
  await redis.quit().catch(() => {});

  if (realTouched > 0) {
    throw new Error(
      `warm.test.ts swept ${realTouched} REAL WarmTarget row(s). Their MusicBrainz ` +
        `caches now hold stubbed answers and must be purged — see the note on target().`
    );
  }
});

describe("artist pre-warming", () => {
  it("creates no Release and no Artist row", async () => {
    await target("creates-nothing");

    // Watch the INSERT methods rather than counting rows: the suite runs against
    // one database, so a global count measures other files' writes too — the
    // hazard prewarm.test.ts documents at length. Wrapped by hand rather than
    // with vi.spyOn for the same reason it gives: Prisma's delegate methods are
    // lazily-created own properties, and mockRestore() deletes them.
    const methods = ["create", "createMany", "upsert"] as const;
    const watched = [
      ["release", prisma.release],
      ["artist", prisma.artist],
    ] as const;
    const originals = new Map<string, unknown>();
    const called: string[] = [];

    for (const [label, delegate] of watched) {
      for (const m of methods) {
        originals.set(`${label}.${m}`, delegate[m]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (delegate as any)[m] = (...args: unknown[]) => {
          called.push(`${label}.${m}`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (originals.get(`${label}.${m}`) as any).apply(delegate, args);
        };
      }
    }

    try {
      await warmOnce({ only: [mbidFor("creates-nothing")] });
      // The Artist row in particular is NOT an oversight. Materializing the list
      // would give every warmed artist a live releaseCount of 0, which Search.tsx
      // renders as "0 releases" — a dead end — where null renders an invitation.
      expect(called, "warming issued a row insert").toEqual([]);
    } finally {
      for (const [label, delegate] of watched) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const m of methods) (delegate as any)[m] = originals.get(`${label}.${m}`);
      }
    }
  }, 60_000);

  it("skips a target that is already warm, and warms one that is not", async () => {
    const row = await target("already-warm");

    const first = await warmOnce({ only: [row.artistMbid] });
    expect(first.attempted.map((a) => a.artistMbid)).toContain(row.artistMbid);

    // Everything the first sweep fetched is cached for a week, so a second sweep
    // the same night must find it beyond the refresh window and do nothing. This
    // is what makes a nightly job cost a seventh of the list rather than all of
    // it.
    const second = await warmOnce({ only: [row.artistMbid] });
    expect(second.attempted.map((a) => a.artistMbid)).not.toContain(row.artistMbid);
    expect(second.skipped).toBeGreaterThan(0);
  }, 60_000);

  it("re-warms a target whose discography is fresh but whose search key is gone", async () => {
    const row = await target("stale-search");

    await warmOnce({ only: [row.artistMbid] });
    // Everything is warm, so the sweep has nothing to do — the baseline.
    const quiet = await warmOnce({ only: [row.artistMbid] });
    expect(quiet.attempted).toEqual([]);

    // Now lose ONE layer while the expensive one stays fresh. This is not
    // contrived: it is what a targeted cache purge does, and what ordinary
    // browsing does — a visit warms the discography and never writes the search
    // key, because nobody searched that exact string.
    await redis.del(artistSearchCacheKey(row.name));

    // The old bellwether read only the discography, saw it fresh, and skipped —
    // which on the first production run left 14 of 20 skipped targets with cold
    // search keys, among them Radiohead, The Beatles and Aphex Twin.
    const after = await warmOnce({ only: [row.artistMbid] });
    expect(after.attempted.map((a) => a.artistMbid)).toContain(row.artistMbid);
    expect(await redis.exists(artistSearchCacheKey(row.name))).toBe(1);
  }, 60_000);

  it("records a failed layer without abandoning the others", async () => {
    // Artist lookup fails; the searches and the discography still succeed.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes("/artist/") && !u.includes("query=")) {
          return new Response("upstream is having a bad day", { status: 503 });
        }
        if (u.includes("/release-group?artist=")) {
          return new Response(JSON.stringify({ "release-group-count": 0, "release-groups": [] }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      })
    );

    const outcome = await warmTarget(mbidFor("partial-failure"), `Partial ${RUN}`);
    touchedKeys.push(
      discographyCacheKey(mbidFor("partial-failure")),
      artistLookupCacheKey(mbidFor("partial-failure"))
    );

    expect(outcome.failed).toContain("artist.lookup");
    expect(outcome.warmed).toContain("search.artist");
    expect(outcome.warmed).toContain("discography");
  }, 60_000);

  it("holds a Redis lock, so two sweeps cannot run at once", async () => {
    await target("locked");
    await redis.set("warm:sweep:lock", "held-by-someone-else", "EX", 60);

    const result = await warmOnce({ only: [mbidFor("locked")] });

    // Not a correctness disaster if it happened — the layers are idempotent — but
    // two sweeps double the background load on a gate whose whole point is that a
    // person gets the next slot.
    expect(result.lockedOut).toBe(true);
    expect(result.attempted).toEqual([]);
  }, 30_000);
});
