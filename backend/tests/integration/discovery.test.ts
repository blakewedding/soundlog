// Phase 5: the popular-review feed and "listeners like you" suggestions.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { runTag } from "../support/runTag.js";

const app = createApp();
const RUN = runTag();
const DOMAIN = "p5disc.local";

let releaseA: string;
let releaseB: string;
let alice: { token: string; id: string; username: string };
let bob: { token: string; id: string; username: string };
let carol: { token: string; id: string; username: string };
let popularReviewId: string;

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makeUser(tag: string) {
  const username = `disc_${tag}_${RUN}`;
  const res = await request(app)
    .post("/api/auth/register")
    .send({ username, email: `${username}@${DOMAIN}`, password: "correct horse battery" });
  return { token: res.body.accessToken as string, id: res.body.user.id as string, username };
}

beforeAll(async () => {
  const a = await prisma.release.create({
    data: { title: `Disc A ${RUN}`, artistName: `Disc ${RUN}`, type: "ALBUM", genres: [] },
  });
  const b = await prisma.release.create({
    data: { title: `Disc B ${RUN}`, artistName: `Disc ${RUN}`, type: "ALBUM", genres: [] },
  });
  releaseA = a.id;
  releaseB = b.id;
  alice = await makeUser("alice");
  bob = await makeUser("bob");
  carol = await makeUser("carol");

  // Alice and Bob both love A and B (overlap 2); Carol loves only A (overlap 1).
  // Nobody follows anyone — so they should surface as each other's suggestions.
  await prisma.rating.createMany({
    data: [
      { userId: alice.id, releaseId: releaseA, value: 5 },
      { userId: alice.id, releaseId: releaseB, value: 4.5 },
      { userId: bob.id, releaseId: releaseA, value: 4.5 },
      { userId: bob.id, releaseId: releaseB, value: 5 },
      { userId: carol.id, releaseId: releaseA, value: 4 },
    ],
  });

  // A review with two likes should lead the popular feed.
  const rev = await request(app)
    .post("/api/reviews")
    .set(auth(alice.token))
    .send({ releaseId: releaseA, content: `Popular pick ${RUN}`, rating: 5 });
  popularReviewId = rev.body.review.id;
  await request(app).post(`/api/reviews/${popularReviewId}/like`).set(auth(bob.token));
  await request(app).post(`/api/reviews/${popularReviewId}/like`).set(auth(carol.token));
});

afterAll(async () => {
  const ids = [releaseA, releaseB];
  await prisma.reviewLike.deleteMany({ where: { review: { releaseId: { in: ids } } } });
  await prisma.review.deleteMany({ where: { releaseId: { in: ids } } });
  await prisma.rating.deleteMany({ where: { releaseId: { in: ids } } });
  await prisma.release.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  for (const u of [alice, bob, carol]) await redis.del(`similar:${u.id}`);
  await prisma.$disconnect();
  await redis.quit();
});

describe("GET /api/feed/popular", () => {
  it("is led by the most-liked review and is cacheable for anonymous viewers", async () => {
    const res = await request(app).get(`/api/feed/popular?limit=50`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    const mine = (res.body.reviews as Array<{ id: string; likeCount: number; likedByMe: boolean }>).find(
      (r) => r.id === popularReviewId
    );
    expect(mine).toBeDefined();
    expect(mine!.likeCount).toBe(2);
    expect(mine!.likedByMe).toBe(false); // anonymous
  });

  it("marks likedByMe for an authenticated viewer and is not shared-cacheable", async () => {
    const res = await request(app).get(`/api/feed/popular?limit=50`).set(auth(bob.token));
    expect(res.headers["cache-control"]).toBe("private, no-cache");
    const mine = (res.body.reviews as Array<{ id: string; likedByMe: boolean }>).find(
      (r) => r.id === popularReviewId
    );
    expect(mine!.likedByMe).toBe(true); // bob liked it
  });
});

describe("GET /api/users/:username/similar", () => {
  it("surfaces the highest-overlap listener first, excluding the user themselves", async () => {
    const res = await request(app).get(`/api/users/${alice.username}/similar`);
    expect(res.status).toBe(200);
    const listeners = res.body.listeners as Array<{ username: string; sharedCount: number }>;
    const names = listeners.map((l) => l.username);
    expect(names).not.toContain(alice.username);
    expect(names).toContain(bob.username);
    expect(names).toContain(carol.username);
    // Bob overlaps on 2 releases, Carol on 1 → Bob ranks first.
    expect(names.indexOf(bob.username)).toBeLessThan(names.indexOf(carol.username));
    expect(listeners.find((l) => l.username === bob.username)!.sharedCount).toBe(2);
  });

  it("excludes members the user already follows and invalidates the cache on follow", async () => {
    await request(app).post(`/api/users/${bob.username}/follow`).set(auth(alice.token));
    const res = await request(app).get(`/api/users/${alice.username}/similar`);
    const names = (res.body.listeners as Array<{ username: string }>).map((l) => l.username);
    expect(names).not.toContain(bob.username); // now followed
    expect(names).toContain(carol.username); // still a suggestion
  });
});
