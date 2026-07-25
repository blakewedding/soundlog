// The cover proxy's HTTP contract. What is worth defending here is the §1
// mapping, because this route is the first place in the app where a wrong answer
// gets frozen into a CDN for a year:
//
//   art exists            → 200, immutable, and the SECOND request is a disk HIT
//   upstream says no art  → 404, cacheable for a day (art gets uploaded later)
//   we could not tell     → 503 + Retry-After + no-store, and NOTHING on disk
//
// The last one is the expensive bug this codebase already paid for once, in a
// different shape: a rate-limited MusicBrainz became "Release not found" and the
// null was cached for a week. An edge-cached 503 — or worse, a cached empty
// rendition — would be the same mistake with Cloudflare's reach behind it.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createApp } from "../../src/app.js";
import { __resetCoverCacheState, coverCacheDir, ensureVariant, sweepCache } from "../../src/services/coverCache.js";
import { toProxiedUrl } from "../../src/services/coverProxy.js";
import { UpstreamUnavailableError } from "../../src/services/musicbrainzService.js";

const app = createApp();
const realFetch = globalThis.fetch.bind(globalThis);

const OK_URL = "https://coverartarchive.org/release/ok/1234.jpg";
const MISSING_URL = "https://coverartarchive.org/release/missing/1234.jpg";
const FLAKY_URL = "https://coverartarchive.org/release/flaky/1234.jpg";
const GARBAGE_URL = "https://coverartarchive.org/release/garbage/1234.jpg";

/** A recognisable stand-in for a cover: 900px, so a 400px render is a downscale. */
async function fakeCover(size = 900): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r: 180, g: 40, b: 40 } },
  })
    .jpeg()
    .toBuffer();
}

let cacheDir: string;
let flakyAttempts = 0;
let upstreamFetches = 0;

beforeAll(async () => {
  cacheDir = await mkdtemp(path.join(tmpdir(), "soundlog-covers-"));
  __resetCoverCacheState(cacheDir);

  const body = await fakeCover();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === OK_URL) {
      upstreamFetches += 1;
      return new Response(body, { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    if (url === MISSING_URL) return new Response("", { status: 404 });
    if (url === FLAKY_URL) {
      flakyAttempts += 1;
      return new Response("", { status: 503 });
    }
    if (url === GARBAGE_URL) {
      return new Response(Buffer.from("this is not an image"), { status: 200 });
    }
    return realFetch(input, init);
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await rm(cacheDir, { recursive: true, force: true });
});

afterEach(() => {
  // Only in-flight state — the point of several cases is that the DISK survives.
  __resetCoverCacheState(cacheDir);
});

describe("GET /covers/w:width/:file", () => {
  it("serves a WebP rendition at the requested width, immutably", async () => {
    const res = await request(app).get(toProxiedUrl(OK_URL, 400));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/webp");
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(res.headers["x-cover-cache"]).toBe("MISS");

    const meta = await sharp(res.body).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(400);
  });

  it("is a disk HIT the second time, with no second upstream fetch", async () => {
    const before = upstreamFetches;
    const res = await request(app).get(toProxiedUrl(OK_URL, 400));

    expect(res.status).toBe(200);
    expect(res.headers["x-cover-cache"]).toBe("HIT");
    expect(upstreamFetches).toBe(before);
  });

  it("honours a conditional request with the content-derived ETag", async () => {
    const first = await request(app).get(toProxiedUrl(OK_URL, 400));
    const res = await request(app)
      .get(toProxiedUrl(OK_URL, 400))
      .set("If-None-Match", first.headers.etag);

    expect(res.status).toBe(304);
  });

  it("renders each width separately, and the small one is smaller", async () => {
    const small = await request(app).get(toProxiedUrl(OK_URL, 96));
    const large = await request(app).get(toProxiedUrl(OK_URL, 1200));

    expect((await sharp(small.body).metadata()).width).toBe(96);
    // withoutEnlargement: a 900px source is never upscaled to 1200.
    expect((await sharp(large.body).metadata()).width).toBe(900);
    expect(small.body.length).toBeLessThan(large.body.length);
  });

  it("beats the original by an order of magnitude at tile size", async () => {
    // The measured baseline: 2,254,558 bytes of JPEG painted into a 140px tile.
    const original = await fakeCover();
    const res = await request(app).get(toProxiedUrl(OK_URL, 200));
    expect(res.body.length).toBeLessThan(original.length / 10);
  });

  it("404s a definitive absence, cacheable for a day but not a year", async () => {
    const res = await request(app).get(toProxiedUrl(MISSING_URL, 400));

    expect(res.status).toBe(404);
    expect(res.headers["cache-control"]).toBe("public, max-age=86400");
  });

  it("404s a URL this app would never emit, without touching upstream", async () => {
    const internal = Buffer.from("http://169.254.169.254/latest/meta-data").toString("base64url");
    const res = await request(app).get(`/covers/w400/${internal}.webp`);
    expect(res.status).toBe(404);

    // An unrendered width, likewise.
    const encoded = toProxiedUrl(OK_URL, 400).split("/")[3];
    expect((await request(app).get(`/covers/w137/${encoded}`)).status).toBe(404);
  });

  it("503s a retryable failure with Retry-After and no-store", async () => {
    const res = await request(app).get(toProxiedUrl(FLAKY_URL, 400));

    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("2");
    // The header that keeps one bad minute at the archive from becoming a day
    // of blank tiles at the edge.
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(flakyAttempts).toBeGreaterThan(1); // it retried before giving up
  });

  it("writes nothing to disk for a retryable failure", async () => {
    // Its own cache root, so "nothing on disk" is an exact claim rather than a
    // count of what earlier cases happened to leave behind.
    const dir = await mkdtemp(path.join(tmpdir(), "soundlog-covers-503-"));
    __resetCoverCacheState(dir);

    expect((await request(app).get(toProxiedUrl(FLAKY_URL, 400))).status).toBe(503);
    expect((await sweepCache(Number.MAX_SAFE_INTEGER)).files).toBe(0);

    await rm(dir, { recursive: true, force: true });
    __resetCoverCacheState(cacheDir);
  });

  it("treats undecodable bytes as absent, not as unavailable", async () => {
    const res = await request(app).get(toProxiedUrl(GARBAGE_URL, 400));
    expect(res.status).toBe(404);
  });
});

describe("ensureVariant", () => {
  it("fetches upstream once for a burst of concurrent requests", async () => {
    const url = "https://coverartarchive.org/release/ok/1234.jpg";
    __resetCoverCacheState(await mkdtemp(path.join(tmpdir(), "soundlog-covers-burst-")));
    const before = upstreamFetches;

    const results = await Promise.all([
      ensureVariant(url, 200),
      ensureVariant(url, 200),
      ensureVariant(url, 200),
    ]);

    expect(results.every((r) => r !== null)).toBe(true);
    expect(upstreamFetches - before).toBe(1);
    await rm(coverCacheDir(), { recursive: true, force: true });
    __resetCoverCacheState(cacheDir);
  });

  it("throws rather than resolving null when it cannot tell", async () => {
    await expect(ensureVariant(FLAKY_URL, 200)).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });
});

describe("sweepCache", () => {
  it("evicts least-recently-used renditions to get back under the bound", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "soundlog-covers-sweep-"));
    __resetCoverCacheState(dir);

    for (const width of [96, 200, 400] as const) await ensureVariant(OK_URL, width);
    const full = await sweepCache(Number.MAX_SAFE_INTEGER);
    expect(full.files).toBe(3);
    expect(full.evicted).toBe(0);

    // A bound below the current footprint must free space, not merely report.
    const swept = await sweepCache(Math.floor(full.totalBytes / 2));
    expect(swept.evicted).toBeGreaterThan(0);
    const after = await sweepCache(Number.MAX_SAFE_INTEGER);
    expect(after.totalBytes).toBeLessThanOrEqual(full.totalBytes / 2);

    await rm(dir, { recursive: true, force: true });
    __resetCoverCacheState(cacheDir);
  });
});
