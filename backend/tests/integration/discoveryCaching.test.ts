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

    const results = await searchMusicBrainzArtists(query);
    // The CALLER still degrades to empty — that part of §7 is unchanged.
    expect(results).toEqual([]);

    // But nothing was persisted, so the next attempt is a real one.
    expect(await redis.get(artistKey(query))).toBeNull();
  });

  it("recovers on the next call once MusicBrainz answers", async () => {
    const query = `Recovers ${RUN}`;
    keys.push(artistKey(query));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("service unavailable", { status: 503 }))
    );
    expect(await searchMusicBrainzArtists(query)).toEqual([]);

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

    // Served from Redis, not from a second upstream call.
    expect(await searchMusicBrainzArtists(query)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache an unconfirmed release-group MATCH, so the heal can still run", async () => {
    const artist = `Artist ${RUN}`;
    const title = `Title ${RUN}`;
    keys.push(`mb:rg:match:${artist}:${title}`.toLowerCase());

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("service unavailable", { status: 503 }))
    );
    expect(await findReleaseGroupMbid(artist, title)).toBeNull();
    expect(await redis.get(`mb:rg:match:${artist}:${title}`.toLowerCase())).toBeNull();

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
    expect(await searchReleaseGroups(query)).toEqual([]);
    expect(await redis.get(rgKey(query))).toBeNull();
  });
});
