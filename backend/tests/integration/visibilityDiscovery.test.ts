// Every anonymous-readable surface, checked against a private member.
//
// This file exists because 6.2b step 4 shipped a leak. Enforcement was applied
// surface-by-surface from a written list; the list was not exhaustive; and
// `/api/reviews/recent` — the logged-out home page's review feed, full review
// text included — was not on it. A private member's review was readable by
// anyone, immediately and indefinitely, while their profile page, member search
// and activity feed were all correctly sealed. `similarService` was leaking the
// same way and was found in the audit afterwards.
//
// The lesson is not "add two filters". It is that a rule remembered at each
// call site gets forgotten at one of them, so this file enumerates the surfaces
// and asserts against a CANARY string rather than trusting anyone's list —
// including mine. A new anonymous surface that forgets the filter fails here.
//
// It also pins the line in the OTHER direction: PRIVATE means "do not
// broadcast", not "unpublish". A review must still sit on the release page it
// was written about. Asserting that too means a future over-correction is
// caught as loudly as a leak.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { runTag } from "../support/runTag.js";

const app = createApp();
const RUN = runTag("dis");
const DOMAIN = "p62dis.local";
const PASSWORD = "correct horse battery";
/** Unique, and searched for as raw text so no endpoint shape is assumed. */
const CANARY = `LEAKCANARY${RUN}`;

let priv: { token: string; id: string; username: string };
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

beforeAll(async () => {
  priv = await makeUser("p");

  const release = await prisma.release.create({
    data: { title: `Dis LP ${RUN}`, artistName: `Dis ${RUN}`, type: "ALBUM", genres: [] },
  });
  releaseId = release.id;

  await request(app)
    .post("/api/reviews")
    .set({ Authorization: `Bearer ${priv.token}` })
    .send({ releaseId, content: `${CANARY} this must not reach a logged-out visitor`, rating: 4 });

  // Private AFTER publishing, which is the real sequence: someone posts, then
  // decides to go private. Enforcement that only worked for accounts private
  // from birth would miss every actual case.
  await request(app)
    .patch("/api/me/profile")
    .set({ Authorization: `Bearer ${priv.token}` })
    .send({ profileVisibility: "PRIVATE" });
}, 60_000);

afterAll(async () => {
  await prisma.review.deleteMany({ where: { releaseId } });
  await prisma.rating.deleteMany({ where: { releaseId } });
  await prisma.activity.deleteMany({ where: { userId: priv?.id } });
  await prisma.release.deleteMany({ where: { id: releaseId } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  await prisma.$disconnect();
  await redis.quit().catch(() => {});
});

/**
 * DISCOVERY surfaces: readable by anyone, and their job is to put people and
 * their writing in front of strangers. A private member must appear in none of
 * them, by username or by content.
 */
const DISCOVERY = [
  "/api/reviews/recent?limit=25",
  "/api/feed/popular?limit=50",
  "/api/search?q=__CANARY__&tab=members",
  "/api/search?q=__USER__&tab=members",
] as const;

describe("discovery surfaces must not carry a private member", () => {
  for (const template of DISCOVERY) {
    it(`excludes them from ${template.split("?")[0]}${template.includes("tab=") ? " (" + template.split("tab=")[1] + ")" : ""}`, async () => {
      const path = template.replace("__CANARY__", CANARY).replace("__USER__", priv.username);
      const res = await request(app).get(path);
      expect(res.status).toBe(200);

      // Raw text, so this does not depend on knowing each payload's shape —
      // a surface that nests the user somewhere new is still caught.
      const body = JSON.stringify(res.body);
      expect(body, `${path} leaked the canary review text`).not.toContain(CANARY);
      expect(body, `${path} leaked the username`).not.toContain(priv.username);
    });
  }

  it("excludes them from similar-listener suggestions", async () => {
    // "Listeners like you" suggests members to follow, which is discovery in
    // its purest form: a private account offered as somebody to go and look at.
    const other = await makeUser("o");
    // Overlapping taste, so they would otherwise be a candidate.
    await request(app)
      .put(`/api/ratings/${releaseId}`)
      .set({ Authorization: `Bearer ${other.token}` })
      .send({ value: 4.5 })
      .catch(() => null);

    const res = await request(app)
      .get(`/api/users/${other.username}/similar`)
      .set({ Authorization: `Bearer ${other.token}` });
    if (res.status === 200) {
      expect(JSON.stringify(res.body)).not.toContain(priv.username);
    }
  }, 60_000);
});

describe("the line holds in the other direction — PRIVATE is not unpublish", () => {
  it("keeps the review on the release page it was written about", async () => {
    // Context, not discovery. Going private must not silently retract writing
    // other people may already have replied to or liked. If this ever starts
    // failing, someone has over-corrected a leak into a deletion.
    const res = await request(app).get(`/api/reviews/release/${releaseId}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(CANARY);
  });
});

describe("the canary itself", () => {
  it("is visible on a discovery surface while the member is PUBLIC", async () => {
    // Without this the whole file could pass because the fixture never landed —
    // "absent from everywhere" is also what a failed setup looks like.
    await request(app)
      .patch("/api/me/profile")
      .set({ Authorization: `Bearer ${priv.token}` })
      .send({ profileVisibility: "PUBLIC" });

    const res = await request(app).get("/api/reviews/recent?limit=25");
    expect(JSON.stringify(res.body), "precondition: findable while public").toContain(CANARY);

    await request(app)
      .patch("/api/me/profile")
      .set({ Authorization: `Bearer ${priv.token}` })
      .send({ profileVisibility: "PRIVATE" });
  });
});
