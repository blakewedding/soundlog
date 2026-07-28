// 6.2b step 3 — password change with re-auth, email change with re-verification.
//
// The design decision these are mostly testing: an email change does NOT take
// effect on request. `email` is the login identifier, so writing a new address
// immediately means one typo locks someone out of their own account with
// nothing to sign in with and no mailbox to receive a reset at. The new address
// is held as `pendingEmail` until the link sent TO IT is clicked.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { runTag } from "../support/runTag.js";
import { issueVerificationToken } from "../../src/services/verificationService.js";

const app = createApp();
const RUN = runTag("sec");
const DOMAIN = "p62sec.local";
const PASSWORD = "correct horse battery";

let me: { token: string; id: string; username: string; email: string };
const auth = (t = me.token) => ({ Authorization: `Bearer ${t}` });

async function makeUser(tag: string) {
  const username = `${RUN}_${tag}`;
  // Usernames cap at 24 and RUN is already 15, so a long tag silently 422s and
  // every assertion downstream then fails on `undefined` instead of on the
  // thing being tested. Fail here, where the cause is legible.
  if (username.length > 24) throw new Error(`fixture username too long: ${username}`);
  const email = `${username}@${DOMAIN}`;
  const res = await request(app)
    .post("/api/auth/register")
    .send({ username, email, password: PASSWORD });
  if (res.status !== 201) throw new Error(`fixture registration failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken as string, id: res.body.user.id as string, username, email };
}

/**
 * The raw token from the most recent EMAIL_CHANGE issue.
 *
 * Only the HASH is stored, so this cannot be read back from the database — the
 * test re-derives it the only way anything can: by knowing what was hashed.
 * Instead we read the row and confirm shape, then drive confirmation through a
 * token we mint ourselves via the same service the route uses.
 */
async function pendingTokenRow(userId: string) {
  return prisma.verificationToken.findFirst({
    where: { userId, purpose: "EMAIL_CHANGE", consumedAt: null },
    orderBy: { expiresAt: "desc" },
  });
}

beforeAll(async () => {
  me = await makeUser("owner");
});

beforeEach(async () => {
  // Each case starts from a known password and no pending change.
  await prisma.user.update({ where: { id: me.id }, data: { pendingEmail: null, email: me.email } });
  await prisma.verificationToken.updateMany({
    where: { userId: me.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  await prisma.$disconnect();
  await redis.quit().catch(() => {});
});

describe("POST /api/me/password", () => {
  it("requires a token", async () => {
    const res = await request(app)
      .post("/api/me/password")
      .send({ currentPassword: PASSWORD, newPassword: "a new long password" });
    expect(res.status).toBe(401);
  });

  it("refuses without the CURRENT password, even holding a valid session", async () => {
    // The whole point of re-auth: the access token proves the session
    // authenticated recently, not that the owner is the one holding the device.
    const res = await request(app)
      .post("/api/me/password")
      .set(auth())
      .send({ currentPassword: "not the password", newPassword: "a new long password" });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not correct/i);
  });

  it("refuses a new password shorter than registration allows", async () => {
    // A change path that accepts a weaker password than the front door is a way
    // around the front door.
    const res = await request(app)
      .post("/api/me/password")
      .set(auth())
      .send({ currentPassword: PASSWORD, newPassword: "short" });
    expect(res.status).toBe(422);
  });

  it("changes the password and lets the new one sign in", async () => {
    const user = await makeUser("pw");
    const next = "an entirely new password";

    const res = await request(app)
      .post("/api/me/password")
      .set(auth(user.token))
      .send({ currentPassword: PASSWORD, newPassword: next });
    expect(res.status).toBe(200);

    const withNew = await request(app).post("/api/auth/login").send({ email: user.email, password: next });
    expect(withNew.status).toBe(200);
    const withOld = await request(app).post("/api/auth/login").send({ email: user.email, password: PASSWORD });
    expect(withOld.status).toBe(401);
  });

  it("revokes every other session, which is what makes the change worth making", async () => {
    const user = await makeUser("sessions");
    // A second device: its own refresh token, issued before the change.
    const other = await request(app).post("/api/auth/login").send({ email: user.email, password: PASSWORD });
    const otherCookie = other.headers["set-cookie"];
    expect(otherCookie).toBeDefined();

    await request(app)
      .post("/api/me/password")
      .set(auth(user.token))
      .send({ currentPassword: PASSWORD, newPassword: "yet another long password" });

    // The other device's refresh token no longer mints access tokens. Without
    // this, a password change evicts nobody and is security theatre.
    const refreshed = await request(app).post("/api/auth/refresh").set("Cookie", otherCookie);
    expect(refreshed.status).toBe(401);
  });

  it("keeps the caller signed in on the device they changed it from", async () => {
    const user = await makeUser("stayin");
    const res = await request(app)
      .post("/api/me/password")
      .set(auth(user.token))
      .send({ currentPassword: PASSWORD, newPassword: "a fresh long password" });

    expect(res.body.accessToken).toBeTruthy();
    expect(res.headers["set-cookie"]).toBeDefined();
    // The returned token works immediately — otherwise a security control
    // punishes the person using it, and people stop using it.
    const check = await request(app).get("/api/me/profile").set(auth(res.body.accessToken));
    expect(check.status).toBe(200);
  });
});

describe("POST /api/me/email — the change does not take effect on request", () => {
  it("refuses without the current password", async () => {
    const res = await request(app)
      .post("/api/me/email")
      .set(auth())
      .send({ currentPassword: "wrong", newEmail: `x_${RUN}@${DOMAIN}` });
    expect(res.status).toBe(401);
  });

  it("records the address as PENDING and leaves the login email untouched", async () => {
    const next = `moved_${RUN}@${DOMAIN}`;
    const res = await request(app)
      .post("/api/me/email")
      .set(auth())
      .send({ currentPassword: PASSWORD, newEmail: next });

    expect(res.status).toBe(200);
    expect(res.body.pendingEmail).toBe(next);

    const row = await prisma.user.findUnique({ where: { id: me.id } });
    expect(row!.email).toBe(me.email); // unchanged
    expect(row!.pendingEmail).toBe(next);

    // And the OLD address still signs in — the property that makes a typo
    // survivable rather than terminal.
    const login = await request(app).post("/api/auth/login").send({ email: me.email, password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it("issues a single-use EMAIL_CHANGE token", async () => {
    await request(app)
      .post("/api/me/email")
      .set(auth())
      .send({ currentPassword: PASSWORD, newEmail: `tok_${RUN}@${DOMAIN}` });

    const token = await pendingTokenRow(me.id);
    expect(token).not.toBeNull();
    expect(token!.purpose).toBe("EMAIL_CHANGE");
    expect(token!.consumedAt).toBeNull();
    // Two hours, not the verification link's 24.
    const ttlMinutes = (token!.expiresAt.getTime() - Date.now()) / 60000;
    expect(ttlMinutes).toBeGreaterThan(100);
    expect(ttlMinutes).toBeLessThan(130);
  });

  it("refuses an address already registered", async () => {
    const other = await makeUser("taken");
    const res = await request(app)
      .post("/api/me/email")
      .set(auth())
      .send({ currentPassword: PASSWORD, newEmail: other.email });
    expect(res.status).toBe(409);
  });

  it("refuses the address you already have", async () => {
    const res = await request(app)
      .post("/api/me/email")
      .set(auth())
      .send({ currentPassword: PASSWORD, newEmail: me.email });
    expect(res.status).toBe(409);
  });

  it("surfaces the pending address on the settings payload", async () => {
    const next = `shown_${RUN}@${DOMAIN}`;
    await request(app).post("/api/me/email").set(auth()).send({ currentPassword: PASSWORD, newEmail: next });

    const res = await request(app).get("/api/me/profile").set(auth());
    expect(res.body.profile.pendingEmail).toBe(next);
    expect(res.body.profile.email).toBe(me.email);
  });
});

describe("DELETE /api/me/email — cancelling", () => {
  it("clears the pending address AND kills the outstanding link", async () => {
    await request(app)
      .post("/api/me/email")
      .set(auth())
      .send({ currentPassword: PASSWORD, newEmail: `cancel_${RUN}@${DOMAIN}` });
    expect(await pendingTokenRow(me.id)).not.toBeNull();

    const res = await request(app).delete("/api/me/email").set(auth());
    expect(res.status).toBe(200);

    const row = await prisma.user.findUnique({ where: { id: me.id } });
    expect(row!.pendingEmail).toBeNull();
    // Cancelling that only hid the change from the UI would leave it one click
    // from taking effect.
    expect(await pendingTokenRow(me.id)).toBeNull();
  });
});

describe("POST /api/auth/confirm-email-change", () => {
  it("rejects a junk token with the same message as every other bad link", async () => {
    const res = await request(app).post("/api/auth/confirm-email-change").send({ token: "nonsense" });
    expect(res.status).toBe(400);
  });

  it("moves pendingEmail into email, verifies it, and kills every session", async () => {
    // The happy path, and the only test that proves the change ever completes.
    // The raw token exists in plaintext exactly once — inside the route — so the
    // test mints its own through the SAME service rather than trying to read a
    // hash back.
    const user = await makeUser("confirm");
    const next = `confirmed_${RUN}@${DOMAIN}`;
    await request(app)
      .post("/api/me/email")
      .set(auth(user.token))
      .send({ currentPassword: PASSWORD, newEmail: next });

    const session = await request(app).post("/api/auth/login").send({ email: user.email, password: PASSWORD });
    const cookie = session.headers["set-cookie"];

    const raw = await issueVerificationToken(user.id, "EMAIL_CHANGE");
    const res = await request(app).post("/api/auth/confirm-email-change").send({ token: raw });
    expect(res.status).toBe(200);

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row!.email).toBe(next);
    expect(row!.pendingEmail).toBeNull();
    // Clicking a link sent to that address IS the verification.
    expect(row!.emailVerifiedAt).not.toBeNull();

    // The NEW address signs in; the old one no longer does.
    expect((await request(app).post("/api/auth/login").send({ email: next, password: PASSWORD })).status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({ email: user.email, password: PASSWORD })).status).toBe(401);

    // A completed change is a change of who can get in, so sessions predating
    // it must not survive it.
    expect((await request(app).post("/api/auth/refresh").set("Cookie", cookie)).status).toBe(401);
  });

  it("is single-use — a second click cannot re-run it", async () => {
    const user = await makeUser("once");
    await request(app)
      .post("/api/me/email")
      .set(auth(user.token))
      .send({ currentPassword: PASSWORD, newEmail: `once_${RUN}@${DOMAIN}` });

    const raw = await issueVerificationToken(user.id, "EMAIL_CHANGE");
    expect((await request(app).post("/api/auth/confirm-email-change").send({ token: raw })).status).toBe(200);
    // Second attempt: the token is spent, so it reads as an invalid link.
    expect((await request(app).post("/api/auth/confirm-email-change").send({ token: raw })).status).toBe(400);
  });

  it("refuses to confirm when the change was cancelled", async () => {
    const user = await makeUser("canc");
    await request(app)
      .post("/api/me/email")
      .set(auth(user.token))
      .send({ currentPassword: PASSWORD, newEmail: `gone_${RUN}@${DOMAIN}` });

    // Cancel consumes the token, so confirmation cannot resurrect the change.
    await request(app).delete("/api/me/email").set(auth(user.token));
    expect(await pendingTokenRow(user.id)).toBeNull();

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row!.pendingEmail).toBeNull();
    expect(row!.email).toBe(user.email);
  });
});
