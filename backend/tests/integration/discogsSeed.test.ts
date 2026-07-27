// Regression: Discogs masters and releases are SEPARATE numeric ID namespaces.
// A search hit of type "release" (id N) must never be looked up as master N —
// that seeded a completely different album (found via "Live at the Liquid Room –
// Tokyo" [release 9459, Jeff Mills] landing on "Bodycage" [master 9459, Nadja]).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { es, RELEASE_INDEX } from "../../src/config/elasticsearch.js";
import { runTag } from "../support/runTag.js";

const app = createApp();
// Letters only, NOT `Date.now().toString(36)` — see tests/support/runTag.ts.
// This file asserts that a search surfaces its own fixture, and a time-derived
// tag shares an analyzed token with every other live fixture, which pushes the
// query past THIN_RESULTS and skips the fan-out being tested.
const RUN = runTag("dg");
// Unique per run so the test never collides with real catalog rows.
const DISCOGS_ID = 900000000 + (Date.now() % 1000000);
// Fully synthetic names: search is ES-first and only fans out to sources on
// thin (<5) results, so titles sharing words with real seeded releases (as the
// catalog grows) would satisfy ES and the mocked Discogs would never be asked.
const MIX_TITLE = `Zxqliquid Session ${RUN}`;
const MIX_ARTIST = `Zxqmiller ${RUN}`;
const TRAP_TITLE = `Zxqbodycage ${RUN}`;
const TRAP_ARTIST = `Zxqnadja ${RUN}`;

const realFetch = globalThis.fetch.bind(globalThis);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Tracks which Discogs detail endpoints actually get hit.
export const hitLog: string[] = [];

function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();

  // MusicBrainz knows nothing about this obscure mix — no confident match.
  if (url.includes("musicbrainz.org")) {
    return Promise.resolve(json({ "release-groups": [] }));
  }
  if (url.includes("coverartarchive.org")) {
    return Promise.resolve(json({}, 404));
  }
  if (url.includes("audioscrobbler.com")) {
    return Promise.resolve(json({ toptags: { tag: [] } }));
  }

  if (url.includes("api.discogs.com")) {
    if (url.includes("/database/search")) {
      return Promise.resolve(
        json({
          results: [
            {
              id: DISCOGS_ID,
              type: "release", // ← a release-type hit; id exists as an unrelated master too
              title: `${MIX_ARTIST} - ${MIX_TITLE}`,
              year: "1996",
              format: ["CD", "Mixed"],
              cover_image: "https://discogs.example/mix.jpg",
            },
          ],
        })
      );
    }
    // The trap: the SAME numeric id resolves in the master namespace to a
    // completely different album.
    if (url.includes(`/masters/${DISCOGS_ID}`)) {
      hitLog.push("masters");
      return Promise.resolve(
        json({
          id: DISCOGS_ID,
          title: TRAP_TITLE,
          year: 2005,
          artists: [{ name: TRAP_ARTIST, id: 1 }],
          formats: [{ name: "CD" }],
        })
      );
    }
    if (url.includes(`/releases/${DISCOGS_ID}`)) {
      hitLog.push("releases");
      return Promise.resolve(
        json({
          id: DISCOGS_ID,
          title: MIX_TITLE,
          year: 1996,
          artists: [{ name: MIX_ARTIST, id: 2 }],
          formats: [{ name: "CD", descriptions: ["Mixed"] }],
          images: [{ uri: "https://discogs.example/mix-primary.jpg", type: "primary" }],
        })
      );
    }
  }

  return realFetch(input, init);
}

async function cleanup() {
  const rows = await prisma.release.findMany({
    where: { OR: [{ title: MIX_TITLE }, { title: TRAP_TITLE }] },
  });
  for (const r of rows) await es.delete({ index: RELEASE_INDEX, id: r.id }).catch(() => {});
  await prisma.release.deleteMany({ where: { OR: [{ title: MIX_TITLE }, { title: TRAP_TITLE }] } });
}

beforeAll(async () => {
  await cleanup();
  vi.stubGlobal("fetch", mockFetch);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await cleanup();
  await prisma.$disconnect();
  await redis.quit();
});

describe("Discogs master/release ID namespace collision", () => {
  it("clicking a release-type search hit seeds THAT release, not the same-numbered master", async () => {
    // 1. Search — the DJ mix comes back from the Discogs fan-out.
    const search = await request(app).get(`/api/search?q=${encodeURIComponent(MIX_TITLE)}`);
    expect(search.status).toBe(200);
    const hit = (search.body.results as Array<Record<string, string>>).find(
      (r) => r.title === MIX_TITLE
    );
    expect(hit, "search should surface the DJ mix").toBeDefined();

    // The ref must preserve the Discogs namespace, not just the bare number.
    expect(hit!.ref).toContain("release");

    // 2. Click it — seed-on-first-access must land on the mix, never the trap.
    const seeded = await request(app).get(`/api/releases/${encodeURIComponent(hit!.ref)}`);
    expect(seeded.status).toBe(200);
    expect(seeded.body.release.title).toBe(MIX_TITLE);
    expect(seeded.body.release.artistName).toBe(MIX_ARTIST);
    expect(seeded.body.release.title).not.toBe(TRAP_TITLE);

    // 3. The master endpoint for that numeric id must never have been consulted.
    expect(hitLog).not.toContain("masters");

    // 4. "Mixed" format maps to DJ_MIX.
    expect(seeded.body.release.type).toBe("DJ_MIX");
  });
});
