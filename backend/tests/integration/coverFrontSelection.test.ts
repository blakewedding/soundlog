// Cover Art Archive front-cover resolution — the 6.3 defect.
//
// Two bugs lived on one line:
//
//   if (!res.ok) return null; // 404 = no art on file
//
// The comment describes a 404; the code caught every 5xx too, and `cached()`
// then wrote that `null` under a SEVEN-DAY TTL. The archive's release-group
// endpoint answers a persistent 500 for a number of real groups — Tom Waits'
// *Blue Valentine*, *Swordfishtrombones* and *Downtown Train* among them,
// verified live — while the releases INSIDE those groups serve approved front
// covers perfectly well. Every one of those albums rendered blank across the
// whole app because a server error had been recorded as "no artwork exists".
//
// The second was the selection itself: `find(front) ?? images[0]` hands the
// cover slot to whatever was uploaded first when nothing is flagged, which is
// commonly a `Medium` label or disc scan.
import { describe, it, expect, afterEach, afterAll, vi } from "vitest";
import { redis } from "../../src/config/redis.js";
import { getCoverArtUrls, UpstreamUnavailableError } from "../../src/services/musicbrainzService.js";
import { runTag } from "../support/runTag.js";

const RUN = runTag();
const realFetch = globalThis.fetch.bind(globalThis);
const keys: string[] = [];

function mbid(label: string): string {
  const id = `${label}-${RUN}`;
  keys.push(`caa:rg:urls:${id}`);
  return id;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const frontImage = (name: string) => ({
  front: true,
  approved: true,
  types: ["Front"],
  image: `https://caa.example/${name}.jpg`,
  thumbnails: { "500": `https://caa.example/${name}-500.jpg`, "1200": `https://caa.example/${name}-1200.jpg` },
});

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  for (const k of keys) await redis.del(k);
  await redis.quit().catch(() => {});
});

describe("getCoverArtUrls — three outcomes, never two", () => {
  it("raises a 500 as retry-able instead of caching it as 'no art'", async () => {
    const id = mbid("caa500");
    await redis.del(`caa:rg:urls:${id}`);
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("coverartarchive.org")) return Promise.resolve(new Response("boom", { status: 500 }));
      // No releases in the group, so the fallback cannot rescue it either.
      if (url.includes("musicbrainz.org")) return Promise.resolve(json({ releases: [] }));
      return realFetch(input, init);
    });

    await expect(getCoverArtUrls(id)).rejects.toBeInstanceOf(UpstreamUnavailableError);
    // The critical half: nothing written, so a later visit can still find the art.
    expect(await redis.get(`caa:rg:urls:${id}`)).toBeNull();
  });

  it("still caches a definitive 404 as 'no art on file'", async () => {
    const id = mbid("caa404");
    await redis.del(`caa:rg:urls:${id}`);
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("coverartarchive.org")) return Promise.resolve(new Response("", { status: 404 }));
      if (url.includes("musicbrainz.org")) return Promise.resolve(json({ releases: [] }));
      return realFetch(input, init);
    });

    expect(await getCoverArtUrls(id)).toBeNull();
    // A genuine absence IS worth remembering — that half of §1 is unchanged.
    expect(await redis.get(`caa:rg:urls:${id}`)).toBe("null");
  });

  it("finds art on a release when the group endpoint is broken (Blue Valentine)", async () => {
    const id = mbid("caaGroupBroken");
    await redis.del(`caa:rg:urls:${id}`);
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      // The group endpoint 500s, exactly as it does in production for this album.
      if (url.includes(`/release-group/${id}`)) return Promise.resolve(new Response("boom", { status: 500 }));
      if (url.includes("musicbrainz.org")) {
        return Promise.resolve(
          json({
            releases: [
              { id: "reissue-2018", date: "2018-03-09" },
              // MusicBrainz returns an EMPTY STRING for an undated pressing, and
              // "" sorts before "1978" — this is the shape that put a dateless
              // reissue ahead of the original sleeve on the first live run.
              { id: "undated-reissue", date: "" },
              { id: "original-1978", date: "1978" }, // earliest — must be tried first
            ],
          })
        );
      }
      if (url.includes("/release/original-1978")) {
        return Promise.resolve(json({ images: [frontImage("original")] }));
      }
      if (url.includes("/release/reissue-2018")) {
        return Promise.resolve(json({ images: [frontImage("reissue")] }));
      }
      if (url.includes("/release/undated-reissue")) {
        return Promise.resolve(json({ images: [frontImage("undated")] }));
      }
      return realFetch(input, init);
    });

    const urls = await getCoverArtUrls(id);
    // The original pressing's sleeve, not the reissue's alternate art (§4's
    // "original, never pressings" discipline applied to artwork).
    expect(urls?.thumb).toBe("https://caa.example/original-500.jpg");
  });

  it("never serves a label scan when the group has no approved front", async () => {
    const id = mbid("caaMediumOnly");
    await redis.del(`caa:rg:urls:${id}`);
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes(`/release-group/${id}`)) {
        return Promise.resolve(
          json({
            images: [
              // A side-one label scan, uploaded first and flagged nothing.
              { front: false, approved: true, types: ["Medium"], image: "https://caa.example/label.jpg" },
            ],
          })
        );
      }
      if (url.includes("musicbrainz.org")) return Promise.resolve(json({ releases: [] }));
      return realFetch(input, init);
    });

    // The placeholder is the correct answer here. A wrong cover reads as our
    // data being wrong; an absent one reads as absent.
    expect(await getCoverArtUrls(id)).toBeNull();
  });

  it("ignores an unapproved front", async () => {
    const id = mbid("caaUnapproved");
    await redis.del(`caa:rg:urls:${id}`);
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes(`/release-group/${id}`)) {
        return Promise.resolve(
          json({ images: [{ ...frontImage("unapproved"), approved: false }] })
        );
      }
      if (url.includes("musicbrainz.org")) return Promise.resolve(json({ releases: [] }));
      return realFetch(input, init);
    });

    expect(await getCoverArtUrls(id)).toBeNull();
  });
});
