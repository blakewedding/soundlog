// Account deletion — App Store Review 5.1.1(v), across every store.
//
// ## The anti-vacuity rule this file follows throughout
//
// Step 4 taught it and it applies with more force here: `indexUser` swallows
// Elasticsearch failures by design (§5), so EVERY "is it gone?" assertion
// against the index passes for the wrong reason when the index is empty, broken
// or never written. A test that only checks absence is green on a stack where
// nothing was ever indexed.
//
// So every disappearance assertion in this file is preceded, in the same test,
// by the assertion that the thing was THERE first. Proven the same way step 4
// proved its own: by stopping Elasticsearch and confirming the preconditions
// fail rather than the conclusions passing.
//
// ## What is deliberately covered that a happy path would miss
//
//  - an OAuth-only account (password: null) can delete itself. This is THE
//    5.1.1(v) failure mode: `reauthenticate` answers 409 for those accounts, so
//    a deletion built on step 3's re-auth would lock out every Spotify and
//    Google member — on a sign-in path no local test exercises.
//  - the ES `lists` document, which no cascade touches. Deleting a User removes
//    the List rows in Postgres and leaves the search documents behind.
//  - the access-token denylist, i.e. that a token minted before the deletion
//    stops working after it rather than lingering for its remaining lifetime.
//  - a FOLLOW activity in SOMEBODY ELSE's feed naming the deleted user.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { es, USER_INDEX, LIST_INDEX } from "../../src/config/elasticsearch.js";
import { runTag } from "../support/runTag.js";

const app = createApp();
const RUN = runTag("del");
const DOMAIN = "p62del.local";
const PASSWORD = "correct horse battery";

let releaseId: string;

async function makeUser(tag: string) {
  const username = `${RUN}${tag}`;
  if (username.length > 24) throw new Error(`fixture username too long: ${username}`);
  const res = await request(app)
    .post("/api/auth/register")
    .send({ username, email: `${username}@${DOMAIN}`, password: PASSWORD });
  if (res.status !== 201) throw new Error(`fixture registration failed: ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken as string, id: res.body.user.id as string, username };
}

async function userDoc(id: string) {
  await es.indices.refresh({ index: USER_INDEX }).catch(() => {});
  return es.get({ index: USER_INDEX, id }).catch(() => null);
}
async function listDoc(id: string) {
  await es.indices.refresh({ index: LIST_INDEX }).catch(() => {});
  return es.get({ index: LIST_INDEX, id }).catch(() => null);
}

beforeAll(async () => {
  const release = await prisma.release.create({
    data: { title: `Del LP ${RUN}`, artistName: `Del ${RUN}`, type: "ALBUM", genres: [] },
  });
  releaseId = release.id;
}, 60_000);

afterAll(async () => {
  await prisma.review.deleteMany({ where: { releaseId } });
  await prisma.rating.deleteMany({ where: { releaseId } });
  await prisma.log.deleteMany({ where: { releaseId } });
  await prisma.listItem.deleteMany({ where: { releaseId } });
  await prisma.release.delete({ where: { id: releaseId } }).catch(() => {});
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${DOMAIN}` } },
    select: { id: true },
  });
  // §10: an explicit list of ids read back first, never a bare pattern delete.
  for (const u of users) {
    await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
    await es.delete({ index: USER_INDEX, id: u.id }).catch(() => {});
  }
  await redis.quit().catch(() => {});
});

describe("account deletion removes the member from every store", () => {
  it("clears Postgres, both Elasticsearch indices, and the follow graph", async () => {
    const a = await makeUser("a1");
    const b = await makeUser("b1");
    const auth = { Authorization: `Bearer ${a.token}` };
    const bAuth = { Authorization: `Bearer ${b.token}` };

    // A writes across every user-owned table.
    await request(app).post("/api/reviews").set(auth).send({ releaseId, content: `del ${RUN}`, rating: 4 });
    await request(app).put(`/api/ratings/${releaseId}`).set(auth).send({ rating: 4 });
    await request(app).post("/api/logs").set(auth).send({ releaseId });
    const list = await request(app)
      .post("/api/lists")
      .set(auth)
      .send({ title: `Del list ${RUN}`, isPublic: true });
    const listId = list.body.list.id as string;

    // Follows in BOTH directions — the two Follow relations are separate
    // cascades and a delete that clears one is not a delete.
    await request(app).post(`/api/users/${b.username}/follow`).set(auth).send();
    await request(app).post(`/api/users/${a.username}/follow`).set(bAuth).send();

    // ---- presence FIRST, or every assertion below is vacuous -------------
    expect(await prisma.review.count({ where: { userId: a.id } })).toBe(1);
    expect(await prisma.rating.count({ where: { userId: a.id } })).toBe(1);
    expect(await prisma.log.count({ where: { userId: a.id } })).toBe(1);
    expect(await prisma.list.count({ where: { userId: a.id } })).toBe(1);
    expect(await prisma.follow.count({ where: { followerId: a.id } })).toBe(1);
    expect(await prisma.follow.count({ where: { followingId: a.id } })).toBe(1);
    expect(await userDoc(a.id)).not.toBeNull();
    expect(await listDoc(listId)).not.toBeNull();
    // B's feed carries a FOLLOW activity naming A as its target. No cascade
    // covers this: Activity is owned by the ACTOR, so B's row outlives A.
    expect(await prisma.activity.count({ where: { type: "FOLLOW", targetId: a.id } })).toBe(1);

    const res = await request(app)
      .delete("/api/me")
      .set(auth)
      .send({ confirmUsername: a.username, currentPassword: PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.deleted).toBe(true);
    // This account uploaded no picture, so there was nothing at the edge to
    // clear. Distinct from `skipped-unconfigured`, which means the credential is
    // absent — caught on the production pass, where a correctly-configured box
    // reported "unconfigured" and would have sent an operator hunting a token
    // that was present and working.
    expect(res.body.purge).toBe("skipped-no-avatar");

    // ---- and now absence --------------------------------------------------
    expect(await prisma.user.findUnique({ where: { id: a.id } })).toBeNull();
    expect(await prisma.review.count({ where: { userId: a.id } })).toBe(0);
    expect(await prisma.rating.count({ where: { userId: a.id } })).toBe(0);
    expect(await prisma.log.count({ where: { userId: a.id } })).toBe(0);
    expect(await prisma.list.count({ where: { userId: a.id } })).toBe(0);
    expect(await prisma.follow.count({ where: { followerId: a.id } })).toBe(0);
    expect(await prisma.follow.count({ where: { followingId: a.id } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId: a.id } })).toBe(0);
    expect(await prisma.activity.count({ where: { userId: a.id } })).toBe(0);
    expect(await prisma.activity.count({ where: { type: "FOLLOW", targetId: a.id } })).toBe(0);

    // Absent from the index, not filtered out of it (§5).
    expect(await userDoc(a.id)).toBeNull();
    expect(await listDoc(listId)).toBeNull();
  });

  it("stops the deleted account's still-valid access token from working", async () => {
    const a = await makeUser("a2");
    const auth = { Authorization: `Bearer ${a.token}` };

    // The token works before — otherwise "it 401s afterwards" proves nothing,
    // since a malformed token 401s too.
    expect((await request(app).get("/api/me/profile").set(auth)).status).toBe(200);

    await request(app)
      .delete("/api/me")
      .set(auth)
      .send({ confirmUsername: a.username, currentPassword: PASSWORD })
      .expect(200);

    // Same token, unexpired and still cryptographically valid. Without the
    // denylist this is a 200 for up to JWT_ACCESS_TTL after the account is gone.
    expect((await request(app).get("/api/me/profile").set(auth)).status).toBe(401);
  });

  it("lets an OAuth-only account delete itself — the 5.1.1(v) path", async () => {
    const a = await makeUser("a3");
    // Become OAuth-only. `reauthenticate` answers 409 for these, so a deletion
    // built on step 3's password re-auth would make this account undeletable —
    // which is exactly what App Store review checks, on the sign-in path no
    // local test otherwise walks.
    await prisma.user.update({ where: { id: a.id }, data: { password: null } });

    const res = await request(app)
      .delete("/api/me")
      .set({ Authorization: `Bearer ${a.token}` })
      .send({ confirmUsername: a.username });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: a.id } })).toBeNull();
  });

  it("refuses, and changes nothing, when the confirmation is wrong", async () => {
    const a = await makeUser("a4");
    const auth = { Authorization: `Bearer ${a.token}` };

    const wrongName = await request(app)
      .delete("/api/me")
      .set(auth)
      .send({ confirmUsername: `${a.username}x`, currentPassword: PASSWORD });
    expect(wrongName.status).toBe(400);

    const wrongPassword = await request(app)
      .delete("/api/me")
      .set(auth)
      .send({ confirmUsername: a.username, currentPassword: "not the password" });
    expect(wrongPassword.status).toBe(401);

    const noPassword = await request(app)
      .delete("/api/me")
      .set(auth)
      .send({ confirmUsername: a.username });
    expect(noPassword.status).toBe(400);

    // The account survived all three, and the session still works — a refused
    // confirmation must not half-delete anything.
    expect(await prisma.user.findUnique({ where: { id: a.id } })).not.toBeNull();
    expect((await request(app).get("/api/me/profile").set(auth)).status).toBe(200);
  });

  it("answers 503 + Retry-After, not 500, when a store it must clean is unreachable", async () => {
    // Found by the vacuity drill rather than by the happy path: with
    // Elasticsearch stopped, deletion answered `500 Internal server error`.
    // Blocking is CORRECT here — a surviving user document is the harm, so this
    // is the one caller for which §5's swallow is wrong — but the shape was
    // §1's mistake in the 413 incident's costume: a definite, retryable,
    // caller-actionable condition dressed as an opaque server fault.
    //
    // Simulated by pointing the strict de-index at an unreachable node rather
    // than by stopping the container, so this runs in CI. The real outage was
    // reproduced by hand with `docker compose stop elasticsearch`.
    const a = await makeUser("a6");
    const auth = { Authorization: `Bearer ${a.token}` };

    const search = await import("../../src/services/searchService.js");
    const spy = vi
      .spyOn(search, "deindexUserStrict")
      .mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:9200"));

    try {
      const res = await request(app)
        .delete("/api/me")
        .set(auth)
        .send({ confirmUsername: a.username, currentPassword: PASSWORD });

      expect(res.status).toBe(503);
      expect(res.headers["retry-after"]).toBeDefined();
      expect(res.body.error).not.toMatch(/internal server error/i);
      // And the account is untouched, so "please try again" is true rather than
      // a phrase offered over a half-finished delete.
      expect(await prisma.user.findUnique({ where: { id: a.id } })).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("is idempotent against an already-deleted account rather than 500ing", async () => {
    const a = await makeUser("a5");
    const auth = { Authorization: `Bearer ${a.token}` };
    await request(app)
      .delete("/api/me")
      .set(auth)
      .send({ confirmUsername: a.username, currentPassword: PASSWORD })
      .expect(200);

    // The denylist answers first, so this is the 401 of a dead session rather
    // than a crash inside a delete that finds no row.
    const again = await request(app)
      .delete("/api/me")
      .set(auth)
      .send({ confirmUsername: a.username, currentPassword: PASSWORD });
    expect(again.status).toBe(401);
  });
});
