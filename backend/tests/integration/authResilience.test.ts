// Regression (Phase 5): a failed search-index write must NEVER block auth.
// Phase 5 made new members searchable by indexing them into Elasticsearch during
// registration. If that index write were fatal, an Elasticsearch outage would
// take down registration — and any future auth-path index write could take down
// login too. Here we simulate a total ES write outage and assert register + login
// still succeed, and that the failure was actually exercised (the spy was hit).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { es } from "../../src/config/elasticsearch.js";
import { runTag } from "../support/runTag.js";

const app = createApp();
const RUN = runTag();
const DOMAIN = "p5authres.local";
const USERNAME = `esout_${RUN}`;
const EMAIL = `${USERNAME}@${DOMAIN}`;
const PASSWORD = "correct horse battery staple";

// Simulate Elasticsearch being unreachable for every write the auth path makes.
let indexSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  indexSpy = vi.spyOn(es, "index").mockRejectedValue(
    new Error("connect ECONNREFUSED 127.0.0.1:9200")
  );
});

afterAll(async () => {
  indexSpy.mockRestore();
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  await es.delete({ index: "users", id: "*" }).catch(() => {});
  await prisma.$disconnect();
  await redis.quit();
});

describe("auth survives an Elasticsearch outage", () => {
  it("registers a new member even when the member-index write fails", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ username: USERNAME, email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe(USERNAME);
    expect(res.body.accessToken).toBeTruthy();
    // The index write was attempted (and swallowed) — the outage was exercised.
    expect(indexSpy).toHaveBeenCalled();
    // The account is really persisted despite the failed index write.
    const row = await prisma.user.findUnique({ where: { email: EMAIL } });
    expect(row).not.toBeNull();
  });

  it("logs an existing account in while Elasticsearch is down", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(EMAIL);
    expect(res.body.accessToken).toBeTruthy();
  });
});
