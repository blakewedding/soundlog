// Phase 5: genre & year charts rank releases by a Bayesian weighted rating with
// recency-weighted likes as the tiebreak. Thin data is shown, not gated.
//
// The Bayesian prior shrinks each release's mean toward the catalog's global
// mean in proportion to how few ratings it has. For two releases with the SAME
// above-average average, the better-established (more-rated) one therefore ranks
// higher — confidence in an above-average score is rewarded. That ordering holds
// regardless of the exact global mean, which is what we assert here.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";

const app = createApp();
const RUN = Date.now().toString(36);
const GENRE = `testgenre ${RUN}`; // stored form (spaces); slug uses hyphens
const SLUG = GENRE.replace(/\s+/g, "-");
const DOMAIN = "p5charts.local";

let established: string; // five 4.5★ ratings
let thin: string; // one 4.5★ rating — same average, less confidence
let unrated: string; // no ratings — shown, but last
let raters: string[] = [];

async function makeUser(tag: string) {
  const username = `chart_${tag}_${RUN}`;
  const res = await request(app)
    .post("/api/auth/register")
    .send({ username, email: `${username}@${DOMAIN}`, password: "correct horse battery" });
  return res.body.user.id as string;
}

beforeAll(async () => {
  const mk = (title: string) =>
    prisma.release.create({
      data: {
        title: `${title} ${RUN}`,
        artistName: `Charter ${RUN}`,
        type: "ALBUM",
        genres: [GENRE],
        releaseDate: new Date(Date.UTC(1999, 0, 1)),
      },
    });
  established = (await mk("Established")).id;
  thin = (await mk("Thin")).id;
  unrated = (await mk("Unrated")).id;

  raters = await Promise.all([0, 1, 2, 3, 4].map((i) => makeUser(String(i))));
  // Same 4.5 average on both, but Established has five ratings vs Thin's one.
  await prisma.rating.createMany({
    data: raters.map((userId) => ({ userId, releaseId: established, value: 4.5 })),
  });
  await prisma.rating.create({ data: { userId: raters[0], releaseId: thin, value: 4.5 } });
});

afterAll(async () => {
  const ids = [established, thin, unrated];
  await prisma.rating.deleteMany({ where: { releaseId: { in: ids } } });
  await prisma.release.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  await prisma.$disconnect();
  await redis.quit();
});

describe("GET /api/charts/genre/:tag", () => {
  it("ranks a well-established above-average release above a thinly-rated one (Bayesian confidence)", async () => {
    const res = await request(app).get(`/api/charts/genre/${encodeURIComponent(SLUG)}`);
    expect(res.status).toBe(200);
    expect(res.body.tag).toBe(GENRE);
    const ids = (res.body.releases as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(established);
    expect(ids).toContain(thin);
    expect(ids.indexOf(established)).toBeLessThan(ids.indexOf(thin));
  });

  it("shows thin data — an unrated release still appears (no gate by default)", async () => {
    const res = await request(app).get(`/api/charts/genre/${encodeURIComponent(SLUG)}`);
    const ids = (res.body.releases as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(unrated);
    // ...but it ranks below both rated releases.
    expect(ids.indexOf(unrated)).toBeGreaterThan(ids.indexOf(thin));
  });

  it("minRatings gates thin data when asked", async () => {
    const res = await request(app).get(
      `/api/charts/genre/${encodeURIComponent(SLUG)}?minRatings=1`
    );
    const ids = (res.body.releases as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(established);
    expect(ids).not.toContain(unrated);
  });
});

describe("GET /api/charts/year/:year", () => {
  it("ranks releases from the requested year", async () => {
    const res = await request(app).get("/api/charts/year/1999");
    expect(res.status).toBe(200);
    expect(res.body.year).toBe(1999);
    const ids = (res.body.releases as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(established);
    expect(ids.indexOf(established)).toBeLessThan(ids.indexOf(thin));
  });

  it("rejects a nonsense year", async () => {
    const res = await request(app).get("/api/charts/year/abcd");
    expect(res.status).toBe(400);
  });
});
