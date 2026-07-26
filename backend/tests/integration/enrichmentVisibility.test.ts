// 6.1.1 — the API must say when a release is only half-written.
//
// Seeding answers with a canonical skeleton and enriches behind the response
// (Phase 5.7). Production logs show that enrichment misses its budget on
// essentially every seed — twelve consecutive `servedAs: "skeleton"` — and the
// response carried no sign of it. The client cached an ordinary 200 and drew a
// release with no label, no genres and no cover as the finished article. Only a
// mutation's cache invalidation ever repaired the page.
//
// The fix is that the response reports its own state, so the tests here are the
// three states and the transition between them, exercised through the real seed
// path rather than by poking the registry.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { deleteReleaseEverywhere, settleEnrichments } from "../../src/services/catalogService.js";
import { __resetEnrichmentState } from "../../src/services/enrichmentState.js";

const app = createApp();
const RUN = Date.now().toString(36);
const MBID = `enrich-${RUN}`;
const ARTIST_MBID = `enrich-artist-${RUN}`;
const TITLE = `Sky Blue Sky ${RUN}`;
const ARTIST = `Wilco ${RUN}`;

const realFetch = globalThis.fetch.bind(globalThis);
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Make the slow stages genuinely slow, so the budget is missed as in production. */
let slowUpstreams = true;
/**
 * Make the cover stage break, to reach `failed` honestly.
 *
 * Deliberately NOT Last.fm: that source degrades to an empty genre list by
 * design and never throws, so it can't produce a stage failure — which is
 * correct, and is why the first version of this test asserted a state the code
 * had no way to reach. The Cover Art Archive dropping its socket is a real
 * UpstreamUnavailableError, and that is what a broken stage looks like.
 */
let breakCoverArt = false;
/** Upstream cover-art calls, so "did the retry re-execute?" is measured. */
let caaCalls = 0;

function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();

  if (url.includes("musicbrainz.org")) {
    if (url.includes("/release-group/") && url.includes("enrich-")) {
      // Echo back the mbid that was ASKED for. Answering with a fixed id made
      // every variant dedupe onto one row, so the "broken" release silently
      // became the healthy one and the test asserted against the wrong record.
      const asked = url.split("/release-group/")[1].split(/[?/]/)[0];
      return Promise.resolve(
        json({
          id: asked,
          title: asked === MBID ? TITLE : `${TITLE} (broken)`,
          "primary-type": "Album",
          "secondary-types": [],
          "first-release-date": "2007-05-11",
          "artist-credit": [{ name: ARTIST, artist: { id: ARTIST_MBID, name: ARTIST } }],
        })
      );
    }
    if (url.includes(`/artist/${ARTIST_MBID}`)) {
      return (async () => {
        if (slowUpstreams) await sleep(2_000); // outlast ENRICH_BUDGET_MS
        return json({ id: ARTIST_MBID, name: ARTIST, "sort-name": ARTIST, type: "Group" });
      })();
    }
    if (url.includes("/release?release-group=")) return Promise.resolve(json({ releases: [] }));
  }
  if (url.includes("audioscrobbler.com")) {
    return Promise.resolve(json({ toptags: { tag: [{ name: "alt-country" }] } }));
  }
  if (url.includes("coverartarchive.org")) {
    caaCalls += 1;
    if (breakCoverArt) {
      return Promise.reject(
        Object.assign(new TypeError("fetch failed"), {
          cause: new Error("Client network socket disconnected"),
        })
      );
    }
    return Promise.resolve(new Response("", { status: 404 }));
  }
  if (url.includes("api.discogs.com")) return Promise.resolve(json({ results: [] }));
  return realFetch(input, init);
}

beforeAll(async () => {
  vi.stubGlobal("fetch", mockFetch);
  __resetEnrichmentState();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await settleEnrichments();

  // Cleanup is scoped to the EXACT ids this file created, never to a `contains`
  // match on RUN. Every suite derives RUN from `Date.now().toString(36)`, so two
  // files loading in the same second share it — a `contains` teardown here
  // deleted the discography suite's artist out from under it mid-run, and that
  // suite then 404'd on an artist it had legitimately created. Cross-suite
  // demolition is worse than leftover debris: the global teardown catches
  // debris, and nothing catches this.
  for (const mbid of [MBID, `${MBID}-broken`]) {
    const row = await prisma.release.findUnique({ where: { musicbrainzId: mbid } });
    if (row) await deleteReleaseEverywhere(row.id).catch(() => {});
  }
  await prisma.artist.deleteMany({ where: { musicbrainzId: ARTIST_MBID } });
  await prisma.$disconnect();
  await redis.quit();
});

describe("a release seeded on first access", () => {
  let releaseId: string;

  it("reports `pending` rather than passing a skeleton off as complete", async () => {
    const res = await request(app).get(`/api/releases/mb:${MBID}`);

    expect(res.status).toBe(200);
    // This is the assertion the whole defect reduces to: the response that
    // carries an incomplete release must not look like a complete one.
    expect(res.body.release.enrichment).toBe("pending");
    expect(res.body.release.title).toBe(TITLE);
    releaseId = res.body.release.id;
  });

  it("serves the finished record on a later request — no mutation involved", async () => {
    await settleEnrichments();

    const res = await request(app).get(`/api/releases/${releaseId}`);
    expect(res.status).toBe(200);
    expect(res.body.release.enrichment).toBe("ready");
    // The data the first response could not include has arrived, and nothing
    // was written, rated or invalidated to get it.
    expect(res.body.release.genres).toContain("alt-country");
    expect(res.body.release.artist?.name).toBe(ARTIST);
  });

  it("stays `ready` for a warm read", async () => {
    const res = await request(app).get(`/api/releases/${releaseId}`);
    expect(res.body.release.enrichment).toBe("ready");
  });

  it("does not block the request on upstream work when re-reached by ref", async () => {
    // The `mb:` path used to await the whole heal with no ceiling, which is what
    // made a revisit slower than a first visit. It is budgeted now.
    slowUpstreams = true;
    const startedAt = Date.now();
    const res = await request(app).get(`/api/releases/mb:${MBID}`);
    const elapsed = Date.now() - startedAt;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(4_000); // the slow stage alone sleeps 2s per call
    await settleEnrichments();
  });
});

describe("a release whose enrichment breaks", () => {
  it("reports `failed` — partial data, and known to be partial", async () => {
    breakCoverArt = true;
    slowUpstreams = false;

    const res = await request(app).get(`/api/releases/mb:${MBID}-broken`);
    expect(res.status).toBe(200);
    await settleEnrichments();

    const after = await request(app).get(`/api/releases/${res.body.release.id}`);
    // The release exists and renders; the cover stage died, and the API says so
    // rather than presenting a coverless record as the finished truth.
    expect(after.body.release.enrichment).toBe("failed");
    expect(after.body.release.title).toContain("Sky Blue Sky");
    expect(after.body.release.coverUrl).toBeNull();
  });

  it("stays failed — it does NOT lapse back to ready on a timer", async () => {
    // The lapse was its own silent failure: after five minutes a release with a
    // dead stage started reporting `ready` while its data was still missing.
    const row = await prisma.release.findUnique({
      where: { musicbrainzId: `${MBID}-broken` },
    });
    const res = await request(app).get(`/api/releases/${row!.id}`);
    expect(res.body.release.enrichment).toBe("failed");
  });

  it("a GET by internal id does NOT re-run enrichment — the bug Movement proved", async () => {
    // 39 requests, one enrichment run. A GET by internal id is a database read;
    // nothing re-executes. Pinned so the retry can never quietly become a
    // refetch again.
    const row = await prisma.release.findUnique({
      where: { musicbrainzId: `${MBID}-broken` },
    });
    caaCalls = 0;
    for (let i = 0; i < 3; i++) await request(app).get(`/api/releases/${row!.id}`);
    expect(caaCalls).toBe(0);
  });

  it("recovers through POST /refresh once the upstream is healthy again", async () => {
    // The end-to-end retry path, driven by INTERNAL ID — the URL the client
    // actually holds after 6.1.1 canonicalized it. The previous version of this
    // test re-requested through the `mb:` ref instead, which re-runs enrichment
    // as a side effect of seeding. That is why it passed while the product was
    // broken: it exercised a path no user takes.
    const row = await prisma.release.findUnique({
      where: { musicbrainzId: `${MBID}-broken` },
    });
    expect((await request(app).get(`/api/releases/${row!.id}`)).body.release.enrichment).toBe(
      "failed"
    );

    breakCoverArt = false;
    caaCalls = 0;
    const refresh = await request(app).post(`/api/releases/${row!.id}/refresh`);
    expect(refresh.status).toBe(200);
    // It actually went upstream this time.
    expect(caaCalls).toBeGreaterThan(0);

    await settleEnrichments();
    const after = await request(app).get(`/api/releases/${row!.id}`);
    expect(after.body.release.enrichment).toBe("ready");
  });

  it("refuses a second refresh inside the rate-limit window", async () => {
    const row = await prisma.release.findUnique({
      where: { musicbrainzId: `${MBID}-broken` },
    });
    const res = await request(app).post(`/api/releases/${row!.id}/refresh`);
    // Visible refusal with a reason, never a silent no-op.
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/give it/i);
  });

  it("404s a refresh for a release that does not exist", async () => {
    const res = await request(app).post(`/api/releases/does-not-exist/refresh`);
    expect(res.status).toBe(404);
  });
});
