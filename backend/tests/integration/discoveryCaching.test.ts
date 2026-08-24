/**
 * 6.2e — a DEGRADED discovery search must never be cached.
 *
 * Found while resolving the warming list against the real MusicBrainz: 11 of 489
 * artist searches hit a transient 503, and every one of those query strings was
 * left holding `[]` in Redis with a full week to live. "Elliott Smith" was one of
 * them. A user searching that name would have got nothing back for seven days,
 * from one hiccup.
 *
 * This is §1's defining bug wearing discovery's clothes — a retryable condition
 * turned into a permanent answer and then cached, so the retry never happens —
 * and the fix is the placement of a `try`: outside `cached()` rather than inside
 * it, so a throw keeps the write from happening at all (§2's mechanism).
 *
 * Both halves are asserted, because a fix that stopped caching EVERYTHING would
 * also be wrong: a genuine "no such artist" is a real answer and must still cache
 * (§1), or every nonsense query re-asks MusicBrainz forever.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redis } from "../../src/config/redis.js";
import {
  findReleaseGroupMbid,
  searchMusicBrainzArtists,
  searchReleaseGroups,
  releaseGroupMatchCacheKey,
  UpstreamUnavailableError,
} from "../../src/services/musicbrainzService.js";
import { runTag } from "../support/runTag.js";

const RUN = runTag("disc");
/** Every key this file writes, deleted by name at the end — never by pattern. */
const keys: string[] = [];

const artistKey = (q: string) => `mb:artist:search:${q.toLowerCase()}`;
const rgKey = (q: string) => `mb:rg:search:${q.toLowerCase()}`;

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  if (keys.length) await redis.del(...keys).catch(() => {});
  await redis.quit().catch(() => {});
});

beforeEach(() => vi.unstubAllGlobals());

describe("discovery search caching", () => {
  it("does NOT cache an artist search degraded by a 503", async () => {
    const query = `Degraded ${RUN}`;
    keys.push(artistKey(query));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("service unavailable", { status: 503 }))
    );

    // DELIBERATE CONTRACT CHANGE (6.3e, §9).
    //
    // This used to assert `results).toEqual([])` — "the CALLER still degrades to
    // empty". That degradation was the bug. Returning `[]` made "MusicBrainz is
    // unreachable" and "this artist does not exist" the same value, so three
    // real artists (Xiu Xiu, The Blue Nile, The Chromatics) read as non-existent
    // site-wide. §7 keeps this at ONE attempt — that is unchanged — but §7 also
    // says what the answer must be when the attempt fails: "One attempt is a
    // policy about how hard we try, never a claim the artwork is absent: the
    // answer is still 503, never 404."
    //
    // Degrading is now the CALLER's decision, made where there is enough context
    // to make it (see `searchArtists`: serve seeded results if we have any,
    // otherwise surface the outage).
    await expect(searchMusicBrainzArtists(query)).rejects.toThrow(UpstreamUnavailableError);

    // Unchanged, and still the point of this test: nothing was persisted, so the
    // next attempt is a real one.
    expect(await redis.get(artistKey(query))).toBeNull();
  });

  it("recovers on the next call once MusicBrainz answers", async () => {
    const query = `Recovers ${RUN}`;
    keys.push(artistKey(query));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("service unavailable", { status: 503 }))
    );
    await expect(searchMusicBrainzArtists(query)).rejects.toThrow(UpstreamUnavailableError);

    // This is the assertion that would have failed before the fix: the cached
    // `[]` short-circuited the recovery for a week, so the retry never reached
    // MusicBrainz at all.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ artists: [{ id: "mbid-1", name: "Found" }] }), {
            status: 200,
          })
      )
    );
    const recovered = await searchMusicBrainzArtists(query);
    expect(recovered.map((a) => a.name)).toEqual(["Found"]);
  });

  it("DOES cache a genuine empty result", async () => {
    const query = `GenuinelyAbsent ${RUN}`;
    keys.push(artistKey(query));

    // A 200 carrying no artists is a real answer, not a failure — §1's "`null` is
    // a real outcome". Re-asking it forever is what a cache with no memory of
    // definitive answers converges on.
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ artists: [] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await searchMusicBrainzArtists(query)).toEqual([]);
    expect(await redis.get(artistKey(query))).toBe("[]");

    // ...but for MINUTES, not the week a real result gets (6.3e).
    //
    // MusicBrainz answers `?query=` from a Solr index that is a separate service
    // from its main database and degrades independently — and a degraded Solr
    // returns HTTP 200 with zero results, which is byte-identical to the genuine
    // absence this test is describing. There is no way to tell them apart from
    // the response, so the empty answer is cached as a WEAK one: still cached
    // (re-asking forever is the failure mode this test was written to prevent),
    // just not for long enough that one bad minute upstream costs a week.
    const ttl = await redis.ttl(artistKey(query));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10 * 60);

    // Served from Redis, not from a second upstream call.
    expect(await searchMusicBrainzArtists(query)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache an unconfirmed release-group MATCH, so the heal can still run", async () => {
    const artist = `Artist ${RUN}`;
    const title = `Title ${RUN}`;
    // The key comes from the implementation, never rebuilt here: a hand-built
    // key that drifts out of date makes the `toBeNull()` below pass because it
    // is reading a key nothing ever writes.
    const matchKey = releaseGroupMatchCacheKey(artist, title);
    keys.push(matchKey);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("service unavailable", { status: 503 }))
    );
    expect(await findReleaseGroupMbid(artist, title)).toBeNull();
    expect(await redis.get(matchKey)).toBeNull();

    // The point of the fix: seeding without an MBID is only acceptable because a
    // later access attaches it. With the degraded null cached, that later access
    // returned the cached null and attached nothing for a week — leaving the row
    // without the canonical identity §3 is built on.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ "release-groups": [{ id: "rg-mbid-1", title, score: 100 }] }),
            { status: 200 }
          )
      )
    );
    expect(await findReleaseGroupMbid(artist, title)).toBe("rg-mbid-1");
  });

  it("applies the same rule to release-group search", async () => {
    const query = `RgDegraded ${RUN}`;
    keys.push(rgKey(query));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("service unavailable", { status: 503 }))
    );

    // The sibling function had the identical shape and the identical bug; fixing
    // one and not the other would leave release search poisoning itself instead.
    //
    // DELIBERATE CONTRACT CHANGE (6.3e, §9): this used to assert `[]`. It now
    // throws, because `searchCatalog` counts sources that THREW to decide
    // whether every source failed — and while this swallowed, that count could
    // never include MusicBrainz, so a total outage read as "no matching
    // releases". Per-source degradation still happens, in `searchCatalog`.
    await expect(searchReleaseGroups(query)).rejects.toThrow(UpstreamUnavailableError);
    expect(await redis.get(rgKey(query))).toBeNull();
  });
});
