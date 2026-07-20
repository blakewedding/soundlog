// Phase 4: follow/unfollow, the activity feed (fan-out on read), profiles with
// privacy, and pagination. Activity is recorded synchronously in tests (see
// emitActivity); a separate test exercises the real BullMQ round-trip.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { deleteReleaseEverywhere } from "../../src/services/catalogService.js";

const app = createApp();
const RUN = Date.now().toString(36);
const DOMAIN = "p4test.local";

let releaseId: string;
let release2Id: string;
let alice: { token: string; id: string; username: string };
let bob: { token: string; id: string; username: string };

async function makeUser(tag: string) {
  const username = `p4_${tag}_${RUN}`;
  const res = await request(app)
    .post("/api/auth/register")
    .send({ username, email: `${username}@${DOMAIN}`, password: "correct horse battery" });
  return { token: res.body.accessToken as string, id: res.body.user.id as string, username };
}
const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

beforeAll(async () => {
  const r1 = await prisma.release.create({
    data: { title: `Feed LP ${RUN}`, artistName: `Feeder ${RUN}`, type: "ALBUM", genres: [] },
  });
  const r2 = await prisma.release.create({
    data: { title: `Feed EP ${RUN}`, artistName: `Feeder ${RUN}`, type: "EP", genres: [] },
  });
  releaseId = r1.id;
  release2Id = r2.id;
  alice = await makeUser("alice");
  bob = await makeUser("bob");
});

afterAll(async () => {
  await deleteReleaseEverywhere(releaseId);
  await deleteReleaseEverywhere(release2Id);
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  await prisma.$disconnect();
  await redis.quit();
});

describe("follow / unfollow", () => {
  it("follows idempotently and reports follower count", async () => {
    const f1 = await request(app).post(`/api/users/${bob.username}/follow`).set(auth(alice));
    expect(f1.status).toBe(200);
    expect(f1.body).toMatchObject({ following: true, followerCount: 1 });

    // Idempotent — no duplicate follow, count stays 1.
    await request(app).post(`/api/users/${bob.username}/follow`).set(auth(alice));
    expect(await prisma.follow.count({ where: { followingId: bob.id } })).toBe(1);
  });

  it("rejects following yourself (400)", async () => {
    const res = await request(app).post(`/api/users/${alice.username}/follow`).set(auth(alice));
    expect(res.status).toBe(400);
  });

  it("profile reflects follow state and counts", async () => {
    const res = await request(app).get(`/api/users/${bob.username}`).set(auth(alice));
    expect(res.body.profile).toMatchObject({ username: bob.username, isFollowing: true, isMe: false });
    expect(res.body.profile.counts.followers).toBe(1);

    const mine = await request(app).get(`/api/users/${alice.username}`).set(auth(alice));
    expect(mine.body.profile.isMe).toBe(true);
    expect(mine.body.profile.counts.following).toBe(1);
  });

  it("followers / following lists carry viewer follow state", async () => {
    const followers = await request(app).get(`/api/users/${bob.username}/followers`).set(auth(alice));
    expect(followers.body.users.map((u: { username: string }) => u.username)).toContain(alice.username);

    const following = await request(app).get(`/api/users/${alice.username}/following`).set(auth(alice));
    const bobEdge = following.body.users.find((u: { username: string }) => u.username === bob.username);
    expect(bobEdge.isFollowing).toBe(true); // alice follows bob
  });
});

describe("feed — fan-out from followed users", () => {
  let reviewId: string;

  it("surfaces a followee's log, rating, and review; reuses review data", async () => {
    // Bob is active. Alice follows Bob (from above).
    await request(app).post("/api/logs").set(auth(bob)).send({ releaseId });
    await request(app).put(`/api/ratings/${releaseId}`).set(auth(bob)).send({ value: 4.5 });
    const rev = await request(app)
      .post("/api/reviews")
      .set(auth(bob))
      .send({ releaseId, content: "Bob's take on this record.", rating: 4.5 });
    reviewId = rev.body.review.id;

    const feed = await request(app).get("/api/feed").set(auth(alice));
    expect(feed.status).toBe(200);
    const types = feed.body.items.map((i: { type: string }) => i.type);
    expect(types).toEqual(expect.arrayContaining(["LOG", "RATING", "REVIEW"]));

    const reviewItem = feed.body.items.find((i: { type: string }) => i.type === "REVIEW");
    // The review carries what ReviewCard renders (no parallel shape).
    expect(reviewItem.review).toMatchObject({
      content: "Bob's take on this record.",
      rating: 4.5,
      release: { title: `Feed LP ${RUN}` },
      user: { username: bob.username },
    });
    expect(reviewItem.review.likeCount).toBe(0);

    const ratingItem = feed.body.items.find((i: { type: string }) => i.type === "RATING");
    expect(ratingItem.rating).toBe(4.5);
    expect(ratingItem.release.title).toBe(`Feed LP ${RUN}`);
  });

  it("does not include your own activity, only followees'", async () => {
    // Alice acts; her own actions must not appear in her feed.
    await request(app).post("/api/logs").set(auth(alice)).send({ releaseId });
    const feed = await request(app).get("/api/feed").set(auth(alice));
    const actors = new Set(feed.body.items.map((i: { user: { username: string } }) => i.user.username));
    expect(actors.has(alice.username)).toBe(false);
    expect(actors.has(bob.username)).toBe(true);
  });

  it("private lists never appear in the feed", async () => {
    // Bob makes a public list then a private one; only the public one fans out.
    const pub = await request(app).post("/api/lists").set(auth(bob)).send({ title: `Public ${RUN}` });
    const priv = await request(app)
      .post("/api/lists")
      .set(auth(bob))
      .send({ title: `Secret ${RUN}`, isPublic: false });
    await request(app).post(`/api/lists/${priv.body.list.id}/items`).set(auth(bob)).send({ releaseId });

    const feed = await request(app).get("/api/feed?limit=50").set(auth(alice));
    const listTitles = feed.body.items
      .filter((i: { type: string }) => i.type.startsWith("LIST"))
      .map((i: { list: { title: string } }) => i.list.title);
    expect(listTitles).toContain(`Public ${RUN}`);
    expect(listTitles).not.toContain(`Secret ${RUN}`);
    expect(pub.body.list.id).toBeTruthy();
  });

  it("paginates by cursor", async () => {
    const page1 = await request(app).get("/api/feed?limit=2").set(auth(alice));
    expect(page1.body.items.length).toBeLessThanOrEqual(2);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await request(app)
      .get(`/api/feed?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .set(auth(alice));
    // Second page is strictly older than the first page's cursor.
    const firstIds = new Set(page1.body.items.map((i: { id: string }) => i.id));
    for (const item of page2.body.items) expect(firstIds.has(item.id)).toBe(false);
  });

  it("empty feed when following nobody", async () => {
    const loner = await makeUser("loner");
    const feed = await request(app).get("/api/feed").set(auth(loner));
    expect(feed.body).toEqual({ items: [], nextCursor: null });
  });

  it("reviewId is stable for the profile check", () => {
    expect(reviewId).toBeTruthy();
  });
});

describe("profile tabs + privacy", () => {
  it("reviews / ratings / diary tabs return the user's data", async () => {
    const reviews = await request(app).get(`/api/users/${bob.username}/reviews`);
    expect(reviews.body.reviews[0]).toMatchObject({ content: "Bob's take on this record." });

    const ratings = await request(app).get(`/api/users/${bob.username}/ratings`);
    expect(ratings.body.ratings[0]).toMatchObject({ value: 4.5 });

    const diary = await request(app).get(`/api/users/${bob.username}/diary`);
    expect(diary.body.logs.length).toBeGreaterThanOrEqual(1);
    expect(diary.body.logs[0].release.title).toBe(`Feed LP ${RUN}`);
  });

  it("hides private lists from non-owners but shows them to the owner", async () => {
    const asStranger = await request(app).get(`/api/users/${bob.username}/lists`).set(auth(alice));
    const strangerTitles = asStranger.body.lists.map((l: { title: string }) => l.title);
    expect(strangerTitles).toContain(`Public ${RUN}`);
    expect(strangerTitles).not.toContain(`Secret ${RUN}`);

    const asOwner = await request(app).get(`/api/users/${bob.username}/lists`).set(auth(bob));
    const ownerTitles = asOwner.body.lists.map((l: { title: string }) => l.title);
    expect(ownerTitles).toContain(`Secret ${RUN}`);

    // Count also respects privacy for non-owners.
    const strangerProfile = await request(app).get(`/api/users/${bob.username}`).set(auth(alice));
    const ownerProfile = await request(app).get(`/api/users/${bob.username}`).set(auth(bob));
    expect(ownerProfile.body.profile.counts.lists).toBeGreaterThan(strangerProfile.body.profile.counts.lists);
  });

  it("404s for an unknown username", async () => {
    const res = await request(app).get("/api/users/nobody-here-xyz");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/reviews/recent", () => {
  it("returns latest reviews in ReviewCard shape", async () => {
    const res = await request(app).get("/api/reviews/recent");
    expect(res.status).toBe(200);
    const mine = res.body.reviews.find((r: { content: string }) => r.content === "Bob's take on this record.");
    expect(mine).toMatchObject({ release: { title: `Feed LP ${RUN}` }, user: { username: bob.username } });
  });
});
