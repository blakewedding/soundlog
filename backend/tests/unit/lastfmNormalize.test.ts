// Regression: MusicBrainz titles use typographic Unicode ("Mix‐Up" with U+2010
// HYPHEN, curly quotes, en dashes); Last.fm keys on ASCII spellings, so
// un-normalized queries silently returned zero tags (seen live: "Mix‐Up,
// Volume 2" seeded with empty genres).
import { describe, it, expect, afterEach, afterAll, vi } from "vitest";
import { normalizeForLastfm, getAlbumGenres } from "../../src/services/lastfmService.js";
import { redis } from "../../src/config/redis.js";

afterEach(() => vi.unstubAllGlobals());

describe("normalizeForLastfm", () => {
  it("folds the typographic hyphen in “Mix‐Up, Volume 2” to ASCII", () => {
    const title = "Mix‐Up, Volume 2"; // the exact MB spelling
    expect(title).not.toBe("Mix-Up, Volume 2"); // really is a different char
    expect(normalizeForLastfm(title)).toBe("Mix-Up, Volume 2");
  });

  it("folds curly apostrophes, dashes, and ellipses", () => {
    expect(normalizeForLastfm("Isn’t Anything")).toBe("Isn't Anything");
    expect(normalizeForLastfm("Song — Part 2 – Reprise")).toBe("Song - Part 2 - Reprise");
    expect(normalizeForLastfm("And So On…")).toBe("And So On...");
  });

  it("leaves plain ASCII untouched", () => {
    expect(normalizeForLastfm("OK Computer")).toBe("OK Computer");
  });
});

describe("getAlbumTags sends the folded form to Last.fm", () => {
  it("queries with ASCII, not the typographic original", async () => {
    const RUN = Date.now().toString(36);
    const title = `Mix‐Up, Volume ${RUN}`; // unique per run to dodge the cache
    const captured: string[] = [];

    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      captured.push(String(input));
      return Promise.resolve(
        new Response(JSON.stringify({ toptags: { tag: [{ name: "Techno" }] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    });

    const genres = await getAlbumGenres(`Jeff Mills ${RUN}`, title);
    expect(genres).toEqual(["techno"]);
    expect(captured).toHaveLength(1);
    // Decode the actual query params rather than assuming an encoding style.
    const params = new URL(captured[0]).searchParams;
    expect(params.get("album")).toBe(`Mix-Up, Volume ${RUN}`); // folded to ASCII
    expect(captured[0]).not.toContain(encodeURIComponent("‐")); // U+2010 gone
  });
});

// getAlbumGenres caches through redis — close the handle so vitest can exit.
afterAll(async () => {
  await redis.quit().catch(() => {});
});
