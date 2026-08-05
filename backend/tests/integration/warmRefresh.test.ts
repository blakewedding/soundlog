/**
 * 6.2g — a warm sweep must REFRESH, not merely read.
 *
 * The bug this pins is the one a passing suite and six clean nightly logs both
 * missed. `needsWarming` selected targets inside the 26-hour window correctly
 * every night; `warmTarget` then "warmed" them with plain `cached()` calls,
 * which return the hit and never touch the expiry. The keys expired on their
 * original schedule anyway, and the log said `0 with failures` each time.
 *
 * Measured on production 2026-08-05, six days after the cold pass: 1,890 of
 * 1,960 warmed layers sat inside the refresh window simultaneously, and the only
 * 65 with healthy TTLs were the ones that had genuinely expired and so were
 * genuinely re-fetched. 97% of the fleet was due to expire in one 12-hour block.
 *
 * The two properties below are exactly what the logs could not tell anyone:
 * whether upstream was really asked, and whether the TTL really moved.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { warmOnce } from "../../src/services/warmService.js";
import {
  artistLookupCacheKey,
  artistSearchCacheKey,
  discographyCacheKey,
  releaseGroupSearchCacheKey,
} from "../../src/services/musicbrainzService.js";
import { runTag } from "../support/runTag.js";

const RUN = runTag("warmrefresh");
const createdTargets: string[] = [];
const touchedKeys: string[] = [];

const WEEK_SECONDS = 7 * 24 * 60 * 60;
const REFRESH_WINDOW_SECONDS = 26 * 60 * 60;
/** Matches WARM_TTL_JITTER_SECONDS in warmService.ts. */
const JITTER_SECONDS = 4 * 24 * 60 * 60;

const mbidFor = (n: string) => `${RUN}-${n}`;

/**
 * Every sweep here is scoped with `only`, for the reason warm.test.ts documents
 * at length: an unscoped sweep continues past the fixtures into the 490 real
 * targets and caches stubbed answers against them for a week.
 */
async function target(name: string) {
  const row = await prisma.warmTarget.create({
    data: { artistMbid: mbidFor(name), name: `${name} ${RUN}`, source: "CURATED", weight: 0 },
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

function keysFor(row: { artistMbid: string; name: string }) {
  return [
    discographyCacheKey(row.artistMbid),
    artistLookupCacheKey(row.artistMbid),
    artistSearchCacheKey(row.name),
    releaseGroupSearchCacheKey(row.name),
  ];
}

/** Count only the MusicBrainz calls, so the assertion is about upstream work. */
let mbCalls = 0;

function stubUpstream() {
  mbCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("musicbrainz.org")) mbCalls++;
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
  const realTouched = await prisma.warmTarget.count({
    where: { lastWarmedAt: { not: null }, id: { notIn: createdTargets } },
  });

  if (createdTargets.length) {
    await prisma.warmTarget.deleteMany({ where: { id: { in: createdTargets } } });
  }
  if (touchedKeys.length) await redis.del(...touchedKeys).catch(() => {});
  await prisma.$disconnect();
  await redis.quit().catch(() => {});

  if (realTouched > 0) {
    throw new Error(
      `warmRefresh.test.ts swept ${realTouched} REAL WarmTarget row(s). Their ` +
        `MusicBrainz caches now hold stubbed answers and must be purged.`
    );
  }
});

describe("a warm sweep refreshes rather than reads", () => {
  it("re-fetches a PRESENT key inside the refresh window and re-dates its TTL", async () => {
    const row = await target("inside-window");
    const keys = keysFor(row);

    await warmOnce({ only: [row.artistMbid] });
    for (const k of keys) expect(await redis.exists(k), `${k} should be warm`).toBe(1);

    // Age every layer into the refresh window WITHOUT deleting it. This is the
    // exact production state: the key is present and holds a perfectly good
    // answer, it is simply close to expiring. Under the old code this is where
    // warming quietly did nothing.
    const AGED = 10 * 60 * 60;
    for (const k of keys) await redis.expire(k, AGED);
    for (const k of keys) expect(await redis.ttl(k)).toBeLessThan(REFRESH_WINDOW_SECONDS);

    mbCalls = 0;
    const second = await warmOnce({ only: [row.artistMbid] });

    // 1. The target was selected. This half already worked — needsWarming was
    //    never the bug, which is why six nights of logs looked healthy.
    expect(second.attempted.map((a) => a.artistMbid)).toContain(row.artistMbid);

    // 2. Upstream was actually asked. THIS is what the old code failed: every
    //    layer was a Redis hit and `fetch` was never called.
    expect(mbCalls, "warming did not re-fetch — it read the cache and extended nothing").toBeGreaterThan(0);

    // 3. And the TTL genuinely moved. A sweep that re-fetches but leaves the key
    //    expiring on its original schedule would still produce the cliff.
    for (const k of keys) {
      const ttl = await redis.ttl(k);
      expect(ttl, `${k} TTL was not re-dated`).toBeGreaterThan(REFRESH_WINDOW_SECONDS);
      expect(ttl, `${k} TTL exceeds the freshness bound`).toBeLessThanOrEqual(WEEK_SECONDS);
    }
  }, 60_000);

  it("writes jittered TTLs, so a fleet warmed together cannot expire together", async () => {
    const rows = [
      await target("jitter-a"),
      await target("jitter-b"),
      await target("jitter-c"),
      await target("jitter-d"),
      await target("jitter-e"),
      await target("jitter-f"),
    ];

    await warmOnce({ only: rows.map((r) => r.artistMbid) });

    const ttls: number[] = [];
    for (const row of rows) {
      for (const k of keysFor(row)) {
        const ttl = await redis.ttl(k);
        expect(ttl, `${k} below the jitter floor`).toBeGreaterThan(WEEK_SECONDS - JITTER_SECONDS - 60);
        // Subtracted, never added: a TTL stays a bound on staleness.
        expect(ttl, `${k} above the freshness bound`).toBeLessThanOrEqual(WEEK_SECONDS);
        ttls.push(ttl);
      }
    }

    // The point of jitter is SPREAD, and the spread has to be measured rather
    // than counted. Counting distinct values is not a test: an un-jittered sweep
    // already yields two or three, purely because `redis.ttl` ticks down by a
    // second or two while the sweep runs. That version of this assertion passed
    // against the pre-fix code, which makes it worse than no assertion.
    //
    // A synchronized fleet spans ~1 second. A 4-day jitter across 24 draws spans
    // ~3.7 days in expectation. An hour separates those two worlds decisively.
    const spread = Math.max(...ttls) - Math.min(...ttls);
    expect(spread, "warmed TTLs are effectively identical — jitter is not applied").toBeGreaterThan(
      60 * 60
    );
  }, 60_000);

  it("still skips a freshly warmed target, so a sweep is not a nightly full re-fetch", async () => {
    // The counterweight to the two above. Refresh must not become "re-fetch
    // everything every night" — the TTL selection is what bounds the work, and a
    // jittered TTL of 3-7 days is still far outside the 26-hour window.
    const row = await target("stays-skipped");

    await warmOnce({ only: [row.artistMbid] });
    mbCalls = 0;

    const second = await warmOnce({ only: [row.artistMbid] });
    expect(second.attempted.map((a) => a.artistMbid)).not.toContain(row.artistMbid);
    expect(second.skipped).toBeGreaterThan(0);
    expect(mbCalls, "a freshly warmed target was re-fetched anyway").toBe(0);
  }, 60_000);
});
