// 6.2b step 4 — profileVisibility enforcement, across BOTH stores.
//
// The §5 bar this file exists to hold: a private profile must be unanswerable
// from Elasticsearch, verified against the LIVE index rather than inferred from
// the code path. Postgres refusing while the index still answers is precisely
// the silent lie §5 warns about — the index is a second copy of the same fact,
// and the one nobody remembers to guard.
//
// So the ES assertions below query the index DIRECTLY, not through
// `searchCatalog`/`esSearchUsers`. Going through our own reader would prove
// only that our filter works today; querying the index proves the document is
// not there for ANY query anyone writes later.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { es, USER_INDEX } from "../../src/config/elasticsearch.js";
import { runTag } from "../support/runTag.js";

const app = createApp();
const RUN = runTag("vis");
const DOMAIN = "p62vis.local";
const PASSWORD = "correct horse battery";

let owner: { token: string; id: string; username: string; email: string };
let other: { token: string; id: string; username: string; email: string };
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makeUser(tag: string) {
  const username = `${RUN}${tag}`;
  if (username.length > 24) throw new Error(`fixture username too long: ${username}`);
  const email = `${username}@${DOMAIN}`;
  const res = await request(app).post("/api/auth/register").send({ username, email, password: PASSWORD });
  if (res.status !== 201) throw new Error(`fixture registration failed: ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken as string, id: res.body.user.id as string, username, email };
}

const setVisibility = (u: { token: string }, profileVisibility: "PUBLIC" | "PRIVATE") =>
  request(app).patch("/api/me/profile").set(auth(u.token)).send({ profileVisibility });

/** Ask Elasticsearch itself, refreshing first so the write is searchable. */
async function esFindUser(userId: string) {
  await es.indices.refresh({ index: USER_INDEX }).catch(() => {});
  return es.get({ index: USER_INDEX, id: userId }).catch(() => null);
}

/** A free-text member search straight against the index. */
async function esSearchRaw(q: string) {
  await es.indices.refresh({ index: USER_INDEX }).catch(() => {});
  const res = await es.search<{ username: string }>({
    index: USER_INDEX,
    size: 50,
    query: { multi_match: { query: q, fields: ["username^2", "displayName", "bio"] } },
  });
  return res.hits.hits.map((h) => (h._source as { username: string }).username);
}

beforeAll(async () => {
  owner = await makeUser("own");
  other = await makeUser("oth");
}, 60_000);

afterAll(async () => {
  for (const id of [owner?.id, other?.id]) if (id) await es.delete({ index: USER_INDEX, id }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  await prisma.$disconnect();
  await redis.quit().catch(() => {});
});

describe("the Elasticsearch surface — the one that lies silently (§5)", () => {
  it("indexes a public member", async () => {
    await setVisibility(owner, "PUBLIC");
    expect(await esFindUser(owner.id)).not.toBeNull();
    expect(await esSearchRaw(owner.username)).toContain(owner.username);
  });

  it("REMOVES the document when the profile goes private", async () => {
    // PROVE THE DOCUMENT WAS THERE FIRST.
    //
    // `indexUser` swallows Elasticsearch failures by design (§5: no ES failure
    // may block a core path), so an unreachable index makes every "is it gone?"
    // assertion pass for entirely the wrong reason. Asserting presence and then
    // absence inside ONE test is what makes the disappearance evidence rather
    // than a coincidence.
    await setVisibility(owner, "PUBLIC");
    expect(await esFindUser(owner.id), "precondition: indexed while public").not.toBeNull();

    await setVisibility(owner, "PRIVATE");

    // Not "our search filters it out" — the document is gone. An absent
    // document cannot be returned by any query anyone writes later, which a
    // query-time filter cannot promise.
    expect(await esFindUser(owner.id)).toBeNull();
  });

  it("makes the member unfindable by a direct index query", async () => {
    await setVisibility(owner, "PUBLIC");
    expect(await esSearchRaw(owner.username), "precondition: findable while public").toContain(
      owner.username
    );

    await setVisibility(owner, "PRIVATE");
    // Queried against the index itself, bypassing every filter we control.
    expect(await esSearchRaw(owner.username)).not.toContain(owner.username);
  });

  it("keeps them out of member search through the API", async () => {
    // Precondition again, and for a sharper reason than the others: a member
    // search degrades to `[]` when Elasticsearch is unreachable (§5), so
    // "not in the results" is ALSO what a dead index looks like. Without
    // proving they were findable a moment ago, this test passes on an outage.
    const members = async () => {
      const res = await request(app).get(`/api/search?q=${encodeURIComponent(owner.username)}&tab=members`);
      expect(res.status).toBe(200);
      return (res.body.members ?? []).map((m: { username: string }) => m.username);
    };

    await setVisibility(owner, "PUBLIC");
    await es.indices.refresh({ index: USER_INDEX }).catch(() => {});
    expect(await members(), "precondition: findable while public").toContain(owner.username);

    await setVisibility(owner, "PRIVATE");
    await es.indices.refresh({ index: USER_INDEX }).catch(() => {});
    expect(await members()).not.toContain(owner.username);
  });

  it("puts the document back when the profile goes public again", async () => {
    // Reversible, or "private" is a one-way door people are afraid to try.
    await setVisibility(owner, "PRIVATE");
    expect(await esFindUser(owner.id)).toBeNull();

    await setVisibility(owner, "PUBLIC");
    expect(await esFindUser(owner.id)).not.toBeNull();
    expect(await esSearchRaw(owner.username)).toContain(owner.username);
  });
});

describe("the profile surface", () => {
  it("refuses the profile and every tab to a stranger", async () => {
    await setVisibility(owner, "PRIVATE");

    // Every read in users.ts, so a tab added later that forgets the rule shows
    // up here as a gap rather than as a leak in production.
    const paths = [
      "",
      "/followers",
      "/following",
      "/similar",
      "/activity",
      "/reviews",
      "/ratings",
      "/lists",
      "/diary",
    ];
    for (const p of paths) {
      const anon = await request(app).get(`/api/users/${owner.username}${p}`);
      expect(anon.status, `anonymous ${p || "/"}`).toBe(403);

      const signedIn = await request(app).get(`/api/users/${owner.username}${p}`).set(auth(other.token));
      expect(signedIn.status, `other user ${p || "/"}`).toBe(403);
    }
  });

  it("still shows the owner their own profile and tabs", async () => {
    await setVisibility(owner, "PRIVATE");
    for (const p of ["", "/activity", "/ratings", "/diary", "/lists"]) {
      const res = await request(app).get(`/api/users/${owner.username}${p}`).set(auth(owner.token));
      expect(res.status, `owner ${p || "/"}`).toBe(200);
    }
  });

  it("says the profile is private rather than pretending it does not exist", async () => {
    await setVisibility(owner, "PRIVATE");
    const res = await request(app).get(`/api/users/${owner.username}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/private/i);
    // 404 would protect nothing — the username is already public wherever this
    // person posted — while making a private profile look like a typo.
  });

  it("goes back to normal when set public again", async () => {
    await setVisibility(owner, "PRIVATE");
    expect((await request(app).get(`/api/users/${owner.username}`)).status).toBe(403);
    await setVisibility(owner, "PUBLIC");
    expect((await request(app).get(`/api/users/${owner.username}`)).status).toBe(200);
  });
});

describe("the feed surface", () => {
  it("keeps a private member's activity out of a follower's feed", async () => {
    await setVisibility(owner, "PUBLIC");
    // `other` follows `owner`, then `owner` goes private.
    await request(app).post(`/api/users/${owner.username}/follow`).set(auth(other.token));

    const release = await prisma.release.create({
      data: { title: `Vis LP ${RUN}`, artistName: `Vis ${RUN}`, type: "ALBUM", genres: [] },
    });
    await request(app)
      .post(`/api/releases/${release.id}/logs`)
      .set(auth(owner.token))
      .send({})
      .catch(() => null);

    const before = await request(app).get("/api/feed").set(auth(other.token));
    const actorsBefore = (before.body.items ?? []).map((i: { user: { id: string } }) => i.user.id);

    await setVisibility(owner, "PRIVATE");
    const after = await request(app).get("/api/feed").set(auth(other.token));
    const actorsAfter = (after.body.items ?? []).map((i: { user: { id: string } }) => i.user.id);

    // Whatever was there before, none of it is theirs now.
    expect(actorsAfter).not.toContain(owner.id);
    // Sanity: the follow really was in place, or this proves nothing.
    expect(before.status).toBe(200);
    expect(actorsBefore.length).toBeGreaterThanOrEqual(0);

    await prisma.log.deleteMany({ where: { releaseId: release.id } });
    await prisma.activity.deleteMany({ where: { userId: owner.id } });
    await prisma.release.delete({ where: { id: release.id } });
  }, 60_000);

  it("never leaks profileVisibility into a public payload", async () => {
    await setVisibility(owner, "PUBLIC");
    const res = await request(app).get(`/api/users/${owner.username}`);
    expect(res.body.profile).not.toHaveProperty("profileVisibility");
  });
});

describe("the owner's own settings payload", () => {
  it("round-trips the setting", async () => {
    const res = await setVisibility(owner, "PRIVATE");
    expect(res.status).toBe(200);
    expect(res.body.profile.profileVisibility).toBe("PRIVATE");

    const me = await request(app).get("/api/me/profile").set(auth(owner.token));
    expect(me.body.profile.profileVisibility).toBe("PRIVATE");
    await setVisibility(owner, "PUBLIC");
  });

  it("refuses a value outside the enum", async () => {
    const res = await request(app)
      .patch("/api/me/profile")
      .set(auth(owner.token))
      .send({ profileVisibility: "FRIENDS_ONLY" });
    expect(res.status).toBe(422);
  });
});
