// The large-upload path, end to end through the app.
//
// This exists because a real phone photo came back as a bare `413` with no
// explanation. Two separate faults produced that, at opposite ends of the size
// range, and neither was covered by a test:
//
//   * a proxy in front of the app refused the body at 1 MB (nginx's default
//     `client_max_body_size`) — covered by the config and by the live check in
//     the deploy, not here;
//   * body-parser refused anything over 5 MB by THROWING before any route ran,
//     which fell through errorHandler to a generic 500.
//
// The 6.2a verification used a 30 KB image, which is why both survived: a tiny
// upload proves the happy path and nothing about a ceiling. These cases are
// deliberately sized around the real boundary.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { __setAvatarDir } from "../../src/services/avatarStorage.js";
import { MAX_AVATAR_BYTES } from "../../src/services/avatarService.js";
import { runTag } from "../support/runTag.js";

const app = createApp();
const RUN = runTag("sz");
const DOMAIN = "p62size.local";

let dir: string;
let me: { token: string; id: string };
const auth = () => ({ Authorization: `Bearer ${me.token}` });

/**
 * A REAL JPEG of roughly `targetBytes`, not random noise.
 *
 * Noise would be refused by the magic-byte sniff long before the size check,
 * which is the opposite of what these tests are about. Photographic noise at
 * low compression is what actually makes a JPEG large, so the image is built
 * from random pixels and encoded at quality 100.
 */
async function jpegBetween(minBytes: number, maxBytes: number): Promise<Buffer> {
  // Noise at quality 100 runs ~6 bytes per pixel, so the steps are small: 1200px
  // already lands near 9 MB, well past the 5 MB ceiling this is meant to stay
  // under.
  for (let side = 500; side <= 1400; side += 50) {
    const px = Buffer.alloc(side * side * 3);
    for (let i = 0; i < px.length; i++) px[i] = (i * 2654435761) % 251;
    const buf = await sharp(px, { raw: { width: side, height: side, channels: 3 } })
      .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
      .toBuffer();
    if (buf.byteLength >= minBytes && buf.byteLength <= maxBytes) return buf;
    if (buf.byteLength > maxBytes) break;
  }
  throw new Error(`could not build a JPEG between ${minBytes} and ${maxBytes} bytes`);
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "soundlog-size-"));
  __setAvatarDir(dir);
  const res = await request(app)
    .post("/api/auth/register")
    .send({ username: `p62_${RUN}`, email: `p62_${RUN}@${DOMAIN}`, password: "correct horse battery" });
  me = { token: res.body.accessToken, id: res.body.user.id };
}, 120_000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  await rm(dir, { recursive: true, force: true });
  const keys = await redis.keys("avatar:upload:*");
  if (keys.length) await redis.del(...keys);
  await prisma.$disconnect();
  await redis.quit().catch(() => {});
});

describe("avatar upload — the size boundary", () => {
  it("accepts a 4 MB photo, the size a phone actually produces", async () => {
    const big = await jpegBetween(4 * 1024 * 1024, MAX_AVATAR_BYTES - 1);
    expect(big.byteLength).toBeGreaterThan(4 * 1024 * 1024);
    expect(big.byteLength).toBeLessThan(MAX_AVATAR_BYTES);

    await redis.del(`avatar:upload:${me.id}`);
    const res = await request(app)
      .put("/api/me/avatar")
      .set(auth())
      .set("Content-Type", "image/jpeg")
      .send(big);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.profile.avatarUrl).toMatch(/^\/avatars\/w\d+\//);
    // The stored master is a fraction of the upload — the whole point of
    // re-encoding — so a 4 MB upload must not put 4 MB on disk.
    expect(res.body.bytes).toBeLessThan(200_000);
  }, 120_000);

  it("refuses an oversized body with a REASON, never a bare 500", async () => {
    // body-parser throws before the route runs. Without the errorHandler branch
    // this answered "Internal server error", which tells the uploader nothing
    // and looks like our fault rather than a file they can change.
    const huge = Buffer.alloc(MAX_AVATAR_BYTES + 1024 * 1024, 0x41);

    await redis.del(`avatar:upload:${me.id}`);
    const res = await request(app)
      .put("/api/me/avatar")
      .set(auth())
      .set("Content-Type", "image/jpeg")
      .send(huge);

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large/i);
    expect(res.body.error).toMatch(/5 MB/);
    expect(res.body.error).not.toMatch(/internal server error/i);
  }, 120_000);

  it("answers 413 from the gauntlet too, so one condition has one status", async () => {
    // The service's own size check is the backstop for callers that do not come
    // through express.raw. It used to answer 400 while the transport answered
    // 413 — the same condition with two different statuses depending only on
    // how far the bytes got.
    const { ingestAvatar } = await import("../../src/services/avatarService.js");
    await expect(ingestAvatar(me.id, Buffer.alloc(MAX_AVATAR_BYTES + 1))).rejects.toMatchObject({
      status: 413,
    });
  });
});
