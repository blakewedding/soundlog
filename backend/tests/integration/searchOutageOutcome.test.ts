/**
 * 6.3e — a failed search and an empty search must be different answers.
 *
 * The bug: `searchMusicBrainzArtists` caught `UpstreamUnavailableError` and
 * returned `[]`. Since the artist index only ever holds artists we have already
 * seeded, an un-seeded artist's entire result depends on that one call — so an
 * outage rendered as "this artist does not exist", with a perfectly ordinary
 * HTTP 200, on every surface, for everyone. Three real artists (Xiu Xiu, The
 * Blue Nile, The Chromatics) were unfindable that way.
 *
 * §7 still allows exactly ONE attempt for a discovery call, and that is
 * unchanged here — this is not about trying harder. §7 also says what the answer
 * must be when the attempt fails: "the answer is still 503, never 404."
 *
 * The interesting half is the SECOND test. Failing loudly is easy; failing
 * loudly when we had something true to show would be a worse bug than the one
 * being fixed, so a partial answer must still be served.
 */
import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { es, ARTIST_INDEX } from "../../src/config/elasticsearch.js";
import { indexArtist } from "../../src/services/searchService.js";
import { runTag } from "../support/runTag.js";

const app = createApp();
const RUN = runTag("outage");
const created: string[] = [];
const keys: string[] = [];

/** Every MusicBrainz call fails in a way §1 calls "we could not tell". */
function stubMbUnavailable() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) =>
      String(url).includes("musicbrainz.org")
        ? new Response("busy", { status: 503 })
        : new Response("{}", { status: 200 })
    )
  );
}

beforeAll(async () => {
  await redis.connect().catch(() => {});
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  // §10: an explicit list of ids and keys this file created.
  if (created.length) {
    await prisma.artist.deleteMany({ where: { id: { in: created } } });
    for (const id of created) await es.delete({ index: ARTIST_INDEX, id }).catch(() => {});
  }
  if (keys.length) await redis.del(...keys).catch(() => {});
  await prisma.$disconnect();
  await redis.quit().catch(() => {});
});

describe("an artist search that could not be answered", () => {
  it("is a 503 with Retry-After, not an empty 200", async () => {
    const q = `Unseeded${RUN}`;
    keys.push(`mb:artist:search:${q.toLowerCase()}`);
    stubMbUnavailable();

    const res = await request(app).get("/api/search").query({ q, tab: "artists" });

    // Before the fix this was `200 { artists: [] }` — indistinguishable from
    // "there is no such artist".
    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBeDefined();
    expect(res.body.artists).toBeUndefined();
  });

  it("caches NOTHING, so the next attempt is a real one", async () => {
    const q = `Uncached${RUN}`;
    const key = `mb:artist:search:${q.toLowerCase()}`;
    keys.push(key);
    stubMbUnavailable();

    await request(app).get("/api/search").query({ q, tab: "artists" });
    expect(await redis.get(key)).toBeNull();
  });

  it("still serves what we DO hold when the fan-out fails", async () => {
    // The half that matters: an outage must not hide good data. A seeded artist
    // is a true answer, merely a thinner one than we could have given.
    const name = `Havemore${RUN}`;
    const row = await prisma.artist.create({ data: { name, aliases: [] } });
    created.push(row.id);
    await indexArtist(row);
    await es.indices.refresh({ index: ARTIST_INDEX }).catch(() => {});
    keys.push(`mb:artist:search:${name.toLowerCase()}`);

    stubMbUnavailable();
    const res = await request(app).get("/api/search").query({ q: name, tab: "artists" });

    expect(res.status).toBe(200);
    expect(res.body.artists.map((a: { name: string }) => a.name)).toContain(name);
  });
});
