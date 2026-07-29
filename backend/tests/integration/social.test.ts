// Phase 3: ratings, reviews, likes, threaded comments, logs, ranked lists —
// plus the release-delete/ES-sync guarantee. Real Postgres/Redis/ES; no
// external metadata APIs are touched (releases are created directly).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { es, RELEASE_INDEX } from "../../src/config/elasticsearch.js";
import { indexRelease } from "../../src/services/searchService.js";
import { deleteReleaseEverywhere } from "../../src/services/catalogService.js";
import { runTag } from "../support/runTag.js";

const app = createApp();
const RUN = runTag();
// Own cleanup domain — sharing auth.test.ts's domain caused a parallel-run
// race where this suite's afterAll deleted the auth suite's users mid-test.
const DOMAIN = "p3test.local";

let releaseId: string;
let user1: { token: string; id: string };
let user2: { token: string; id: string };

async function makeUser(tag: string) {
  const username = `p3_${tag}_${RUN}`;
  // Usernames cap at 24 (auth.ts) and RUN is 12 letters, so a longer tag here
  // fails as a 422 whose only symptom is a TypeError on res.body.user.id.
  // Fail at the fixture, where the message says what is actually wrong.
  if (username.length > 24) throw new Error(`fixture username too long: ${username}`);
  const res = await request(app)
    .post("/api/auth/register")
    .send({ username, email: `${username}@${DOMAIN}`, password: "correct horse battery" });
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

beforeAll(async () => {
  const release = await prisma.release.create({
    data: { title: `Test LP ${RUN}`, artistName: `Tester ${RUN}`, type: "ALBUM", genres: [] },
  });
  releaseId = release.id;
  await indexRelease(release);
  user1 = await makeUser("one");
  user2 = await makeUser("two");
});

afterAll(async () => {
  await deleteReleaseEverywhere(releaseId);
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  await prisma.$disconnect();
  await redis.quit();
});

// ---------------------------------------------------------------------------
describe("myLogCount on the release DTO (5.6.1b)", () => {
  // The release page shows "In your diary ×N" from this. It must read the same
  // Log rows the diary renders, and count relistens. Uses its own user so it
  // can't perturb log counts other cases in this file depend on.
  it("counts the viewer's logs, increments on relisten, and is 0 anonymously", async () => {
    const logger = await makeUser("logcount");

    const before = await request(app).get(`/api/releases/${releaseId}`).set(auth(logger));
    expect(before.body.release.myLogCount).toBe(0);

    await request(app).post("/api/logs").set(auth(logger)).send({ releaseId });
    const after1 = await request(app).get(`/api/releases/${releaseId}`).set(auth(logger));
    expect(after1.body.release.myLogCount).toBe(1);

    // A relisten increments rather than replacing.
    await request(app).post("/api/logs").set(auth(logger)).send({ releaseId });
    const after2 = await request(app).get(`/api/releases/${releaseId}`).set(auth(logger));
    expect(after2.body.release.myLogCount).toBe(2);

    // Anonymous viewers have no personal count.
    const anon = await request(app).get(`/api/releases/${releaseId}`);
    expect(anon.body.release.myLogCount ?? 0).toBe(0);
  });
});

describe("ratings", () => {
  it("upserts my rating and reflects it in the release DTO", async () => {
    const put = await request(app).put(`/api/ratings/${releaseId}`).set(auth(user1)).send({ value: 3.5 });
    expect(put.status).toBe(200);
    expect(put.body.rating.value).toBe(3.5);

    // Same route again updates, never duplicates (DB @@unique).
    await request(app).put(`/api/ratings/${releaseId}`).set(auth(user1)).send({ value: 4.5 });
    expect(await prisma.rating.count({ where: { releaseId } })).toBe(1);

    const rel = await request(app).get(`/api/releases/${releaseId}`).set(auth(user1));
    expect(rel.body.release.myRating).toBe(4.5);
    expect(rel.body.release.avgRating).toBe(4.5);
    expect(rel.body.release.ratingCount).toBe(1);
  });

  it("rejects off-scale values (422)", async () => {
    for (const value of [0, 0.3, 5.5, 4.25]) {
      const res = await request(app).put(`/api/ratings/${releaseId}`).set(auth(user1)).send({ value });
      expect(res.status, `value ${value}`).toBe(422);
    }
  });

  it("requires auth (401)", async () => {
    const res = await request(app).put(`/api/ratings/${releaseId}`).send({ value: 3 });
    expect(res.status).toBe(401);
  });

  it("deletes my rating (204, idempotent)", async () => {
    const res = await request(app).delete(`/api/ratings/${releaseId}`).set(auth(user2));
    expect(res.status).toBe(204); // user2 had none — still 204
  });
});

// ---------------------------------------------------------------------------
describe("reviews", () => {
  let reviewId: string;

  it("creates a review (with attached rating) and enforces one per release with a friendly 409", async () => {
    const res = await request(app)
      .post("/api/reviews")
      .set(auth(user1))
      .send({ releaseId, content: "A modern classic.", rating: 5 });
    expect(res.status).toBe(201);
    reviewId = res.body.review.id;
    expect(res.body.review.likeCount).toBe(0);

    const again = await request(app)
      .post("/api/reviews")
      .set(auth(user1))
      .send({ releaseId, content: "Wait, I have more thoughts." });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already reviewed/i);
    expect(again.body.error).toMatch(/edit/i); // friendly, actionable

    // The attached rating upserted the Rating row too.
    const rel = await request(app).get(`/api/releases/${releaseId}`).set(auth(user1));
    expect(rel.body.release.myRating).toBe(5);
    expect(rel.body.release.myReviewId).toBe(reviewId);
  });

  it("lists a release's reviews with like state", async () => {
    const res = await request(app).get(`/api/reviews/release/${releaseId}`).set(auth(user2));
    expect(res.status).toBe(200);
    expect(res.body.reviews).toHaveLength(1);
    expect(res.body.reviews[0]).toMatchObject({ content: "A modern classic.", likedByMe: false });
  });

  it("only the owner can edit (403), and edits update content", async () => {
    const stranger = await request(app)
      .patch(`/api/reviews/${reviewId}`)
      .set(auth(user2))
      .send({ content: "hijacked" });
    expect(stranger.status).toBe(403);

    const owner = await request(app)
      .patch(`/api/reviews/${reviewId}`)
      .set(auth(user1))
      .send({ content: "A modern classic. (edited)" });
    expect(owner.status).toBe(200);
    expect(owner.body.review.content).toContain("(edited)");
  });

  it("like/unlike is idempotent and counted", async () => {
    const like = await request(app).post(`/api/reviews/${reviewId}/like`).set(auth(user2));
    expect(like.body).toMatchObject({ likeCount: 1, likedByMe: true });
    await request(app).post(`/api/reviews/${reviewId}/like`).set(auth(user2)); // double-like: no dup
    const relike = await request(app).post(`/api/reviews/${reviewId}/like`).set(auth(user2));
    expect(relike.body.likeCount).toBe(1);

    const unlike = await request(app).delete(`/api/reviews/${reviewId}/like`).set(auth(user2));
    expect(unlike.body).toMatchObject({ likeCount: 0, likedByMe: false });
  });

  describe("threaded comments", () => {
    let topId: string;
    let replyId: string;

    it("comments and replies one level deep — never deeper (422)", async () => {
      const top = await request(app)
        .post(`/api/reviews/${reviewId}/comments`)
        .set(auth(user2))
        .send({ content: "Completely agree." });
      expect(top.status).toBe(201);
      topId = top.body.comment.id;

      const reply = await request(app)
        .post(`/api/reviews/${reviewId}/comments`)
        .set(auth(user1))
        .send({ content: "Glad you think so!", parentId: topId });
      expect(reply.status).toBe(201);
      replyId = reply.body.comment.id;

      const tooDeep = await request(app)
        .post(`/api/reviews/${reviewId}/comments`)
        .set(auth(user2))
        .send({ content: "replying to the reply", parentId: replyId });
      expect(tooDeep.status).toBe(422);
      expect(tooDeep.body.error).toMatch(/nested/i);
    });

    it("soft delete keeps the thread; parent shows as deleted placeholder", async () => {
      const del = await request(app).delete(`/api/comments/${topId}`).set(auth(user2));
      expect(del.status).toBe(204);

      const thread = await request(app).get(`/api/reviews/${reviewId}/comments`);
      expect(thread.status).toBe(200);
      const parent = thread.body.comments.find((c: { id: string }) => c.id === topId);
      // Parent still present (it has a reply), but scrubbed.
      expect(parent).toBeDefined();
      expect(parent.deleted).toBe(true);
      expect(parent.content).toBeNull();
      expect(parent.user).toBeNull();
      expect(parent.replies).toHaveLength(1);
      expect(parent.replies[0].content).toBe("Glad you think so!");

      // Row still exists in the DB (soft, not hard).
      const row = await prisma.reviewComment.findUnique({ where: { id: topId } });
      expect(row?.deletedAt).not.toBeNull();
    });
  });

  it("owner can delete the review; likes and comments cascade", async () => {
    const del = await request(app).delete(`/api/reviews/${reviewId}`).set(auth(user1));
    expect(del.status).toBe(204);
    expect(await prisma.reviewComment.count({ where: { reviewId } })).toBe(0);
  });

  it("deleting a review PRESERVES its standalone rating (Letterboxd policy, confirmed)", async () => {
    // The review above was created with rating: 5, which upserted a Rating row.
    // That rating must survive the review's deletion.
    const rating = await prisma.rating.findUnique({
      where: { userId_releaseId: { userId: user1.id, releaseId } },
    });
    expect(rating).not.toBeNull();
    expect(rating!.value).toBe(5);

    const rel = await request(app).get(`/api/releases/${releaseId}`).set(auth(user1));
    expect(rel.body.release.myRating).toBe(5);
    expect(rel.body.release.myReviewId).toBeUndefined(); // review gone, rating kept
  });
});

// ---------------------------------------------------------------------------
describe("logs (diary)", () => {
  it("creates entries; a second log of the same release auto-flags as relisten", async () => {
    const first = await request(app).post("/api/logs").set(auth(user1)).send({ releaseId });
    expect(first.status).toBe(201);
    expect(first.body.log.isRelisten).toBe(false);

    const second = await request(app).post("/api/logs").set(auth(user1)).send({ releaseId });
    expect(second.body.log.isRelisten).toBe(true);

    // Two independent rows — relistens are the point.
    expect(await prisma.log.count({ where: { userId: user1.id, releaseId } })).toBe(2);

    const diary = await request(app).get("/api/logs/me").set(auth(user1));
    expect(diary.body.logs).toHaveLength(2);
    expect(diary.body.logs[0].release.title).toContain("Test LP");
  });

  it("diary entries carry my rating for the release", async () => {
    // user1 rated this release 5 earlier (via the review's attached rating).
    const diary = await request(app).get("/api/logs/me").set(auth(user1));
    expect(diary.body.logs[0].myRating).toBe(5);
  });

  it("edits and deletes are owner-only", async () => {
    const diary = await request(app).get("/api/logs/me").set(auth(user1));
    const logId = diary.body.logs[0].id;

    const stranger = await request(app).delete(`/api/logs/${logId}`).set(auth(user2));
    expect(stranger.status).toBe(403);

    const patched = await request(app)
      .patch(`/api/logs/${logId}`)
      .set(auth(user1))
      .send({ listenedAt: "2026-07-01T12:00:00.000Z" });
    expect(patched.status).toBe(200);
    expect(patched.body.log.listenedAt).toBe("2026-07-01T12:00:00.000Z");

    const del = await request(app).delete(`/api/logs/${logId}`).set(auth(user1));
    expect(del.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
describe("ranked lists", () => {
  let listId: string;
  let secondReleaseId: string;

  it("creates a ranked list and appends items in position order", async () => {
    const second = await prisma.release.create({
      data: { title: `Test EP ${RUN}`, artistName: `Tester ${RUN}`, type: "EP", genres: [] },
    });
    secondReleaseId = second.id;

    const created = await request(app)
      .post("/api/lists")
      .set(auth(user1))
      .send({ title: `Best of ${RUN}`, isRanked: true, description: "The definitive order." });
    expect(created.status).toBe(201);
    listId = created.body.list.id;

    const a = await request(app).post(`/api/lists/${listId}/items`).set(auth(user1)).send({ releaseId });
    const b = await request(app)
      .post(`/api/lists/${listId}/items`)
      .set(auth(user1))
      .send({ releaseId: secondReleaseId, note: "criminally underrated" });
    expect(a.body.item.position).toBe(1);
    expect(b.body.item.position).toBe(2);
  });

  it("rejects duplicate items with a friendly 409", async () => {
    const dup = await request(app).post(`/api/lists/${listId}/items`).set(auth(user1)).send({ releaseId });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/already on this list/i);
  });

  it("reorders with a complete permutation; rejects partial orders (422)", async () => {
    const bad = await request(app)
      .put(`/api/lists/${listId}/items`)
      .set(auth(user1))
      .send({ order: [releaseId] });
    expect(bad.status).toBe(422);

    const good = await request(app)
      .put(`/api/lists/${listId}/items`)
      .set(auth(user1))
      .send({ order: [secondReleaseId, releaseId] });
    expect(good.status).toBe(204);

    const fetched = await request(app).get(`/api/lists/${listId}`);
    expect(fetched.body.list.items.map((i: { releaseId: string }) => i.releaseId)).toEqual([
      secondReleaseId,
      releaseId,
    ]);
    expect(fetched.body.list.items[0].note).toBe("criminally underrated");
  });

  it("edits an item's note (owner-only), and null clears it", async () => {
    const patched = await request(app)
      .patch(`/api/lists/${listId}/items/${secondReleaseId}`)
      .set(auth(user1))
      .send({ note: "still criminally underrated" });
    expect(patched.status).toBe(200);
    expect(patched.body.item.note).toBe("still criminally underrated");

    const stranger = await request(app)
      .patch(`/api/lists/${listId}/items/${secondReleaseId}`)
      .set(auth(user2))
      .send({ note: "graffiti" });
    expect(stranger.status).toBe(403);

    const cleared = await request(app)
      .patch(`/api/lists/${listId}/items/${secondReleaseId}`)
      .set(auth(user1))
      .send({ note: null });
    expect(cleared.body.item.note).toBeNull();

    const missing = await request(app)
      .patch(`/api/lists/${listId}/items/nonexistent-release`)
      .set(auth(user1))
      .send({ note: "x" });
    expect(missing.status).toBe(404);
  });

  it("removing an item closes the position gap", async () => {
    await request(app).delete(`/api/lists/${listId}/items/${secondReleaseId}`).set(auth(user1));
    const fetched = await request(app).get(`/api/lists/${listId}`);
    expect(fetched.body.list.items).toHaveLength(1);
    expect(fetched.body.list.items[0]).toMatchObject({ releaseId, position: 1 });
  });

  it("private lists are invisible to others; owner-only mutations (403)", async () => {
    await request(app).patch(`/api/lists/${listId}`).set(auth(user1)).send({ isPublic: false });

    const anon = await request(app).get(`/api/lists/${listId}`);
    expect(anon.status).toBe(404); // not 403 — don't reveal existence

    const stranger = await request(app)
      .post(`/api/lists/${listId}/items`)
      .set(auth(user2))
      .send({ releaseId: secondReleaseId });
    expect(stranger.status).toBe(403);

    const owner = await request(app).get(`/api/lists/${listId}`).set(auth(user1));
    expect(owner.status).toBe(200);

    // Cleanup within the suite: delete the list + spare release.
    await request(app).delete(`/api/lists/${listId}`).set(auth(user1));
    await deleteReleaseEverywhere(secondReleaseId);
  });
});

// ---------------------------------------------------------------------------
describe("release delete keeps Postgres and Elasticsearch in step", () => {
  it("deleteReleaseEverywhere removes the row, its user data, and the ES doc", async () => {
    const doomed = await prisma.release.create({
      data: { title: `Doomed ${RUN}`, artistName: `Tester ${RUN}`, type: "ALBUM", genres: [] },
    });
    await indexRelease(doomed);
    await request(app).put(`/api/ratings/${doomed.id}`).set(auth(user1)).send({ value: 2.5 });

    const deleted = await deleteReleaseEverywhere(doomed.id);
    expect(deleted).toBe(true);

    expect(await prisma.release.findUnique({ where: { id: doomed.id } })).toBeNull();
    expect(await prisma.rating.count({ where: { releaseId: doomed.id } })).toBe(0);
    const inEs = await es.exists({ index: RELEASE_INDEX, id: doomed.id });
    expect(inEs).toBe(false);

    // Idempotent second call.
    expect(await deleteReleaseEverywhere(doomed.id)).toBe(false);
  });
});
