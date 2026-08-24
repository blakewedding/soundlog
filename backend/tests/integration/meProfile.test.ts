// Phase 6.2a — /api/me/profile and /api/me/avatar, plus the /avatars byte route.
//
// The gauntlet has its own unit tests; what matters HERE is that it is actually
// wired into the HTTP boundary — that a hostile upload is refused by the
// endpoint rather than only by a function nobody calls — and that the row and
// the bytes on disk stay in agreement through change and deletion.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { resilient } from "../support/httpRetry.js";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { __setAvatarDir, masterPath, parseAvatarPath } from "../../src/services/avatarStorage.js";
import { runTag } from "../support/runTag.js";

const app = createApp();
const RUN = runTag();
const DOMAIN = "p62test.local";

let dir: string;
let me: { token: string; id: string; username: string };
const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

async function makeUser(tag: string) {
  const username = `p62_${tag}_${RUN}`;
  // Usernames cap at 24 (auth.ts) and RUN is 12 letters, so a longer tag here
  // fails as a 422 whose only symptom is a TypeError on res.body.user.id.
  if (username.length > 24) throw new Error(`fixture username too long: ${username}`);
  const res = await request(app)
    .post("/api/auth/register")
    .send({ username, email: `${username}@${DOMAIN}`, password: "correct horse battery" });
  return { token: res.body.accessToken as string, id: res.body.user.id as string, username };
}

const png = (w = 600, h = 600, tint = 200) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: tint, g: 60, b: 90 } } })
    .png()
    .toBuffer();

/** Upload bytes the way both clients will: raw body, image/* content type. */
const upload = (bytes: Buffer, type = "image/png") =>
  request(app).put("/api/me/avatar").set(auth(me)).set("Content-Type", type).send(bytes);

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "soundlog-me-"));
  __setAvatarDir(dir);
  me = await makeUser("owner");
});

// The upload budget is six per ten minutes and this file uploads well past that.
// Reset it between cases so the limiter does not silently become the thing every
// later assertion is measuring — it gets its own test below instead.
beforeEach(async () => {
  await redis.del(`avatar:upload:${me.id}`);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  await rm(dir, { recursive: true, force: true });
  const keys = await redis.keys("avatar:upload:*");
  if (keys.length) await redis.del(...keys);
  await prisma.$disconnect();
  await redis.quit().catch(() => {});
});

describe("GET/PATCH /api/me/profile", () => {
  it("requires a token", async () => {
    expect((await request(app).get("/api/me/profile")).status).toBe(401);
    expect((await request(app).patch("/api/me/profile").send({ bio: "x" })).status).toBe(401);
  });

  it("returns the caller's own account, with the 6.2 columns defaulted", async () => {
    const res = await request(app).get("/api/me/profile").set(auth(me));
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({
      username: me.username,
      links: [],
      plan: "FREE",
      profileVisibility: "PUBLIC",
      avatarUrl: null,
    });
  });

  it("updates only the fields it is sent", async () => {
    await request(app).patch("/api/me/profile").set(auth(me)).send({ displayName: "Blake" });
    const res = await request(app).patch("/api/me/profile").set(auth(me)).send({ bio: "hi" });
    // A PATCH naming only `bio` must not blank the displayName set a moment ago.
    expect(res.body.profile).toMatchObject({ displayName: "Blake", bio: "hi" });
  });

  it("publishes links on the PUBLIC profile, not only back to the editor", async () => {
    // The gap the phone check found: links saved, persisted, and showed in the
    // settings form, and no surface anywhere rendered them. A value that only
    // ever comes back to the person who typed it has not been published.
    const links = [{ label: "Bandcamp", url: "https://example.bandcamp.com" }];
    await request(app).patch("/api/me/profile").set(auth(me)).send({ links });

    const pub = await request(app).get(`/api/users/${me.username}`);
    expect(pub.status).toBe(200);
    expect(pub.body.profile.links).toEqual(links);
  });

  it("round-trips links", async () => {
    const links = [
      { label: "Bandcamp", url: "https://example.bandcamp.com" },
      { label: "Site", url: "https://example.com/me" },
    ];
    const res = await request(app).patch("/api/me/profile").set(auth(me)).send({ links });
    expect(res.status).toBe(200);
    expect(res.body.profile.links).toEqual(links);
  });
});

describe("links — the containment for a schemaless column", () => {
  // The `links` column is Json, which is safe ONLY because exactly one write
  // path exists and it parses through profileLinksSchema. These are that claim.
  const bad: ReadonlyArray<readonly [string, unknown]> = [
    ["javascript:, which parses fine as a URL", [{ label: "x", url: "javascript:alert(1)" }]],
    ["http, which a browser would block from an https page", [{ label: "x", url: "http://example.com" }]],
    ["a non-URL string", [{ label: "x", url: "not a url" }]],
    ["a missing label", [{ url: "https://example.com" }]],
    ["an empty label", [{ label: "", url: "https://example.com" }]],
    ["an over-long label", [{ label: "a".repeat(41), url: "https://example.com" }]],
    ["more than five", Array.from({ length: 6 }, () => ({ label: "x", url: "https://example.com" }))],
    ["a bare string instead of an object", ["https://example.com"]],
    ["an object instead of an array", { label: "x", url: "https://example.com" }],
  ];

  for (const [why, links] of bad) {
    it(`refuses ${why}`, async () => {
      const res = await request(app).patch("/api/me/profile").set(auth(me)).send({ links });
      expect(res.status).toBe(422);
    });
  }

  it("leaves the stored value untouched after a rejected write", async () => {
    const good = [{ label: "Keep", url: "https://keep.example.com" }];
    await request(app).patch("/api/me/profile").set(auth(me)).send({ links: good });
    await request(app)
      .patch("/api/me/profile")
      .set(auth(me))
      .send({ links: [{ label: "x", url: "javascript:alert(1)" }] });

    const res = await request(app).get("/api/me/profile").set(auth(me));
    expect(res.body.profile.links).toEqual(good);
  });
});

describe("PUT /api/me/avatar", () => {
  it("requires a token", async () => {
    const res = await request(app).put("/api/me/avatar").set("Content-Type", "image/png").send(await png());
    expect(res.status).toBe(401);
  });

  it("accepts an image, stores a master, and points the row at it", async () => {
    const res = await upload(await png());
    expect(res.status).toBe(200);

    const url: string = res.body.profile.avatarUrl;
    const parsed = parseAvatarPath(url);
    expect(parsed).not.toBeNull();
    expect(parsed!.userId).toBe(me.id);
    expect((await stat(masterPath(me.id, parsed!.hash))).isFile()).toBe(true);

    // The row is the source of truth for what the client renders.
    const fromDb = await prisma.user.findUnique({ where: { id: me.id } });
    expect(fromDb!.avatarUrl).toBe(url);
  });

  it("refuses the gauntlet's cases at the HTTP boundary, as 4xx and not 503", async () => {
    // §1's 503 is for upstream uncertainty. There is no upstream here, so every
    // rejection is definitive and must say so.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    const svgRes = await upload(svg, "image/svg+xml");
    expect(svgRes.status).toBeGreaterThanOrEqual(400);
    expect(svgRes.status).toBeLessThan(500);

    const textAsPng = await upload(Buffer.from("definitely a picture"), "image/png");
    expect(textAsPng.status).toBe(400);
    expect(textAsPng.body.error).toMatch(/not a JPEG, PNG or WebP/);
  });

  it("refuses a body sent without an image content type", async () => {
    const res = await request(app)
      .put("/api/me/avatar")
      .set(auth(me))
      .set("Content-Type", "application/json")
      .send({ sneaky: true });
    expect(res.status).toBe(415);
  });

  it("deletes the previous master when the picture changes", async () => {
    const first = await upload(await png(600, 600, 10));
    const firstHash = parseAvatarPath(first.body.profile.avatarUrl)!.hash;

    const second = await upload(await png(600, 600, 240));
    const secondHash = parseAvatarPath(second.body.profile.avatarUrl)!.hash;
    expect(secondHash).not.toBe(firstHash);

    // The old bytes are gone — they have no upstream, so leaving them is disk
    // nobody can reach and a photograph we were not asked to keep.
    await expect(stat(masterPath(me.id, firstHash))).rejects.toThrow();
    expect((await stat(masterPath(me.id, secondHash))).isFile()).toBe(true);
  });

  it("does not delete the file when the same image is re-uploaded", async () => {
    // Idempotent: same bytes resolve to the same hash and the same file, so
    // "delete the old one" would delete the one just written.
    const bytes = await png(600, 600, 123);
    const a = await upload(bytes);
    const b = await upload(bytes);
    const hash = parseAvatarPath(b.body.profile.avatarUrl)!.hash;

    expect(b.body.profile.avatarUrl).toBe(a.body.profile.avatarUrl);
    expect((await stat(masterPath(me.id, hash))).isFile()).toBe(true);
  });
});

describe("PUT /api/me/avatar — the upload budget", () => {
  it("refuses the seventh upload in the window with a 429", async () => {
    // The cheapest way to make this box unhappy is to hold it decoding 5 MB
    // images in a loop, so the limit is on uploads rather than on bytes alone.
    // Distinct images, or the idempotent path would make these one upload.
    for (let i = 0; i < 6; i++) {
      expect((await upload(await png(600, 600, i * 20))).status, `upload ${i + 1}`).toBe(200);
    }
    const seventh = await upload(await png(600, 600, 199));
    expect(seventh.status).toBe(429);
    expect(seventh.body.error).toMatch(/try again in/i);
  });
});

describe("DELETE /api/me/avatar", () => {
  it("clears the row and removes the bytes", async () => {
    const up = await upload(await png(600, 600, 77));
    const hash = parseAvatarPath(up.body.profile.avatarUrl)!.hash;

    const res = await request(app).delete("/api/me/avatar").set(auth(me));
    expect(res.status).toBe(200);
    expect(res.body.profile.avatarUrl).toBeNull();
    await expect(stat(masterPath(me.id, hash))).rejects.toThrow();
  });

  it("is safe when there is no avatar", async () => {
    expect((await request(app).delete("/api/me/avatar").set(auth(me))).status).toBe(200);
  });
});

describe("GET /avatars/... — the byte route", () => {
  it("serves a rendition with a year-long immutable lifetime", async () => {
    const up = await upload(await png(600, 600, 33));
    const url: string = up.body.profile.avatarUrl;

    const res = await request(app).get(url);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/webp/);
    expect(res.headers["cache-control"]).toMatch(/immutable/);
    expect(res.headers["cache-control"]).toMatch(/max-age=31536000/);
    expect(res.headers.etag).toBeDefined();
  });

  it("honours a conditional request", async () => {
    const up = await upload(await png(600, 600, 44));
    const url: string = up.body.profile.avatarUrl;
    const first = await request(app).get(url);
    const second = await request(app).get(url).set("If-None-Match", first.headers.etag);
    expect(second.status).toBe(304);
  });

  it("serves every width the client may ask for by rewriting the segment", async () => {
    const up = await upload(await png(600, 600, 55));
    const parsed = parseAvatarPath(up.body.profile.avatarUrl)!;
    for (const w of [48, 96, 192, 384]) {
      const res = await request(app).get(`/avatars/w${w}/${parsed.userId}-${parsed.hash}.webp`);
      expect(res.status, `width ${w}`).toBe(200);
      expect((await sharp(res.body).metadata()).width).toBe(w);
    }
  });

  it("404s a width it does not render", async () => {
    const up = await upload(await png(600, 600, 66));
    const parsed = parseAvatarPath(up.body.profile.avatarUrl)!;
    // Not a resize-on-demand: an open width parameter is how one crawler fills
    // a disk with renditions nobody asked for.
    expect((await request(app).get(`/avatars/w97/${parsed.userId}-${parsed.hash}.webp`)).status).toBe(404);
  });

  it("404s a hash we do not hold, rather than erroring", async () => {
    const res = await request(app).get(`/avatars/w96/${me.id}-0123456789abcdef.webp`);
    expect(res.status).toBe(404);
  });

  it("refuses a traversal attempt in the id segment", async () => {
    // The id is the only caller-controlled input to a filesystem read.
    //
    // `resilient` retries a TRANSPORT failure only — these three fire back to
    // back, each against its own ephemeral supertest server, and a connection
    // can land on a port the previous one is still closing. The status
    // assertion below is unchanged and unrelaxed; see tests/support/httpRetry.
    for (const bad of ["../../etc/passwd", "..", "AAAA%2Fbb"]) {
      const res = await resilient(() =>
        request(app).get(`/avatars/w96/${bad}-0123456789abcdef.webp`)
      );
      expect(res.status, bad).toBe(404);
    }
  });

  it("needs no token — avatars are public bytes", async () => {
    // Explicitly asserted because it is a v1 decision, not an oversight:
    // profileVisibility does not gate image bytes, and the settings copy must
    // not imply that it does.
    const up = await upload(await png(600, 600, 88));
    expect((await request(app).get(up.body.profile.avatarUrl)).status).toBe(200);
  });
});
