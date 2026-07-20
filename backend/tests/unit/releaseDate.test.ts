// Release-year policy: the catalog stores the ORIGINAL release date (release-
// group / master level), never an individual pressing (usually a reissue).
// Regression: Soda Stereo "Dynamo" stored 2015 (a Discogs pressing) instead of
// 1992 (the release-group / master original).
import { describe, it, expect, afterEach, afterAll, vi } from "vitest";
import { parseReleaseDate, earliestReleaseDate } from "../../src/services/catalog/releaseDate.js";
import { getDiscogsMasterYear } from "../../src/services/discogsService.js";
import { redis } from "../../src/config/redis.js";

describe("parseReleaseDate", () => {
  it("expands partial dates to full Dates", () => {
    expect(parseReleaseDate("1992")?.toISOString().slice(0, 10)).toBe("1992-01-01");
    expect(parseReleaseDate("1998-06")?.toISOString().slice(0, 10)).toBe("1998-06-01");
    expect(parseReleaseDate("2007-10-10")?.toISOString().slice(0, 10)).toBe("2007-10-10");
    expect(parseReleaseDate(null)).toBeNull();
    expect(parseReleaseDate("not-a-date")).toBeNull();
  });
});

describe("earliestReleaseDate (original wins over reissue)", () => {
  it("prefers the earliest across mixed precision", () => {
    // MB release-group 1992 vs Discogs pressing 2015 → the 1992 original.
    expect(earliestReleaseDate(["2015", "1992"])).toBe("1992");
    expect(earliestReleaseDate(["1998-06-29", "1998"])).toBe("1998"); // year floor
    expect(earliestReleaseDate(["2007-10-10", "2007-01"])).toBe("2007-01");
  });

  it("ignores empty/unparseable candidates", () => {
    expect(earliestReleaseDate([null, undefined, "", "1992"])).toBe("1992");
    expect(earliestReleaseDate([null, undefined])).toBeNull();
  });
});

describe("getDiscogsMasterYear (never a pressing)", () => {
  const realFetch = globalThis.fetch.bind(globalThis);
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await redis.quit().catch(() => {});
  });

  it("follows a specific release (2015 pressing) to its master's 1992 original", async () => {
    const RELEASE_ID = 800000000 + (Date.now() % 1000000); // unique → dodge cache
    const MASTER_ID = RELEASE_ID + 1;
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/releases/${RELEASE_ID}`)) {
        return Promise.resolve(json({ id: RELEASE_ID, title: "Dynamo", year: 2015, master_id: MASTER_ID }));
      }
      if (url.includes(`/masters/${MASTER_ID}`)) {
        return Promise.resolve(json({ id: MASTER_ID, title: "Dynamo", year: 1992 }));
      }
      return realFetch(input, url as RequestInit);
    });

    expect(await getDiscogsMasterYear(`release:${RELEASE_ID}`)).toBe(1992);
  });

  it("uses a master's own year directly", async () => {
    const MASTER_ID = 810000000 + (Date.now() % 1000000);
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/masters/${MASTER_ID}`)) {
        return Promise.resolve(json({ id: MASTER_ID, title: "Dynamo", year: 1992 }));
      }
      return realFetch(input);
    });
    expect(await getDiscogsMasterYear(`master:${MASTER_ID}`)).toBe(1992);
  });

  it("returns null for a standalone pressing with no master (won't store a pressing year)", async () => {
    const RELEASE_ID = 820000000 + (Date.now() % 1000000);
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/releases/${RELEASE_ID}`)) {
        return Promise.resolve(json({ id: RELEASE_ID, title: "Bootleg", year: 2019 })); // no master_id
      }
      return realFetch(input);
    });
    expect(await getDiscogsMasterYear(`release:${RELEASE_ID}`)).toBeNull();
  });
});
