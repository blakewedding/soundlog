// Phase 5.6 — full artist discographies.
//
// The contract under test:
//   - browse pagination assembles EVERY page (a multi-page artist is complete)
//   - a partial assembly is NEVER cached as complete (5.7 error semantics)
//   - MB entries merge with local rows by MBID ONLY (5.8: no name matching)
//   - entries bucket into the display groups, chronological within a group
//   - clicking an un-seeded entry materializes it via the resilient seed path
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import {
  getArtistDiscography,
  discographyCacheKey,
  UpstreamUnavailableError,
} from "../../src/services/musicbrainzService.js";
import { mergeDiscography, settleDiscographies } from "../../src/services/discographyService.js";
import { deleteReleaseEverywhere, settleEnrichments } from "../../src/services/catalogService.js";
import { runTag } from "../support/runTag.js";

const app = createApp();
const RUN = runTag();
const ARTIST_MBID = `disco-artist-${RUN}`;
const ARTIST_NAME = `Prolific ${RUN}`;

// A 250-release-group artist → 3 browse pages at MB's 100/page cap.
const TOTAL_GROUPS = 250;
const SEEDED_MBID = `disco-rg-${RUN}-7`; // this one also exists locally
const UNSEEDED_EP_MBID = `disco-rg-${RUN}-3`;

let artistId: string;
let seededReleaseId: string;
let userId: string;

const realFetch = globalThis.fetch.bind(globalThis);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const rateLimited = () => new Response(JSON.stringify({ error: "rate limit" }), { status: 503 });

// Every 4th group is an EP, every 7th a single, one live album — enough spread
// to exercise the grouping.
function groupAt(i: number) {
  const secondary: string[] = [];
  let primary = "Album";
  if (i % 4 === 0) primary = "EP";
  else if (i % 7 === 0) primary = "Single";
  if (i === 11) secondary.push("Live");
  if (i === 13) secondary.push("Compilation");
  return {
    id: `disco-rg-${RUN}-${i}`,
    title: `Record ${i}`,
    "first-release-date": `${1990 + (i % 25)}-05-01`,
    "primary-type": primary,
    "secondary-types": secondary,
  };
}

/** How many browse pages fail before succeeding; 0 = healthy. */
let failPagesAtOffset: number | null = null;
let browseCalls = 0;

function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();

  if (url.includes("musicbrainz.org") && url.includes("/release-group?artist=")) {
    browseCalls += 1;
    const offset = Number(new URL(url).searchParams.get("offset") ?? 0);
    const limit = Number(new URL(url).searchParams.get("limit") ?? 100);
    if (failPagesAtOffset !== null && offset === failPagesAtOffset) return Promise.resolve(rateLimited());
    const slice = [];
    for (let i = offset; i < Math.min(offset + limit, TOTAL_GROUPS); i++) slice.push(groupAt(i));
    return Promise.resolve(
      json({ "release-group-count": TOTAL_GROUPS, "release-group-offset": offset, "release-groups": slice })
    );
  }
  // Seeding a clicked entry: release-group lookup + artist lookup.
  if (url.includes("musicbrainz.org") && url.includes(`/release-group/${UNSEEDED_EP_MBID}`)) {
    return Promise.resolve(
      json({
        id: UNSEEDED_EP_MBID,
        title: "Record 3",
        "primary-type": "EP",
        "secondary-types": [],
        "first-release-date": "1993-05-01",
        "artist-credit": [{ name: ARTIST_NAME, artist: { id: ARTIST_MBID, name: ARTIST_NAME } }],
      })
    );
  }
  if (url.includes("musicbrainz.org") && url.includes(`/artist/${ARTIST_MBID}`)) {
    return Promise.resolve(json({ id: ARTIST_MBID, name: ARTIST_NAME, "sort-name": ARTIST_NAME }));
  }
  if (url.includes("musicbrainz.org") && url.includes("/release?release-group=")) {
    return Promise.resolve(json({ releases: [] }));
  }
  if (url.includes("coverartarchive.org")) return Promise.resolve(new Response("", { status: 404 }));
  if (url.includes("audioscrobbler.com")) return Promise.resolve(json({ toptags: { tag: [] } }));
  if (url.includes("api.discogs.com")) return Promise.resolve(json({ results: [] }));
  return realFetch(input, init);
}

beforeAll(async () => {
  vi.stubGlobal("fetch", mockFetch);
  const artist = await prisma.artist.create({
    data: { musicbrainzId: ARTIST_MBID, name: ARTIST_NAME },
  });
  artistId = artist.id;
  const seeded = await prisma.release.create({
    data: {
      title: "Record 7",
      artistName: ARTIST_NAME,
      artistId,
      musicbrainzId: SEEDED_MBID,
      type: "SINGLE",
      genres: [],
      coverUrl: "https://caa.example/7.jpg",
    },
  });
  seededReleaseId = seeded.id;
  const user = await prisma.user.create({
    data: { username: `disco_${RUN}`, email: `disco_${RUN}@disco.local`, password: "x" },
  });
  userId = user.id;
  await prisma.rating.create({ data: { userId, releaseId: seededReleaseId, value: 4.5 } });
});

beforeEach(async () => {
  failPagesAtOffset = null;
  browseCalls = 0;
  await redis.del(discographyCacheKey(ARTIST_MBID));
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await settleDiscographies().catch(() => {});
  await settleEnrichments().catch(() => {});
  // By PREFIX, not by a list of two known ids. This suite exercises
  // click-to-materialize against a 250-group discography, so any of
  // `disco-rg-<run>-N` can end up seeded — the previous explicit list missed
  // whichever ones a test happened to materialize, and "Record 7 — Prolific
  // <run>" ended up live in the dev catalogue and visible in Explore.
  const seededNow = await prisma.release.findMany({
    where: { musicbrainzId: { startsWith: `disco-rg-${RUN}-` } },
    select: { id: true },
  });
  for (const r of seededNow) await deleteReleaseEverywhere(r.id).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { endsWith: "@disco.local" } } });
  await prisma.artist.deleteMany({ where: { musicbrainzId: ARTIST_MBID } });
  await redis.del(discographyCacheKey(ARTIST_MBID));
  await prisma.$disconnect();
  await redis.quit();
});

describe("browse pagination", () => {
  it("assembles every page of a multi-page artist", async () => {
    const entries = await getArtistDiscography(ARTIST_MBID);
    expect(entries).toHaveLength(TOTAL_GROUPS);
    expect(browseCalls).toBe(Math.ceil(TOTAL_GROUPS / 100)); // 3 pages
    // Deterministic contents, not just a count.
    expect(entries[0].mbid).toBe(`disco-rg-${RUN}-0`);
    expect(entries.at(-1)!.mbid).toBe(`disco-rg-${RUN}-${TOTAL_GROUPS - 1}`);
    // And it landed in the cache as complete.
    const cached = await redis.get(discographyCacheKey(ARTIST_MBID));
    expect(JSON.parse(cached!)).toHaveLength(TOTAL_GROUPS);
  }, 30_000);
});

describe("partial assembly is never cached", () => {
  it("throws and caches NOTHING when a later page fails", async () => {
    failPagesAtOffset = 100; // page 1 succeeds, page 2 is rate-limited

    await expect(getArtistDiscography(ARTIST_MBID)).rejects.toBeInstanceOf(UpstreamUnavailableError);

    // The critical assertion: no half-discography left behind for 7 days.
    expect(await redis.get(discographyCacheKey(ARTIST_MBID))).toBeNull();
  }, 30_000);

  it("recovers completely on a retry once upstream is healthy", async () => {
    failPagesAtOffset = 100;
    await expect(getArtistDiscography(ARTIST_MBID)).rejects.toThrow();

    failPagesAtOffset = null;
    const entries = await getArtistDiscography(ARTIST_MBID);
    expect(entries).toHaveLength(TOTAL_GROUPS);
  }, 30_000);
});

describe("local merge (by MBID only) + grouping", () => {
  it("marks the seeded release with its cover, community rating and my rating", async () => {
    const entries = await getArtistDiscography(ARTIST_MBID);
    const groups = await mergeDiscography(entries, userId);
    const all = groups.flatMap((g) => g.entries);

    const seeded = all.find((e) => e.mbid === SEEDED_MBID)!;
    expect(seeded.seeded).toBe(true);
    expect(seeded.releaseId).toBe(seededReleaseId);
    expect(seeded.coverUrl).toBe("https://caa.example/7.jpg");
    expect(seeded.avgRating).toBe(4.5);
    expect(seeded.ratingCount).toBe(1);
    expect(seeded.myRating).toBe(4.5);

    // Everything else is un-seeded and carries MB data only — no rows created.
    const unseeded = all.find((e) => e.mbid === UNSEEDED_EP_MBID)!;
    expect(unseeded.seeded).toBe(false);
    expect(unseeded.releaseId).toBeNull();
    expect(unseeded.title).toBe("Record 3");
    expect(unseeded.year).toBe("1993");
  }, 30_000);

  it("does not match a same-titled local release that lacks the MBID", async () => {
    // A row with the same title but NO musicbrainzId must stay unmatched:
    // name-based guessing is exactly what 5.8 outlawed.
    const impostor = await prisma.release.create({
      data: { title: "Record 3", artistName: ARTIST_NAME, type: "EP", genres: [] },
    });
    try {
      const entries = await getArtistDiscography(ARTIST_MBID);
      const groups = await mergeDiscography(entries, userId);
      const entry = groups.flatMap((g) => g.entries).find((e) => e.mbid === UNSEEDED_EP_MBID)!;
      expect(entry.seeded).toBe(false);
      expect(entry.releaseId).toBeNull();
    } finally {
      await deleteReleaseEverywhere(impostor.id);
    }
  }, 30_000);

  it("buckets into display groups, chronological within each", async () => {
    const entries = await getArtistDiscography(ARTIST_MBID);
    const groups = await mergeDiscography(entries);
    const keys = groups.map((g) => g.key);

    expect(keys).toContain("albums");
    expect(keys).toContain("eps");
    expect(keys).toContain("singles");
    expect(keys).toContain("live");
    // Groups render in the declared order.
    expect(keys).toEqual([...keys].sort((a, b) =>
      ["albums", "eps", "singles", "mixes", "compilations", "live", "other"].indexOf(a) -
      ["albums", "eps", "singles", "mixes", "compilations", "live", "other"].indexOf(b)
    ));
    // A "Live" secondary type wins its own shelf even though it's an Album.
    expect(groups.find((g) => g.key === "live")!.entries.map((e) => e.mbid)).toContain(
      `disco-rg-${RUN}-11`
    );
    // Chronological within a group.
    const albumYears = groups.find((g) => g.key === "albums")!.entries.map((e) => e.year);
    expect(albumYears).toEqual([...albumYears].sort());
  }, 30_000);
});

describe("GET /api/artists/:id/discography", () => {
  it("reports progress while assembling, then serves the complete discography", async () => {
    const first = await request(app).get(`/api/artists/${artistId}/discography`);
    expect(first.status).toBe(202);
    expect(first.body.status).toBe("assembling");
    expect(first.body.progress).toHaveProperty("fetched");

    await settleDiscographies();

    const done = await request(app).get(`/api/artists/${artistId}/discography`);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("complete");
    expect(done.body.counts.total).toBe(TOTAL_GROUPS);
    expect(done.body.counts.seeded).toBe(1);
  }, 40_000);
});

describe("refresh rate limiting", () => {
  // A refresh that can't accomplish anything must NOT burn the caller's hourly
  // slot — otherwise clicking refresh during the initial assembly (very likely
  // on a cold artist) locks you out of a real refresh for an hour.
  const limiterKeys = async () =>
    (await redis.keys(`discog:refresh:*:${ARTIST_MBID}`)).length;

  it("does not consume a slot when nothing is cached yet", async () => {
    await redis.del(discographyCacheKey(ARTIST_MBID));
    const res = await request(app).post(`/api/artists/${artistId}/discography/refresh`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("assembling");
    expect(await limiterKeys()).toBe(0);
  }, 30_000);

  it("does not consume a slot while an assembly is already in flight", async () => {
    await redis.del(discographyCacheKey(ARTIST_MBID));
    await request(app).get(`/api/artists/${artistId}/discography`); // starts assembly
    const res = await request(app).post(`/api/artists/${artistId}/discography/refresh`);
    expect(res.body.status).toBe("assembling");
    expect(await limiterKeys()).toBe(0);
    await settleDiscographies();
  }, 40_000);

  it("consumes the slot for a real refresh, and refuses a second within the window", async () => {
    await getArtistDiscography(ARTIST_MBID); // ensure something IS cached
    const first = await request(app).post(`/api/artists/${artistId}/discography/refresh`);
    expect(first.body.status).toBe("refreshing");
    expect(await limiterKeys()).toBe(1);

    // Re-cache so the second attempt reaches the limiter rather than the
    // "nothing cached" short-circuit.
    await getArtistDiscography(ARTIST_MBID);
    const second = await request(app).post(`/api/artists/${artistId}/discography/refresh`);
    expect(second.status).toBe(429);
    expect(second.body.error).toMatch(/refreshed recently/i);
  }, 60_000);
});

describe("click-to-materialize", () => {
  it("seeds an un-seeded discography entry through the resilient seed path", async () => {
    expect(
      await prisma.release.findUnique({ where: { musicbrainzId: UNSEEDED_EP_MBID } })
    ).toBeNull();

    // Exactly what the UI does: navigate to the release page by MB ref.
    const res = await request(app).get(`/api/releases/mb:${UNSEEDED_EP_MBID}`);
    expect(res.status).toBe(200);
    expect(res.body.release.title).toBe("Record 3");
    expect(res.body.release.musicbrainzId).toBe(UNSEEDED_EP_MBID);

    const row = await prisma.release.findUnique({ where: { musicbrainzId: UNSEEDED_EP_MBID } });
    expect(row).not.toBeNull();

    // And it now shows as seeded in the discography.
    await settleEnrichments();
    const entries = await getArtistDiscography(ARTIST_MBID);
    const groups = await mergeDiscography(entries);
    const entry = groups.flatMap((g) => g.entries).find((e) => e.mbid === UNSEEDED_EP_MBID)!;
    expect(entry.seeded).toBe(true);
    expect(entry.releaseId).toBe(row!.id);
  }, 40_000);
});
