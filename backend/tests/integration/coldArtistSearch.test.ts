// 6.2d — searching an artist we do not hold.
//
// Until this landed, `searchArtists` queried Elasticsearch and stopped. The
// artist index only contains artists we have already seeded, so at launch —
// when essentially every artist is cold — searching an artist by NAME returned
// nothing, and the only route to an artist page was to search one of their
// ALBUMS (which does fan out), open it, and click the credit through. That is
// the first thing a new user tries.
//
// What these pin, beyond "it returns something":
//
//  - the cold result is CLICKABLE: it carries a namespaced `mb:` ref, and that
//    ref materializes to a real, browsable artist.
//  - `releaseCount` is NULL, not 0. "0 releases" reads as an artist we know and
//    hold nothing by; null means "not fetched yet". The client renders
//    different copy and collapsing them would make every cold artist look
//    broken.
//  - suppression is by MBID, never by name (§3, and 6.2c specifically). Two
//    acts sharing a name must BOTH be reachable — the American Football bug was
//    exactly this, where seeding one made the others unfindable.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { runTag } from "../support/runTag.js";

const app = createApp();
const RUN = runTag("cold");
const realFetch = globalThis.fetch.bind(globalThis);

// Two distinct artists that share a name, plus one unrelated. The shared name
// is the point: it is the shape that broke before.
const TWIN_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const TWIN_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const SHARED_NAME = `Coldtwin ${RUN}`;

function mbArtist(id: string, name: string, disambiguation: string) {
  return { id, name, "sort-name": name, type: "Group", disambiguation, area: { name: "United Kingdom" } };
}

function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const json = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

  if (url.includes("/artist/?query=")) {
    return json({ artists: [mbArtist(TWIN_A, SHARED_NAME, "the first one"), mbArtist(TWIN_B, SHARED_NAME, "the second one")] });
  }
  if (url.includes(`/artist/${TWIN_A}`)) return json(mbArtist(TWIN_A, SHARED_NAME, "the first one"));
  if (url.includes(`/artist/${TWIN_B}`)) return json(mbArtist(TWIN_B, SHARED_NAME, "the second one"));
  // Anything else this test does not model — including the discography browse —
  // is not its business.
  if (url.includes("musicbrainz.org") || url.includes("coverartarchive.org")) {
    return Promise.resolve(new Response("{}", { status: 404 }));
  }
  return realFetch(input as RequestInfo, init);
}

beforeAll(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  // §10: read back by explicit id, never a pattern.
  const made = await prisma.artist.findMany({
    where: { musicbrainzId: { in: [TWIN_A, TWIN_B] } },
    select: { id: true },
  });
  for (const a of made) await prisma.artist.delete({ where: { id: a.id } }).catch(() => {});
  await redis.del(`mb:artist:search:${SHARED_NAME.toLowerCase()}`).catch(() => {});
  for (const id of [TWIN_A, TWIN_B]) await redis.del(`mb:artist:v2:${id}`).catch(() => {});
  await redis.quit().catch(() => {});
});

describe("cold artist search", () => {
  it("surfaces an artist we do not hold, as a clickable mb: ref", async () => {
    const res = await request(app).get(`/api/search?q=${encodeURIComponent(SHARED_NAME)}&tab=artists`);
    expect(res.status).toBe(200);

    const cold = (res.body.artists ?? []).filter((a: { ref: string }) => a.ref.startsWith("mb:"));
    expect(cold.length, "expected cold artists to be surfaced").toBeGreaterThan(0);

    const one = cold[0];
    // Namespaced, not a bare id (§3).
    expect(one.ref).toMatch(/^mb:[0-9a-f-]{36}$/i);
    expect(one.id).toBeNull();
    // Null, not 0 — the distinction the client's copy depends on.
    expect(one.releaseCount).toBeNull();
  });

  it("returns BOTH acts that share a name, rather than collapsing them", async () => {
    const res = await request(app).get(`/api/search?q=${encodeURIComponent(SHARED_NAME)}&tab=artists`);
    const refs = (res.body.artists ?? []).map((a: { ref: string }) => a.ref);
    // The American Football rule: a name is not an identity. Seeding one of
    // these must never make the other unreachable.
    expect(refs).toContain(`mb:${TWIN_A}`);
    expect(refs).toContain(`mb:${TWIN_B}`);
  });

  it("materializes the artist when its ref is opened, and it becomes browsable", async () => {
    const before = await prisma.artist.findUnique({ where: { musicbrainzId: TWIN_A } });
    expect(before, "precondition: artist must not exist yet").toBeNull();

    const res = await request(app).get(`/api/artists/mb:${TWIN_A}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.artist.musicbrainzId).toBe(TWIN_A);
    expect(res.body.artist.name).toBe(SHARED_NAME);

    // A real row now exists, and the id it reports resolves on its own.
    const after = await prisma.artist.findUnique({ where: { musicbrainzId: TWIN_A } });
    expect(after).not.toBeNull();
    const byId = await request(app).get(`/api/artists/${res.body.artist.id}`);
    expect(byId.status).toBe(200);
  });

  it("suppresses a cold candidate only once WE hold that MBID", async () => {
    // TWIN_A was materialized by the previous test. It must now appear as a
    // seeded result (real id, numeric count) while its name-twin stays cold —
    // suppression keyed on the id, not the shared name.
    const res = await request(app).get(`/api/search?q=${encodeURIComponent(SHARED_NAME)}&tab=artists`);
    const byRef = new Map(
      (res.body.artists ?? []).map((a: { ref: string }) => [a.ref, a] as const)
    );

    const twinB = byRef.get(`mb:${TWIN_B}`) as { releaseCount: number | null } | undefined;
    expect(twinB, "the name-twin must still be reachable").toBeDefined();
    expect(twinB!.releaseCount).toBeNull();

    // TWIN_A is no longer offered as a cold mb: ref, because we hold it.
    expect(byRef.has(`mb:${TWIN_A}`)).toBe(false);
  });

  it("opening a ref MusicBrainz does not recognise is a 404, not a 500", async () => {
    const res = await request(app).get("/api/artists/mb:cccccccc-3333-4333-8333-cccccccccccc");
    expect(res.status).toBe(404);
  });
});
