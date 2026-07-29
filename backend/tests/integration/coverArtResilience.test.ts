// Regression (found live during the Phase 5.6 demo): opening an already-seeded
// release 500'd — the page read "We couldn't load that release" — because the
// Cover Art Archive fetch was a RAW, unguarded `fetch`. A dropped TLS socket
// threw `TypeError: fetch failed`, which escaped enrichExisting's cover-art
// self-heal and failed the whole request.
//
// Cover art is supplemental. A CAA outage must degrade to "no art yet", never
// take down a release we already hold. It also must not be cached as a
// definitive "no art" for a week, since a dropped connection tells us nothing.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { deleteReleaseEverywhere } from "../../src/services/catalogService.js";
import { getCoverArtUrls, UpstreamUnavailableError } from "../../src/services/musicbrainzService.js";
import { runTag } from "../support/runTag.js";

const app = createApp();
const RUN = runTag();
const MBID = `caa-fail-${RUN}`;
let releaseId: string;

const realFetch = globalThis.fetch.bind(globalThis);

// Reproduce the exact live failure: the CAA connection drops mid-handshake.
function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("coverartarchive.org")) {
    return Promise.reject(
      Object.assign(new TypeError("fetch failed"), {
        cause: new Error("Client network socket disconnected before secure TLS connection"),
      })
    );
  }
  if (url.includes("audioscrobbler.com")) {
    return Promise.resolve(
      new Response(JSON.stringify({ similarartists: { artist: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
  }
  return realFetch(input, init);
}

beforeAll(async () => {
  vi.stubGlobal("fetch", mockFetch);
  // The shape that triggered it: cover present, coverUrlLarge missing, so the
  // self-heal reaches for the Cover Art Archive on every access.
  const r = await prisma.release.create({
    data: {
      title: `Anti EP ${RUN}`,
      artistName: `Autechre ${RUN}`,
      musicbrainzId: MBID,
      type: "EP",
      genres: [],
      coverUrl: "https://caa.example/thumb.jpg",
      coverUrlLarge: null,
    },
  });
  releaseId = r.id;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await deleteReleaseEverywhere(releaseId).catch(() => {});
  await redis.del(`caa:rg:urls:${MBID}`);
  await prisma.$disconnect();
  await redis.quit();
});

describe("cover art outage", () => {
  it("still serves an already-seeded release (was a 500)", async () => {
    const res = await request(app).get(`/api/releases/${releaseId}`);
    expect(res.status).toBe(200);
    expect(res.body.release.title).toBe(`Anti EP ${RUN}`);
    // The art we already had is untouched; only the missing large art is skipped.
    expect(res.body.release.coverUrl).toBe("https://caa.example/thumb.jpg");
  });

  it("is repeatable — the failure is swallowed every time, not just once", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await request(app).get(`/api/releases/${releaseId}`)).status).toBe(200);
    }
  });

  it("raises a retry-able error rather than caching a false 'no art'", async () => {
    await redis.del(`caa:rg:urls:${MBID}`);
    await expect(getCoverArtUrls(MBID)).rejects.toBeInstanceOf(UpstreamUnavailableError);
    // Nothing cached — a later request can still discover the real artwork.
    expect(await redis.get(`caa:rg:urls:${MBID}`)).toBeNull();
  });
});
