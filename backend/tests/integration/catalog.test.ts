import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { es, RELEASE_INDEX, ARTIST_INDEX } from "../../src/config/elasticsearch.js";
import { settleEnrichments } from "../../src/services/catalogService.js";
import { runTag } from "../support/runTag.js";

// External metadata APIs are mocked; Postgres, Redis, and Elasticsearch are real.
// Spotify has no credentials here, so this exercises the required no-Spotify path.
const app = createApp();
// Letters only, NOT `Date.now().toString(36)`. This file asserts on search, and
// a time-derived tag analyzes to a token every concurrently-live fixture shares
// — which silently pushes Elasticsearch past THIN_RESULTS and skips the very
// fan-out these tests exist to check. See tests/support/runTag.ts.
const RUN = runTag();
const MBID = `mbid-${RUN}`;
const ARTIST_MBID = `artist-${RUN}`;
const LABEL_MBID = `label-${RUN}`;
const TITLE = `Kid A ${RUN}`;
const ARTIST = `Radiohead ${RUN}`;
const LABEL = `Parlophone ${RUN}`;

const realFetch = globalThis.fetch.bind(globalThis);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();

  if (url.includes("musicbrainz.org")) {
    if (url.includes("/release-group/?query=")) {
      return Promise.resolve(
        json({
          "release-groups": [
            {
              id: MBID,
              title: TITLE,
              "primary-type": "Album",
              "first-release-date": "2000",
              "artist-credit": [{ name: ARTIST }],
              score: 100,
            },
          ],
        })
      );
    }
    if (url.includes(`/release-group/${MBID}`)) {
      return Promise.resolve(
        json({
          id: MBID,
          title: TITLE,
          "primary-type": "Album",
          "secondary-types": [],
          "first-release-date": "2000-10-02",
          "artist-credit": [{ name: ARTIST, artist: { id: ARTIST_MBID, name: ARTIST } }],
        })
      );
    }
    if (url.includes(`/artist/${ARTIST_MBID}`)) {
      return Promise.resolve(
        json({
          id: ARTIST_MBID,
          name: ARTIST,
          "sort-name": ARTIST,
          type: "Group",
          area: { name: "United Kingdom" },
          "life-span": { begin: "1985" },
        })
      );
    }
    // Label browse for the release-group: primary label credit lives here.
    if (url.includes(`/release?release-group=${MBID}`)) {
      return Promise.resolve(
        json({
          releases: [{ "label-info": [{ label: { id: LABEL_MBID, name: LABEL } }] }],
        })
      );
    }
    if (url.includes(`/label/${LABEL_MBID}`)) {
      return Promise.resolve(
        json({
          id: LABEL_MBID,
          name: LABEL,
          area: { name: "United Kingdom" },
          "life-span": { begin: "1896" },
        })
      );
    }
    // The ARTIST SEARCH fan-out (`searchArtists` -> searchMusicBrainzArtists).
    // Unmatched before 6.3e, so it fell through to `realFetch` and this file
    // quietly depended on live MusicBrainz. That was invisible while a degraded
    // search returned `[]`; now that an outage is honestly a 503, an unmocked
    // call turns into `expect(200)` failing against a real upstream's bad
    // minute — measured at a 54% HTTP 503 rate on 2026-08-24.
    if (url.includes("/artist/?query=") || url.includes("/artist?query=")) {
      return Promise.resolve(json({ artists: [] }));
    }
    // Anything else aimed at MusicBrainz is a MOCK GAP, not a reason to reach
    // the network. Failing loudly here is the whole point: a test that silently
    // depends on a third party passes or fails for reasons that have nothing to
    // do with the code under test.
    return Promise.reject(
      new Error(`[catalog.test] unmocked MusicBrainz call: ${url}`)
    );
  }
  if (url.includes("coverartarchive.org")) {
    return Promise.resolve(
      json({
        images: [
          { front: true, image: "https://caa.example/full.jpg", thumbnails: { "500": "https://caa.example/500.jpg" } },
        ],
      })
    );
  }
  if (url.includes("audioscrobbler.com")) {
    if (url.includes("album.gettoptags")) {
      return Promise.resolve(json({ toptags: { tag: [{ name: "Alternative" }, { name: "Electronic" }] } }));
    }
    if (url.includes("artist.getsimilar")) {
      return Promise.resolve(json({ similarartists: { artist: [{ name: "Thom Yorke" }] } }));
    }
  }
  if (url.includes("api.discogs.com") && url.includes("/database/search")) {
    return Promise.resolve(
      json({
        results: [
          {
            id: 111,
            type: "master",
            title: `${ARTIST} - ${TITLE}`,
            year: "2000",
            cover_image: "https://discogs.example/c.jpg",
            format: ["Album"],
          },
        ],
      })
    );
  }

  // Everything else (Elasticsearch, etc.) hits the network for real.
  return realFetch(input, init);
}

beforeAll(async () => {
  await prisma.release.deleteMany({ where: { musicbrainzId: MBID } });
  vi.stubGlobal("fetch", mockFetch);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  // Remove seeded rows from Postgres AND their Elasticsearch documents (the ES
  // doc id is the row id) so the indices don't accumulate orphaned hits.
  const row = await prisma.release.findUnique({ where: { musicbrainzId: MBID } });
  if (row) await es.delete({ index: RELEASE_INDEX, id: row.id }).catch(() => {});
  await prisma.release.deleteMany({ where: { musicbrainzId: MBID } });
  const artist = await prisma.artist.findUnique({ where: { musicbrainzId: ARTIST_MBID } });
  if (artist) await es.delete({ index: "artists", id: artist.id }).catch(() => {});
  await prisma.artist.deleteMany({ where: { musicbrainzId: ARTIST_MBID } });
  const label = await prisma.label.findUnique({ where: { musicbrainzId: LABEL_MBID } });
  if (label) await es.delete({ index: "labels", id: label.id }).catch(() => {});
  await prisma.label.deleteMany({ where: { musicbrainzId: LABEL_MBID } });
  await prisma.$disconnect();
  await redis.quit();
});

describe("GET /api/search — unified, ES-first with source fan-out", () => {
  it("fans out to MusicBrainz + Discogs, merges, and returns a canonical MB ref", async () => {
    const res = await request(app).get(`/api/search?q=${encodeURIComponent(TITLE)}`);
    expect(res.status).toBe(200);
    const hit = (res.body.results as Array<Record<string, unknown>>).find((r) => r.title === TITLE);
    expect(hit).toBeDefined();
    // MB + Discogs candidates for the same title+artist merged into one, MB-anchored.
    expect(hit!.ref).toBe(`mb:${MBID}`);
    expect(hit!.artistName).toBe(ARTIST);
    expect(hit!.type).toBe("ALBUM");
  });
});

describe("GET /api/releases/:id — seed-on-first-access", () => {
  // Phase 5.7 changed this contract deliberately: the canonical MusicBrainz data
  // is served as soon as it lands, and the slower stages (Cover Art Archive,
  // Last.fm genres) complete behind the response so first access is never held
  // hostage to a saturated throttle. Enrichment still happens — just not inline.
  it("serves canonical data immediately and persists the release", async () => {
    const res = await request(app).get(`/api/releases/mb:${MBID}`);
    expect(res.status).toBe(200);
    const rel = res.body.release;
    expect(rel.title).toBe(TITLE);
    expect(rel.type).toBe("ALBUM");
    expect(rel.musicbrainzId).toBe(MBID);
    expect(rel.similarArtists).toEqual(expect.arrayContaining(["Thom Yorke"]));

    const row = await prisma.release.findUnique({ where: { musicbrainzId: MBID } });
    expect(row).not.toBeNull();
  });

  it("completes CAA cover art + Last.fm genres asynchronously after the response", async () => {
    await settleEnrichments();
    const res = await request(app).get(`/api/releases/mb:${MBID}`);
    expect(res.body.release.coverUrl).toContain("caa.example"); // Cover Art Archive
    expect(res.body.release.genres).toEqual(
      expect.arrayContaining(["alternative", "electronic"]) // Last.fm
    );
  });

  it("is idempotent — a second access returns the same row, no duplicate", async () => {
    const first = await request(app).get(`/api/releases/mb:${MBID}`);
    const second = await request(app).get(`/api/releases/mb:${MBID}`);
    expect(first.body.release.id).toBe(second.body.release.id);
    expect(await prisma.release.count({ where: { musicbrainzId: MBID } })).toBe(1);
  });
});

describe("Artist seeding + GET /api/artists/:id", () => {
  it("seeds the Artist (MB MBID canonical) during release import and serves the artist page", async () => {
    // The release was seeded above; its DTO should link to a real Artist row.
    const rel = await request(app).get(`/api/releases/mb:${MBID}`);
    expect(rel.body.release.artist).toMatchObject({ name: ARTIST });
    const artistId = rel.body.release.artist.id as string;

    const res = await request(app).get(`/api/artists/${artistId}`);
    expect(res.status).toBe(200);
    expect(res.body.artist).toMatchObject({
      name: ARTIST,
      type: "Group",
      area: "United Kingdom",
      beginDate: "1985",
      musicbrainzId: ARTIST_MBID,
    });
    // Their releases in the catalog include the seeded one.
    const titles = (res.body.releases as Array<{ title: string }>).map((r) => r.title);
    expect(titles).toContain(TITLE);
  });

  it("404s for an unknown artist", async () => {
    const res = await request(app).get("/api/artists/nonexistent-artist-id");
    expect(res.status).toBe(404);
  });
});

describe("Label seeding + GET /api/labels/:id", () => {
  it("seeds the primary Label from MB label credits during import and serves the label page", async () => {
    const rel = await request(app).get(`/api/releases/mb:${MBID}`);
    expect(rel.body.release.label).toMatchObject({ name: LABEL });
    const labelId = rel.body.release.label.id as string;

    const res = await request(app).get(`/api/labels/${labelId}`);
    expect(res.status).toBe(200);
    expect(res.body.label).toMatchObject({
      name: LABEL,
      area: "United Kingdom",
      founded: "1896",
      musicbrainzId: LABEL_MBID,
    });
    // Their releases in the catalog include the seeded one.
    const titles = (res.body.releases as Array<{ title: string }>).map((r) => r.title);
    expect(titles).toContain(TITLE);
  });

  it("404s for an unknown label", async () => {
    const res = await request(app).get("/api/labels/nonexistent-label-id");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/search — Artists section", () => {
  it("surfaces the seeded artist with a release count", async () => {
    // ES is near-real-time; force a refresh so the just-indexed artist is found.
    await es.indices.refresh({ index: ARTIST_INDEX }).catch(() => {});
    const res = await request(app).get(`/api/search?q=${encodeURIComponent(ARTIST)}`);
    expect(res.status).toBe(200);
    const hit = (res.body.artists as Array<{ name: string; releaseCount: number; area: string }>).find(
      (a) => a.name === ARTIST
    );
    expect(hit, "seeded artist should appear in the Artists section").toBeDefined();
    expect(hit!.releaseCount).toBeGreaterThanOrEqual(1);
    expect(hit!.area).toBe("United Kingdom");
  });
});

describe("POST /api/releases/import", () => {
  it("imports by ref and returns the seeded release", async () => {
    const res = await request(app).post("/api/releases/import").send({ ref: `mb:${MBID}` });
    expect(res.status).toBe(201);
    expect(res.body.release.musicbrainzId).toBe(MBID);
  });

  it("rejects a missing ref with 422", async () => {
    const res = await request(app).post("/api/releases/import").send({});
    expect(res.status).toBe(422);
  });
});
