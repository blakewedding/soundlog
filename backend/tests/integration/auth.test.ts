import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Response } from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { createAuthCode } from "../../src/services/oauthCodeService.js";
import { isAllowedMobileRedirect, appendQueryParam } from "../../src/routes/auth.js";
import { runTag } from "../support/runTag.js";

const app = createApp();

// All test accounts live under this domain so cleanup is a single deleteMany.
const TEST_DOMAIN = "authtest.local";
const RUN = runTag();
let seq = 0;
function freshCreds() {
  seq += 1;
  const tag = `${RUN}${seq}`;
  return { username: `user_${tag}`, email: `user_${tag}@${TEST_DOMAIN}`, password: "correct horse battery" };
}

/** Pull the refresh_token cookie value out of a Set-Cookie header. */
function refreshCookie(res: Response): string | undefined {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  const line = raw?.find((c) => c.startsWith("refresh_token="));
  return line?.split(";")[0];
}

async function registerFresh() {
  const creds = freshCreds();
  const res = await request(app).post("/api/auth/register").send(creds);
  return { creds, res };
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_DOMAIN}` } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_DOMAIN}` } } });
  await prisma.$disconnect();
  await redis.quit();
});

/** Create a real user and return its id — used to mint OAuth codes directly. */
async function createUserId(): Promise<string> {
  const { res } = await registerFresh();
  return res.body.user.id as string;
}

describe("POST /api/auth/register", () => {
  it("creates a user, returns an access token, and sets an httpOnly refresh cookie", async () => {
    const { res } = await registerFresh();
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ username: expect.any(String), email: expect.any(String) });
    expect(res.body.user).not.toHaveProperty("password");

    const cookieLine = (res.headers["set-cookie"] as unknown as string[]).find((c) =>
      c.startsWith("refresh_token="),
    );
    expect(cookieLine).toBeDefined();
    expect(cookieLine).toMatch(/HttpOnly/i);
  });

  it("rejects a malformed body with 422", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ username: "ok_name", email: "not-an-email", password: "short" });
    expect(res.status).toBe(422);
  });

  it("rejects a duplicate email with 409", async () => {
    const { creds } = await registerFresh();
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...creds, username: `${creds.username}_2`.slice(0, 24) });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/email/i);
  });

  it("rejects a duplicate username with 409", async () => {
    const { creds } = await registerFresh();
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...creds, email: `dup_${creds.username}@${TEST_DOMAIN}` });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/username/i);
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with valid credentials", async () => {
    const { creds } = await registerFresh();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: creds.email, password: creds.password });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(refreshCookie(res)).toBeDefined();
  });

  it("rejects a wrong password with 401", async () => {
    const { creds } = await registerFresh();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: creds.email, password: "wrong wrong wrong" });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown email with 401", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `ghost_${RUN}@${TEST_DOMAIN}`, password: "whatever whatever" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/refresh", () => {
  it("rotates the refresh cookie and returns a new access token", async () => {
    const { res: reg } = await registerFresh();
    const cookie1 = refreshCookie(reg)!;

    const res = await request(app).post("/api/auth/refresh").set("Cookie", cookie1);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));

    const cookie2 = refreshCookie(res);
    expect(cookie2).toBeDefined();
    expect(cookie2).not.toEqual(cookie1); // rotated to a new value
  });

  it("rejects a request with no refresh cookie (401)", async () => {
    const res = await request(app).post("/api/auth/refresh");
    expect(res.status).toBe(401);
  });

  it("rejects a reused (already-rotated) refresh cookie with 401", async () => {
    const { res: reg } = await registerFresh();
    const cookie1 = refreshCookie(reg)!;

    const first = await request(app).post("/api/auth/refresh").set("Cookie", cookie1);
    expect(first.status).toBe(200);

    // Presenting the now-revoked cookie1 again must fail.
    const replay = await request(app).post("/api/auth/refresh").set("Cookie", cookie1);
    expect(replay.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("revokes the refresh token and clears the cookie", async () => {
    const { res: reg } = await registerFresh();
    const cookie = refreshCookie(reg)!;

    const out = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(out.status).toBe(204);

    // The revoked token can no longer be refreshed.
    const after = await request(app).post("/api/auth/refresh").set("Cookie", cookie);
    expect(after.status).toBe(401);
  });
});

describe("GET /api/auth/me", () => {
  it("returns the current user for a valid access token", async () => {
    const { creds, res: reg } = await registerFresh();
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${reg.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(creds.email);
    expect(res.body.user).not.toHaveProperty("password");
  });

  it("rejects a request with no token (401)", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects a garbage token (401)", async () => {
    const res = await request(app).get("/api/auth/me").set("Authorization", "Bearer not.a.jwt");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/exchange (web)", () => {
  it("redeems a web code for an access token + httpOnly refresh cookie (no token in body)", async () => {
    const userId = await createUserId();
    const code = await createAuthCode({ userId, client: "web" });

    const res = await request(app).post("/api/auth/exchange").send({ code });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body).not.toHaveProperty("refreshToken"); // web keeps it in the cookie
    expect(res.body.user.id).toBe(userId);

    const cookie = refreshCookie(res);
    expect(cookie).toBeDefined();

    // The access token authenticates, and the cookie refreshes.
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    const refreshed = await request(app).post("/api/auth/refresh").set("Cookie", cookie!);
    expect(refreshed.status).toBe(200);
  });

  it("is single-use — a second exchange of the same code fails with 400", async () => {
    const userId = await createUserId();
    const code = await createAuthCode({ userId, client: "web" });

    const first = await request(app).post("/api/auth/exchange").send({ code });
    expect(first.status).toBe(200);
    const second = await request(app).post("/api/auth/exchange").send({ code });
    expect(second.status).toBe(400);
  });

  it("rejects an unknown code with 400", async () => {
    const res = await request(app).post("/api/auth/exchange").send({ code: "totally-made-up-code" });
    expect(res.status).toBe(400);
  });

  it("rejects an expired code with 400", async () => {
    const userId = await createUserId();
    const code = await createAuthCode({ userId, client: "web" }, 1); // 1s TTL
    await new Promise((r) => setTimeout(r, 1200));
    const res = await request(app).post("/api/auth/exchange").send({ code });
    expect(res.status).toBe(400);
  });

  it("rejects a missing code with 422", async () => {
    const res = await request(app).post("/api/auth/exchange").send({});
    expect(res.status).toBe(422);
  });
});

describe("POST /api/auth/exchange (mobile)", () => {
  it("redeems a mobile code for tokens in the body with no cookie", async () => {
    const userId = await createUserId();
    const code = await createAuthCode({ userId, client: "mobile" });

    const res = await request(app).post("/api/auth/exchange").send({ code });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String)); // mobile gets it in the body
    expect(res.headers["set-cookie"]).toBeUndefined(); // ...and no cookie
  });

  it("refreshes and logs out using the body-delivered refresh token (rotating)", async () => {
    const userId = await createUserId();
    const code = await createAuthCode({ userId, client: "mobile" });
    const exchanged = await request(app).post("/api/auth/exchange").send({ code });
    const refreshToken = exchanged.body.refreshToken as string;

    // Refresh via body → new access + rotated refresh token, no cookie.
    const refreshed = await request(app).post("/api/auth/refresh").send({ refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toEqual(expect.any(String));
    expect(refreshed.body.refreshToken).toEqual(expect.any(String));
    expect(refreshed.body.refreshToken).not.toBe(refreshToken);
    expect(refreshed.headers["set-cookie"]).toBeUndefined();

    // The rotated (old) token can no longer be used.
    const replay = await request(app).post("/api/auth/refresh").send({ refreshToken });
    expect(replay.status).toBe(401);

    // Logout via body revokes the current token.
    const rotated = refreshed.body.refreshToken as string;
    const out = await request(app).post("/api/auth/logout").send({ refreshToken: rotated });
    expect(out.status).toBe(204);
    const afterLogout = await request(app).post("/api/auth/refresh").send({ refreshToken: rotated });
    expect(afterLogout.status).toBe(401);
  });
});

describe("mobile redirect validation", () => {
  it("accepts the app's custom scheme and the Expo auth proxy", () => {
    expect(isAllowedMobileRedirect("soundlog://auth")).toBe(true);
    expect(isAllowedMobileRedirect("soundlog://auth/callback")).toBe(true);
    expect(isAllowedMobileRedirect("https://auth.expo.io/@soundlog/app")).toBe(true);
  });

  it("rejects arbitrary http(s) hosts and junk", () => {
    expect(isAllowedMobileRedirect("https://evil.example.com/steal")).toBe(false);
    expect(isAllowedMobileRedirect("http://localhost:3000/auth")).toBe(false);
    expect(isAllowedMobileRedirect("")).toBe(false);
    expect(isAllowedMobileRedirect("not a url")).toBe(false);
  });

  it("appends the code param respecting an existing query string", () => {
    expect(appendQueryParam("soundlog://auth", "code", "abc")).toBe("soundlog://auth?code=abc");
    expect(appendQueryParam("https://app/cb?x=1", "code", "a b")).toBe("https://app/cb?x=1&code=a%20b");
  });
});

describe("OAuth routes", () => {
  // No Spotify/Google credentials are configured in the test env, so these
  // report 503 rather than attempting a provider handshake.
  it("returns 503 for the Spotify start route when unconfigured", async () => {
    const res = await request(app).get("/api/auth/spotify");
    expect(res.status).toBe(503);
  });

  it("returns 503 for the Spotify callback route when unconfigured", async () => {
    const res = await request(app).get("/api/auth/spotify/callback");
    expect(res.status).toBe(503);
  });

  it("returns 503 for the Google start route when unconfigured", async () => {
    const res = await request(app).get("/api/auth/google");
    expect(res.status).toBe(503);
  });

  it("returns 503 for the Google callback route when unconfigured", async () => {
    const res = await request(app).get("/api/auth/google/callback");
    expect(res.status).toBe(503);
  });
});
