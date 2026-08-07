// 6.3a — a release that holds NO genres acquires them on the next access.
//
// The gap this closes was found by shipping 6.3 and then looking. The genre
// filter correctly emptied *Transaction de Novo* of five junk chips, and the
// release then stayed chip-less through every subsequent visit: `healExisting`
// had stages for date, artist, label, covers and tint, and none for genres. The
// album-then-artist fallback that supplies `slowcore, indie rock, post-rock`
// lived only in `enrichNewRelease`, where a release we already hold can never
// reach it.
//
// The two properties are a pair, and the second is the one that keeps this
// cheap: it must fill an EMPTY row, and it must not re-ask upstream for a row
// that already has genres. Without the guard this stage would cost a Last.fm
// round-trip on every page view forever.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { deleteReleaseEverywhere, settleEnrichments } from "../../src/services/catalogService.js";
import { runTag } from "../support/runTag.js";

const app = createApp();
const RUN = runTag("genreheal");
const MBID = `gheal-${RUN}`;
const ARTIST_MBID = `gheal-artist-${RUN}`;
const TITLE = `Transaction ${RUN}`;
const ARTIST = `Bedhead ${RUN}`;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Last.fm calls, so "did the guard actually prevent the fetch?" is measured. */
let lastfmCalls = 0;
let releaseId = "";

function mockFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();

  if (url.includes("musicbrainz.org")) {
    if (url.includes("/release-group/") && url.includes("gheal-")) {
      return Promise.resolve(
        json({
          id: MBID,
          title: TITLE,
          "primary-type": "Album",
          "secondary-types": [],
          "first-release-date": "1998-03-24",
          "artist-credit": [{ name: ARTIST, artist: { id: ARTIST_MBID, name: ARTIST } }],
        })
      );
    }
    if (url.includes(`/artist/${ARTIST_MBID}`)) {
      return Promise.resolve(json({ id: ARTIST_MBID, name: ARTIST, type: "Group" }));
    }
    if (url.includes("/release?release-group=")) return Promise.resolve(json({ releases: [] }));
    if (url.includes("/genre/all")) {
      // Keep the vocabulary prime out of this suite's way — the bundled
      // snapshot is what the filter uses either way.
      return Promise.resolve(json({ genres: [], "genre-count": 0 }));
    }
  }

  if (url.includes("audioscrobbler.com")) {
    lastfmCalls += 1;
    // Album tags: pure folksonomy junk, exactly the Transaction de Novo shape.
    // Every one of these is filtered out, which is what forces the fallback.
    if (url.includes("album.gettoptags")) {
      return Promise.resolve(
        json({
          toptags: {
            tag: [
              { name: "favorito", count: 100 },
              { name: "totec radio", count: 100 },
              { name: "these tags suck", count: 66 },
            ],
          },
        })
      );
    }
    // Artist tags: the real genres, which is what should end up on the row.
    if (url.includes("artist.gettoptags")) {
      return Promise.resolve(
        json({
          toptags: {
            tag: [
              { name: "slowcore", count: 100 },
              { name: "indie rock", count: 49 },
              { name: "shoegaze", count: 11 },
            ],
          },
        })
      );
    }
    return Promise.resolve(json({}));
  }

  if (url.includes("coverartarchive.org")) return Promise.resolve(json({}, 404));
  return Promise.resolve(json({}, 404));
}

beforeAll(async () => {
  await redis.connect().catch(() => {});
  vi.stubGlobal("fetch", vi.fn(mockFetch));

  // Seed, then empty the row — the exact state 6.3's heal leaves behind.
  const res = await request(app).get(`/api/releases/mb:${MBID}`);
  releaseId = res.body.release.id;
  await settleEnrichments();
  await prisma.release.update({ where: { id: releaseId }, data: { genres: [] } });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (releaseId) await deleteReleaseEverywhere(releaseId).catch(() => {});
  await prisma.artist
    .deleteMany({ where: { musicbrainzId: ARTIST_MBID } })
    .catch(() => {});
  await prisma.$disconnect();
  await redis.quit().catch(() => {});
});

describe("a release holding no genres", () => {
  it("acquires them on the next access, via the artist fallback", async () => {
    const before = await prisma.release.findUnique({ where: { id: releaseId } });
    expect(before?.genres, "fixture should start empty").toEqual([]);

    await request(app).get(`/api/releases/mb:${MBID}`);
    await settleEnrichments();

    const after = await prisma.release.findUnique({ where: { id: releaseId } });
    // The album tags were all junk and filtered to nothing, so these can only
    // have come from the artist-level fallback — which is the whole point.
    expect(after?.genres).toContain("slowcore");
    expect(after?.genres).toContain("indie rock");
    // And the junk did not survive the round trip.
    expect(after?.genres).not.toContain("favorito");
    expect(after?.genres).not.toContain("these tags suck");
  }, 30_000);

  it("does not re-ask upstream once it has genres", async () => {
    // The guard. A release with genres must cost zero Last.fm calls on access,
    // or this stage becomes a per-page-view round trip that never ends.
    const seeded = await prisma.release.findUnique({ where: { id: releaseId } });
    expect(seeded?.genres.length, "previous test should have filled it").toBeGreaterThan(0);

    lastfmCalls = 0;
    await request(app).get(`/api/releases/mb:${MBID}`);
    await settleEnrichments();

    expect(lastfmCalls, "genres were re-fetched for a row that already had them").toBe(0);
    const still = await prisma.release.findUnique({ where: { id: releaseId } });
    expect(still?.genres).toEqual(seeded?.genres);
  }, 30_000);
});
