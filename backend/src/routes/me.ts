/**
 * `/api/me/*` — the signed-in user acting on their own account.
 *
 * Deliberately separate from `/api/users/:username`, which is the PUBLIC view of
 * somebody. Same rows, different contract: `/users/:username` answers "what may
 * anyone see about this person", `/me` answers "what may this person change
 * about themselves". Collapsing them means every field needs a per-caller
 * visibility rule at the point it is serialized, which is exactly the kind of
 * check that is right in ten places and forgotten in the eleventh.
 *
 * API-first, because Phase 7's mobile client consumes these unchanged — hence a
 * raw-body PUT for the avatar rather than anything browser-shaped (see below).
 */
import { Router } from "express";
import express from "express";
import { z } from "zod";
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { validate } from "../middleware/validate.js";
import {
  MAX_AVATAR_BYTES,
  deleteAvatarFiles,
  ingestAvatar,
} from "../services/avatarService.js";
import { parseAvatarPath } from "../services/avatarStorage.js";

export const meRouter = Router();

/**
 * Profile links, as `[{ label, url }]`.
 *
 * This schema is the ENTIRE containment story for the `links` Json column. The
 * column is schemaless by choice — a join for at most five rows, on a payload
 * read by every profile, review card and feed row, was the worse trade — and
 * what makes that safe is that there is exactly one write path and it goes
 * through here. A shape that fails this parse is a 422 and never reaches
 * Postgres, so no reader has to defend itself against a value it did not
 * expect.
 *
 * `https` only, and not merely "a valid URL": `javascript:` parses perfectly as
 * a URL, and these are rendered as anchors on a public profile. `http:` is
 * excluded too — a mixed-content link from an https page is blocked by the
 * browser anyway, so accepting it would only let someone save a link that
 * cannot work.
 */
const profileLinkSchema = z.object({
  label: z.string().trim().min(1).max(40),
  url: z
    .string()
    .trim()
    .max(200)
    .url()
    .refine((v) => {
      try {
        return new URL(v).protocol === "https:";
      } catch {
        return false;
      }
    }, { message: "Links must start with https://" }),
});

export const profileLinksSchema = z.array(profileLinkSchema).max(5);

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(60).nullable().optional(),
  bio: z.string().trim().max(500).nullable().optional(),
  links: profileLinksSchema.optional(),
});

/** The caller's own account, including fields no one else may read. */
function toOwnProfile(user: {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  links: unknown;
  plan: string;
  profileVisibility: string;
  createdAt: Date;
  emailVerifiedAt: Date | null;
}) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    links: user.links ?? [],
    plan: user.plan,
    // Present so the client can round-trip it, but NOT yet enforced anywhere —
    // see the enum in schema.prisma. 6.2b makes it real across both stores; no
    // UI writes it until then, because a toggle that renders before enforcement
    // is a promise the product does not keep.
    profileVisibility: user.profileVisibility,
    createdAt: user.createdAt.toISOString(),
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}

async function ownProfileOrThrow(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  // The token verified, so the row existing is an invariant rather than a
  // user-facing case — but a deleted account with a live access token is
  // exactly the window account deletion opens, so it answers 401 rather than
  // crashing on a null.
  if (!user) throw new HttpError(401, "That account no longer exists.");
  return user;
}

meRouter.get("/profile", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    res.json({ profile: toOwnProfile(await ownProfileOrThrow(req.userId!)) });
  } catch (err) {
    next(err);
  }
});

meRouter.patch(
  "/profile",
  requireAuth,
  validate(updateProfileSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const { displayName, bio, links } = req.body as z.infer<typeof updateProfileSchema>;

      // Only the keys actually sent. A PATCH that names no field must not blank
      // the two it did not mention, which is what spreading undefined would do
      // if Prisma treated it as null.
      const data: Record<string, unknown> = {};
      if (displayName !== undefined) data.displayName = displayName || null;
      if (bio !== undefined) data.bio = bio || null;
      if (links !== undefined) data.links = links;

      const user = await prisma.user.update({ where: { id: req.userId! }, data });
      res.json({ profile: toOwnProfile(user) });
    } catch (err) {
      next(err);
    }
  }
);

// ---- Avatar ---------------------------------------------------------------

/**
 * Uploads per user per window. A limiter rather than a throttle: the cost of an
 * upload is a sharp decode, and the cheapest way to make this box unhappy is to
 * hold it decoding 5 MB images in a loop.
 */
const UPLOAD_LIMIT = 6;
const UPLOAD_WINDOW_SECONDS = 600;

async function claimUploadSlot(userId: string): Promise<void> {
  const key = `avatar:upload:${userId}`;
  // INCR then EXPIRE-on-first, rather than SET NX: this is a budget of six in a
  // window, not a single-shot lock like the release refresh gate.
  const used = await redis.incr(key);
  if (used === 1) await redis.expire(key, UPLOAD_WINDOW_SECONDS);
  if (used > UPLOAD_LIMIT) {
    const ttl = await redis.ttl(key);
    throw new HttpError(
      429,
      `That's ${UPLOAD_LIMIT} avatar changes in a row — try again in ${Math.max(1, Math.ceil(ttl / 60))} minute(s).`
    );
  }
}

/**
 * `PUT /api/me/avatar` with the image as the RAW request body.
 *
 * Not multipart. There are no fields to send besides the bytes, so a multipart
 * parser would be a dependency and a parsing surface bought for a filename we
 * are obliged to throw away — the path on disk is derived from the user id and
 * a content hash, never from anything the caller typed. `express.raw`'s `limit`
 * also enforces the byte cap DURING the read, so an oversized body is refused
 * on the wire rather than buffered and then measured.
 *
 * Both clients speak this natively: `fetch(url, { method: 'PUT', body: file })`
 * on web, and the same with a blob on React Native.
 */
meRouter.put(
  "/avatar",
  requireAuth,
  express.raw({ type: "image/*", limit: MAX_AVATAR_BYTES }),
  async (req: AuthedRequest, res, next) => {
    try {
      // A body that is not a Buffer means the Content-Type was not `image/*`,
      // so express.raw declined it and left an empty object behind. Say what is
      // wrong rather than failing the signature check with a confusing message.
      if (!Buffer.isBuffer(req.body)) {
        throw new HttpError(415, "Send the image bytes as the request body with an image/* Content-Type.");
      }

      await claimUploadSlot(req.userId!);

      const previous = await ownProfileOrThrow(req.userId!);
      const { url, bytes } = await ingestAvatar(req.userId!, req.body);

      const user = await prisma.user.update({
        where: { id: req.userId! },
        data: { avatarUrl: url },
      });

      // Remove the bytes the old URL pointed at, AFTER the row is safely
      // repointed. The other order loses the picture if the update fails, and
      // these files have no upstream to re-fetch from.
      //
      // Skipped when the hash is unchanged: re-uploading the same image is
      // idempotent and resolves to the same file, so deleting "the old one"
      // would delete the one just written.
      const old = previous.avatarUrl ? parseAvatarPath(previous.avatarUrl) : null;
      if (old && !url.includes(old.hash)) {
        await deleteAvatarFiles(req.userId!, old.hash);
      }

      res.json({ profile: toOwnProfile(user), bytes });
    } catch (err) {
      next(err);
    }
  }
);

meRouter.delete("/avatar", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const previous = await ownProfileOrThrow(req.userId!);
    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: { avatarUrl: null },
    });

    const old = previous.avatarUrl ? parseAvatarPath(previous.avatarUrl) : null;
    if (old) await deleteAvatarFiles(req.userId!, old.hash);

    res.json({ profile: toOwnProfile(user) });
  } catch (err) {
    next(err);
  }
});
