// Phase 4.1: a review's like/comment state is identical no matter which surface
// drives it. Liking via the same endpoint the feed uses persists exactly as a
// like from the release page, and every surface reports the same likedByMe/counts.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { deleteReleaseEverywhere } from "../../src/services/catalogService.js";

const app = createApp();
const RUN = Date.now().toString(36);
const DOMAIN = "p41test.local";

let releaseId: string;
let author: { token: string; id: string; username: string };
let liker: { token: string; id: string; username: string };
let reviewId: string;

async function makeUser(tag: string) {
  const username = `p41_${tag}_${RUN}`;
  const res = await request(app)
    .post("/api/auth/register")
    .send({ username, email: `${username}@${DOMAIN}`, password: "correct horse battery" });
  return { token: res.body.accessToken as string, id: res.body.user.id as string, username };
}
const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

beforeAll(async () => {
  const r = await prisma.release.create({
    data: { title: `Interact LP ${RUN}`, artistName: `Interactor ${RUN}`, type: "ALBUM", genres: [] },
  });
  releaseId = r.id;
  author = await makeUser("author");
  liker = await makeUser("liker");
  // liker follows author so the review appears in liker's feed.
  await request(app).post(`/api/users/${author.username}/follow`).set(auth(liker));
  const rev = await request(app)
    .post("/api/reviews")
    .set(auth(author))
    .send({ releaseId, content: `Review ${RUN}`, rating: 4 });
  reviewId = rev.body.review.id;
});

afterAll(async () => {
  await deleteReleaseEverywhere(releaseId);
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  await prisma.$disconnect();
  await redis.quit();
});

function findFeedReview(items: Array<{ type: string; review?: { id: string } }>) {
  return items.find((i) => i.type === "REVIEW" && i.review?.id === reviewId)?.review as
    | { likeCount: number; likedByMe: boolean; commentCount: number }
    | undefined;
}

describe("cross-surface review interactions", () => {
  it("exposes likedByMe consistently across feed, profile, recent, and release", async () => {
    // Before liking: false everywhere for the liker.
    const feed = await request(app).get("/api/feed").set(auth(liker));
    expect(findFeedReview(feed.body.items)).toMatchObject({ likedByMe: false, likeCount: 0 });

    const recent = await request(app).get("/api/reviews/recent").set(auth(liker));
    expect(recent.body.reviews.find((r: { id: string }) => r.id === reviewId).likedByMe).toBe(false);

    const profileReviews = await request(app)
      .get(`/api/users/${author.username}/reviews`)
      .set(auth(liker));
    expect(profileReviews.body.reviews.find((r: { id: string }) => r.id === reviewId).likedByMe).toBe(false);

    const releaseReviews = await request(app)
      .get(`/api/reviews/release/${releaseId}`)
      .set(auth(liker));
    expect(releaseReviews.body.reviews.find((r: { id: string }) => r.id === reviewId).likedByMe).toBe(false);
  });

  it("a like from the feed context persists identically to the release page", async () => {
    // Like via the shared endpoint (same one the feed's ReviewCard calls).
    const like = await request(app).post(`/api/reviews/${reviewId}/like`).set(auth(liker));
    expect(like.body).toMatchObject({ likeCount: 1, likedByMe: true });

    // Now EVERY surface agrees: liked, count 1.
    const feed = await request(app).get("/api/feed").set(auth(liker));
    expect(findFeedReview(feed.body.items)).toMatchObject({ likedByMe: true, likeCount: 1 });

    const recent = await request(app).get("/api/reviews/recent").set(auth(liker));
    expect(recent.body.reviews.find((r: { id: string }) => r.id === reviewId)).toMatchObject({
      likedByMe: true,
      likeCount: 1,
    });

    const releaseReviews = await request(app)
      .get(`/api/reviews/release/${releaseId}`)
      .set(auth(liker));
    expect(releaseReviews.body.reviews.find((r: { id: string }) => r.id === reviewId)).toMatchObject({
      likedByMe: true,
      likeCount: 1,
    });

    // The author (a different viewer) sees the count but likedByMe:false.
    const authorView = await request(app).get(`/api/reviews/release/${releaseId}`).set(auth(author));
    expect(authorView.body.reviews.find((r: { id: string }) => r.id === reviewId)).toMatchObject({
      likeCount: 1,
      likedByMe: false,
    });
  });

  it("a comment from the feed bumps commentCount on every surface", async () => {
    await request(app)
      .post(`/api/reviews/${reviewId}/comments`)
      .set(auth(liker))
      .send({ content: "Agreed." });

    const feed = await request(app).get("/api/feed").set(auth(liker));
    expect(findFeedReview(feed.body.items)?.commentCount).toBe(1);

    const releaseReviews = await request(app).get(`/api/reviews/release/${releaseId}`);
    expect(releaseReviews.body.reviews.find((r: { id: string }) => r.id === reviewId).commentCount).toBe(1);
  });
});
