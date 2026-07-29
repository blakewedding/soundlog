// Phase 6b — email verification and password reset.
//
// The raw token deliberately exists nowhere the API will hand back (only the
// hash is stored, and the plaintext leaves the process inside an email), so
// tests that need a redeemable token mint one through the service directly.
// That is the same path registration uses; what it skips is the mail transport,
// which has its own unit tests.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { issueVerificationToken } from "../../src/services/verificationService.js";
import { runTag } from "../support/runTag.js";

const app = createApp();

const TEST_DOMAIN = "verifytest.local";
const RUN = runTag();
let seq = 0;
function freshCreds() {
  seq += 1;
  const tag = `${RUN}${seq}`;
  return {
    username: `vuser_${tag}`,
    email: `vuser_${tag}@${TEST_DOMAIN}`,
    password: "correct horse battery",
  };
}

async function registerFresh() {
  const creds = freshCreds();
  const res = await request(app).post("/api/auth/register").send(creds);
  return { creds, res, userId: res.body.user.id as string };
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_DOMAIN}` } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_DOMAIN}` } } });
  await prisma.$disconnect();
  await redis.quit();
});

describe("registration and verification state", () => {
  it("creates the account UNVERIFIED and says so in the user payload", async () => {
    const { res } = await registerFresh();
    expect(res.status).toBe(201);
    expect(res.body.user.emailVerified).toBe(false);
  });

  it("issues exactly one verification token on registration", async () => {
    const { userId } = await registerFresh();
    const tokens = await prisma.verificationToken.findMany({
      where: { userId, purpose: "EMAIL_VERIFICATION" },
    });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].consumedAt).toBeNull();
  });

  it("never stores the token in plaintext — only a 64-char sha256 hash", async () => {
    const { userId } = await registerFresh();
    const raw = await issueVerificationToken(userId, "EMAIL_VERIFICATION");
    const row = await prisma.verificationToken.findFirst({
      where: { userId, consumedAt: null },
    });
    expect(row!.tokenHash).not.toBe(raw);
    expect(row!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("registration still succeeds when mail is unconfigured", async () => {
    // RESEND_API_KEY is unset in the test environment, so the send is a logged
    // no-op. That is the whole point of the fault isolation: an account is
    // created even when nothing can be delivered.
    const { res } = await registerFresh();
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
  });
});

describe("POST /api/auth/verify-email", () => {
  it("verifies the address with a valid token", async () => {
    const { userId } = await registerFresh();
    const token = await issueVerificationToken(userId, "EMAIL_VERIFICATION");

    const res = await request(app).post("/api/auth/verify-email").send({ token });
    expect(res.status).toBe(200);
    expect(res.body.user.emailVerified).toBe(true);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user!.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("rejects the SAME token a second time — single use", async () => {
    const { userId } = await registerFresh();
    const token = await issueVerificationToken(userId, "EMAIL_VERIFICATION");

    expect((await request(app).post("/api/auth/verify-email").send({ token })).status).toBe(200);

    const second = await request(app).post("/api/auth/verify-email").send({ token });
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/invalid or has expired/i);
  });

  it("rejects an EXPIRED token", async () => {
    const { userId } = await registerFresh();
    const token = await issueVerificationToken(userId, "EMAIL_VERIFICATION");
    // Reach past the 24h TTL by moving the row's expiry into the past.
    await prisma.verificationToken.updateMany({
      where: { userId, consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app).post("/api/auth/verify-email").send({ token });
    expect(res.status).toBe(400);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user!.emailVerifiedAt).toBeNull();
  });

  it("refuses a PASSWORD_RESET token — purposes are not interchangeable", async () => {
    const { userId } = await registerFresh();
    const resetToken = await issueVerificationToken(userId, "PASSWORD_RESET");

    const res = await request(app).post("/api/auth/verify-email").send({ token: resetToken });
    expect(res.status).toBe(400);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user!.emailVerifiedAt).toBeNull();
  });

  it("rejects an unknown token", async () => {
    const res = await request(app).post("/api/auth/verify-email").send({ token: "not-a-real-token" });
    expect(res.status).toBe(400);
  });

  it("invalidates a previously issued token when a new one is requested", async () => {
    const { userId } = await registerFresh();
    const first = await issueVerificationToken(userId, "EMAIL_VERIFICATION");
    const second = await issueVerificationToken(userId, "EMAIL_VERIFICATION");

    // The older link must be dead the moment a newer one is sent, or an
    // intercepted earlier email stays usable for its full remaining TTL.
    expect((await request(app).post("/api/auth/verify-email").send({ token: first })).status).toBe(400);
    expect((await request(app).post("/api/auth/verify-email").send({ token: second })).status).toBe(200);
  });
});

describe("unverified accounts are not blocked (Phase 6b launch policy)", () => {
  it("lets an unverified user log in", async () => {
    const { creds } = await registerFresh();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: creds.email, password: creds.password });

    expect(res.status).toBe(200);
    expect(res.body.user.emailVerified).toBe(false);
    expect(res.body.accessToken).toEqual(expect.any(String));
  });

  it("exposes verification state on /me so the UI can show the reminder", async () => {
    const { res: reg } = await registerFresh();
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${reg.body.accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body.user.emailVerified).toBe(false);
  });
});

describe("POST /api/auth/forgot-password", () => {
  it("answers identically for a known and an unknown address", async () => {
    const { creds } = await registerFresh();

    const known = await request(app).post("/api/auth/forgot-password").send({ email: creds.email });
    const unknown = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: `nobody_${RUN}@${TEST_DOMAIN}` });

    // Identical status AND identical body — any difference is an oracle for
    // "does this person have an account here".
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
  });

  it("issues a reset token for a real account", async () => {
    const { creds, userId } = await registerFresh();
    await request(app).post("/api/auth/forgot-password").send({ email: creds.email });

    const tokens = await prisma.verificationToken.findMany({
      where: { userId, purpose: "PASSWORD_RESET", consumedAt: null },
    });
    expect(tokens).toHaveLength(1);
  });

  it("issues NOTHING for an OAuth-only account", async () => {
    // No password means there is nothing to reset; sending a link would let
    // mailbox access CREATE a password on a Google-only account.
    const user = await prisma.user.create({
      data: {
        username: `oauth_${RUN}${(seq += 1)}`,
        email: `oauth_${RUN}${seq}@${TEST_DOMAIN}`,
        password: null,
      },
    });

    const res = await request(app).post("/api/auth/forgot-password").send({ email: user.email });
    expect(res.status).toBe(200); // same answer as every other case

    const tokens = await prisma.verificationToken.findMany({
      where: { userId: user.id, purpose: "PASSWORD_RESET" },
    });
    expect(tokens).toHaveLength(0);
  });

  it("is case-insensitive on the address", async () => {
    const { creds, userId } = await registerFresh();
    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: creds.email.toUpperCase() });

    const tokens = await prisma.verificationToken.findMany({
      where: { userId, purpose: "PASSWORD_RESET", consumedAt: null },
    });
    expect(tokens).toHaveLength(1);
  });
});

describe("POST /api/auth/reset-password", () => {
  it("sets the new password and signs the user in", async () => {
    const { creds, userId } = await registerFresh();
    const token = await issueVerificationToken(userId, "PASSWORD_RESET");

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "a brand new passphrase" });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));

    // The new password works...
    const good = await request(app)
      .post("/api/auth/login")
      .send({ email: creds.email, password: "a brand new passphrase" });
    expect(good.status).toBe(200);

    // ...and the old one does not.
    const bad = await request(app)
      .post("/api/auth/login")
      .send({ email: creds.email, password: creds.password });
    expect(bad.status).toBe(401);
  });

  it("marks the address verified — redeeming the link proved the mailbox", async () => {
    const { userId } = await registerFresh();
    const token = await issueVerificationToken(userId, "PASSWORD_RESET");

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "another good passphrase" });

    expect(res.body.user.emailVerified).toBe(true);
  });

  it("revokes every other session", async () => {
    const { creds, userId } = await registerFresh();
    // A second, still-live session — the one an attacker would be holding.
    await request(app).post("/api/auth/login").send({ email: creds.email, password: creds.password });

    const activeBefore = await prisma.refreshToken.count({ where: { userId, revokedAt: null } });
    expect(activeBefore).toBeGreaterThan(1);

    const token = await issueVerificationToken(userId, "PASSWORD_RESET");
    await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "yet another passphrase" });

    // Exactly one survives: the session just issued to the person who reset it.
    const activeAfter = await prisma.refreshToken.count({ where: { userId, revokedAt: null } });
    expect(activeAfter).toBe(1);
  });

  it("rejects the same reset token twice", async () => {
    const { userId } = await registerFresh();
    const token = await issueVerificationToken(userId, "PASSWORD_RESET");

    const first = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "first new passphrase" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "second new passphrase" });
    expect(second.status).toBe(400);
  });

  it("rejects an expired reset token", async () => {
    const { userId } = await registerFresh();
    const token = await issueVerificationToken(userId, "PASSWORD_RESET");
    await prisma.verificationToken.updateMany({
      where: { userId, purpose: "PASSWORD_RESET", consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "should not be applied" });
    expect(res.status).toBe(400);
  });

  it("refuses an EMAIL_VERIFICATION token", async () => {
    const { userId } = await registerFresh();
    const verifyToken = await issueVerificationToken(userId, "EMAIL_VERIFICATION");

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: verifyToken, password: "should not be applied" });
    expect(res.status).toBe(400);
  });

  it("enforces the same minimum password length as registration", async () => {
    const { userId } = await registerFresh();
    const token = await issueVerificationToken(userId, "PASSWORD_RESET");

    const res = await request(app).post("/api/auth/reset-password").send({ token, password: "short" });
    expect(res.status).toBe(422);
  });
});

describe("POST /api/auth/resend-verification", () => {
  it("issues a replacement token for an unverified user", async () => {
    const { res: reg, userId } = await registerFresh();

    const res = await request(app)
      .post("/api/auth/resend-verification")
      .set("Authorization", `Bearer ${reg.body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);

    const active = await prisma.verificationToken.count({
      where: { userId, purpose: "EMAIL_VERIFICATION", consumedAt: null },
    });
    expect(active).toBe(1); // the replacement, not an accumulating pile
  });

  it("does not send once the address is already verified", async () => {
    const { res: reg, userId } = await registerFresh();
    const token = await issueVerificationToken(userId, "EMAIL_VERIFICATION");
    await request(app).post("/api/auth/verify-email").send({ token });

    const res = await request(app)
      .post("/api/auth/resend-verification")
      .set("Authorization", `Bearer ${reg.body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(false);
  });

  it("requires authentication", async () => {
    const res = await request(app).post("/api/auth/resend-verification");
    expect(res.status).toBe(401);
  });
});
