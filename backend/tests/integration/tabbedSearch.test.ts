// Phase 5: tabbed search across members, lists, and labels — all Elasticsearch
// backed. Registering a user indexes them as a member; creating/editing a public
// list indexes it; making a list private de-indexes it.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { es } from "../../src/config/elasticsearch.js";

const app = createApp();
const RUN = Date.now().toString(36);
const DOMAIN = "p5search.local";
// Distinctive, single-token terms so text matches are unambiguous.
const MEMBER_TAG = `zorbtron${RUN}`;
const LIST_TITLE = `Quaffle${RUN} Selects`;

let user: { token: string; id: string; username: string };
let listId: string;

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function refresh() {
  await es.indices.refresh({ index: "users,lists,labels" }).catch(() => {});
}

beforeAll(async () => {
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ username: MEMBER_TAG, email: `${MEMBER_TAG}@${DOMAIN}`, password: "correct horse battery" });
  user = { token: reg.body.accessToken, id: reg.body.user.id, username: MEMBER_TAG };

  const list = await request(app)
    .post("/api/lists")
    .set(auth(user.token))
    .send({ title: LIST_TITLE, isPublic: true });
  listId = list.body.list.id;
  await refresh();
});

afterAll(async () => {
  await prisma.list.deleteMany({ where: { userId: user.id } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  await es.delete({ index: "users", id: user.id }).catch(() => {});
  await es.delete({ index: "lists", id: listId }).catch(() => {});
  await prisma.$disconnect();
  await redis.quit();
});

describe("GET /api/search — tabbed", () => {
  it("indexes a new member on register and finds them on the members tab", async () => {
    const res = await request(app).get(`/api/search?q=${MEMBER_TAG}&tab=members`);
    expect(res.status).toBe(200);
    expect(res.body.tab).toBe("members");
    const hit = (res.body.members as Array<{ id: string; username: string }>).find(
      (m) => m.id === user.id
    );
    expect(hit, "registered user should be searchable").toBeDefined();
    expect(hit!.username).toBe(MEMBER_TAG);
  });

  it("indexes a public list on create and finds it on the lists tab", async () => {
    const res = await request(app).get(`/api/search?q=Quaffle${RUN}&tab=lists`);
    expect(res.status).toBe(200);
    const hit = (res.body.lists as Array<{ id: string; title: string; username: string }>).find(
      (l) => l.id === listId
    );
    expect(hit, "public list should be searchable").toBeDefined();
    expect(hit!.username).toBe(MEMBER_TAG);
  });

  it("de-indexes a list when it goes private", async () => {
    await request(app).patch(`/api/lists/${listId}`).set(auth(user.token)).send({ isPublic: false });
    await refresh();
    const res = await request(app).get(`/api/search?q=Quaffle${RUN}&tab=lists`);
    const hit = (res.body.lists as Array<{ id: string }>).find((l) => l.id === listId);
    expect(hit, "private list must not appear in search").toBeUndefined();
  });

  it("the 'all' tab returns every bucket key", async () => {
    const res = await request(app).get(`/api/search?q=${MEMBER_TAG}&tab=all`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("results");
    expect(res.body).toHaveProperty("artists");
    expect(res.body).toHaveProperty("members");
    expect(res.body).toHaveProperty("lists");
    expect(res.body).toHaveProperty("labels");
    // The member still surfaces in the unified view.
    expect((res.body.members as Array<{ id: string }>).some((m) => m.id === user.id)).toBe(true);
  });
});
