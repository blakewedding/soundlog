// Cover art must be PERSISTED over https, not merely rewritten on the way out.
//
// The Cover Art Archive hands back `http://` image URLs in its JSON, and 77% of
// the catalog had them stored verbatim. That breaks two things later:
//   - the web app once Phase 6 puts it behind TLS — browsers block mixed content
//   - the native app in a release build — iOS ATS blocks cleartext, while Expo
//     Go permits it, so it would pass every dev test and fail only once shipped
//
// This drives the real seed path (`/api/releases/mb:<id>` → persistRelease) and
// pins the row that comes out of it.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { deleteReleaseEverywhere } from "../../src/services/catalogService.js";

const app = createApp();
const RUN = Date.now().toString(36);
const MBID = `caahttp-${RUN}`;
const ARTIST_MBID = `caahttp-artist-${RUN}`;
const TITLE = `Confield ${RUN}`;
const ARTIST = `Cleartext ${RUN}`;

const realFetch = globalThis.fetch.bind(globalThis);

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// The Cover Art Archive really does serve cleartext URLs in its payload.
const CAA_JSON = {
  images: [
    {
      front: true,
      image: `http://coverartarchive.org/release/${MBID}/1200.jpg`,
      thumbnails: {
        "500": `http://coverartarchive.org/release/${MBID}/500.jpg`,
        "1200": `http://coverartarchive.org/release/${MBID}/1200.jpg`,
      },
    },
  ],
};

function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();

  if (url.includes("musicbrainz.org")) {
    if (url.includes(`/release-group/${MBID}`)) {
      return Promise.resolve(
        json({
          id: MBID,
          title: TITLE,
          "primary-type": "Album",
          "secondary-types": [],
          "first-release-date": "2001-04-01",
          "artist-credit": [{ name: ARTIST, artist: { id: ARTIST_MBID, name: ARTIST } }],
        })
      );
    }
    if (url.includes(`/artist/${ARTIST_MBID}`)) {
      return Promise.resolve(
        json({ id: ARTIST_MBID, name: ARTIST, "sort-name": ARTIST, type: "Group" })
      );
    }
    if (url.includes("/release?release-group=")) return Promise.resolve(json({ releases: [] }));
  }
  if (url.includes("coverartarchive.org")) return Promise.resolve(json(CAA_JSON));
  if (url.includes("audioscrobbler.com")) return Promise.resolve(json({ toptags: { tag: [] } }));
  if (url.includes("api.discogs.com")) return Promise.resolve(json({ results: [] }));
  return realFetch(input, init);
}

beforeAll(async () => {
  vi.stubGlobal("fetch", mockFetch);
  for (const k of [`caa:rg:urls:${MBID}`, `mb:rg:${MBID}`, `mb:artist:${ARTIST_MBID}`]) {
    await redis.del(k);
  }
});

afterAll(async () => {
  vi.unstubAllGlobals();
  const row = await prisma.release.findUnique({ where: { musicbrainzId: MBID } });
  if (row) await deleteReleaseEverywhere(row.id).catch(() => {});
  await prisma.artist.deleteMany({ where: { musicbrainzId: ARTIST_MBID } });
  for (const k of [`caa:rg:urls:${MBID}`, `mb:rg:${MBID}`, `mb:artist:${ARTIST_MBID}`]) {
    await redis.del(k);
  }
  await prisma.$disconnect();
  await redis.quit();
});

/**
 * Seeding persists a skeleton immediately and enriches in the background under
 * a time budget (Phase 5.7), so cover art can land after the response. Poll for
 * the row rather than assuming the first GET carries it.
 */
async function waitForCover(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await prisma.release.findUnique({ where: { musicbrainzId: MBID } });
    if (row?.coverUrl) return row;
    if (Date.now() > deadline) {
      throw new Error(`cover art never persisted for ${MBID} (row exists: ${Boolean(row)})`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe("cover URLs are persisted https-only", () => {
  it("stores https even though the Cover Art Archive returned http", async () => {
    const res = await request(app).get(`/api/releases/mb:${MBID}`);
    expect(res.status).toBe(200);

    const row = await waitForCover();
    expect(row.coverUrl).toBe(`https://coverartarchive.org/release/${MBID}/500.jpg`);
    expect(row.coverUrlLarge).toBe(`https://coverartarchive.org/release/${MBID}/1200.jpg`);
  });

  it("keeps the same artwork — a scheme rewrite, not a different image", async () => {
    const row = await waitForCover();
    // Host, path and filename are untouched; only the scheme moved.
    expect(row.coverUrl).toContain(`coverartarchive.org/release/${MBID}/500.jpg`);
    expect(row.coverUrlLarge).toContain(`coverartarchive.org/release/${MBID}/1200.jpg`);
  });

  it("serves no cleartext image URL in the API payload", async () => {
    // What a phone, or a TLS-served page, would actually receive.
    const res = await request(app).get(`/api/releases/mb:${MBID}`);
    expect(JSON.stringify(res.body)).not.toMatch(/"http:\/\/[^"]*\.(jpg|jpeg|png|webp)/i);
  });
});
