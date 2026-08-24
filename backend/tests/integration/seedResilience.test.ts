// Phase 5.7 — seed-on-first-access must survive a saturated MusicBrainz throttle.
//
// Reported symptom: opening an unseeded release intermittently errors on the
// first attempt and succeeds on the second. Root cause: MusicBrainz answers 503
// ("exceeding the allowable rate limit") when a search fan-out has just consumed
// the throttle slots. `mbFetch` collapses ANY non-OK response to null, which
// walks up as lookupRelease -> null -> resolveRelease -> null -> HTTP 404
// "Release not found" — a retry-able upstream blip presented to the user as a
// permanently missing release. `cached()` then stores that null for a week,
// poisoning subsequent attempts too.
//
// These tests assert the DESIRED behaviour, so they fail against the pre-fix
// code (404) and pass once transient upstream failures are retried rather than
// surfaced, and once the release is persisted from canonical data before the
// slower enrichment stages run.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { deleteReleaseEverywhere } from "../../src/services/catalogService.js";
import { runTag } from "../support/runTag.js";

const app = createApp();
const RUN = runTag();
const MBID = `seedres-${RUN}`;
const ARTIST_MBID = `seedres-artist-${RUN}`;
const TITLE = `Contention LP ${RUN}`;
const ARTIST = `Throttled ${RUN}`;

const realFetch = globalThis.fetch.bind(globalThis);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// MusicBrainz's rate-limit reply. This is what a real saturated throttle returns.
function rateLimited(): Response {
  return new Response(
    JSON.stringify({ error: "Your requests are exceeding the allowable rate limit." }),
    { status: 503, headers: { "content-type": "application/json" } }
  );
}

// The release-group lookup is rate-limited the first N times, then recovers —
// modelling contention that clears once the queued search calls drain.
let rgLookupCalls = 0;
let transientFailures = 2;

function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();

  if (url.includes("musicbrainz.org")) {
    if (url.includes(`/release-group/${MBID}`)) {
      rgLookupCalls += 1;
      if (rgLookupCalls <= transientFailures) return Promise.resolve(rateLimited());
      return Promise.resolve(
        json({
          id: MBID,
          title: TITLE,
          "primary-type": "Album",
          "secondary-types": [],
          "first-release-date": "1994-03-01",
          "artist-credit": [{ name: ARTIST, artist: { id: ARTIST_MBID, name: ARTIST } }],
        })
      );
    }
    if (url.includes(`/artist/${ARTIST_MBID}`)) {
      return Promise.resolve(
        json({ id: ARTIST_MBID, name: ARTIST, "sort-name": ARTIST, type: "Group" })
      );
    }
    // Label browse/lookup: keep the enrichment stage slow-but-successful.
    if (url.includes("/release?release-group=")) {
      return Promise.resolve(json({ releases: [] }));
    }
    // Any other MusicBrainz URL is a MOCK GAP, not a reason to reach the
    // network. Before 6.3e an unmocked call fell through to live MusicBrainz and
    // a degraded search quietly returned `[]`, so the dependency was invisible;
    // now that an outage is honestly a 503, it would surface as an unrelated
    // assertion failing against a third party's bad minute.
    return Promise.reject(new Error(`[test] unmocked MusicBrainz call: ${url}`));
  }
  if (url.includes("coverartarchive.org")) {
    return Promise.resolve(new Response("", { status: 404 })); // no art on file
  }
  if (url.includes("audioscrobbler.com")) {
    return Promise.resolve(json({ toptags: { tag: [{ name: "Shoegaze" }] } }));
  }
  if (url.includes("api.discogs.com")) {
    return Promise.resolve(json({ results: [] }));
  }
  return realFetch(input, init);
}

beforeAll(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  const row = await prisma.release.findUnique({ where: { musicbrainzId: MBID } });
  if (row) await deleteReleaseEverywhere(row.id);
  await prisma.artist.deleteMany({ where: { musicbrainzId: ARTIST_MBID } });
  // Clear any cached MB payloads so reruns start cold.
  for (const k of [`mb:rg:${MBID}`, `mb:artist:${ARTIST_MBID}`, `mb:rg:label:${MBID}`]) {
    await redis.del(k);
  }
  await prisma.$disconnect();
  await redis.quit();
});

describe("seed-on-first-access under a saturated MusicBrainz throttle", () => {
  it("serves the release on the FIRST attempt despite transient 503s", async () => {
    rgLookupCalls = 0;
    transientFailures = 2; // the first two lookups are rate-limited

    const res = await request(app).get(`/api/releases/mb:${MBID}`);

    // Pre-fix this is 404 "Release not found": the 503 became null became 404.
    expect(res.status).toBe(200);
    expect(res.body.release.title).toBe(TITLE);
    expect(res.body.release.artistName).toBe(ARTIST);
    expect(res.body.release.musicbrainzId).toBe(MBID);
    // It only succeeded by retrying through the rate-limited responses.
    expect(rgLookupCalls).toBeGreaterThan(transientFailures);
  }, 30_000);

  it("does not negatively cache a transient failure (retry is not poisoned)", async () => {
    // A second access must still resolve — a cached `null` from the earlier 503s
    // would surface as a permanent 404 for a week.
    const res = await request(app).get(`/api/releases/mb:${MBID}`);
    expect(res.status).toBe(200);
    expect(res.body.release.musicbrainzId).toBe(MBID);
  }, 30_000);

  it("persists the release so a repeat access is served from the database", async () => {
    const row = await prisma.release.findUnique({ where: { musicbrainzId: MBID } });
    expect(row).not.toBeNull();
    expect(row!.title).toBe(TITLE);
  });
});
