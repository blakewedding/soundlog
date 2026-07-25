import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database.js";
import { validate } from "../middleware/validate.js";
import { requireAuth, optionalAuth, type AuthedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { emitActivity } from "../jobs/activityQueue.js";

export const reviewsRouter = Router();

const publicUser = { select: { id: true, username: true, displayName: true, avatarUrl: true } };

const createReviewSchema = z.object({
  releaseId: z.string().min(1),
  content: z.string().min(1).max(20_000),
  rating: z.number().min(0.5).max(5).multipleOf(0.5).optional(),
  containsSpoilers: z.boolean().optional(),
});

const updateReviewSchema = z.object({
  content: z.string().min(1).max(20_000).optional(),
  rating: z.number().min(0.5).max(5).multipleOf(0.5).nullable().optional(),
  containsSpoilers: z.boolean().optional(),
});

type ReviewWithMeta = Prisma.ReviewGetPayload<{
  include: {
    user: { select: { id: true; username: true; displayName: true; avatarUrl: true } };
    _count: { select: { likes: true; comments: true } };
  };
}>;

function toReviewDTO(review: ReviewWithMeta, likedByMe: boolean) {
  return {
    id: review.id,
    releaseId: review.releaseId,
    user: review.user,
    content: review.content,
    rating: review.rating,
    containsSpoilers: review.containsSpoilers,
    likeCount: review._count.likes,
    commentCount: review._count.comments,
    likedByMe,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

const reviewInclude = {
  user: publicUser,
  _count: { select: { likes: true, comments: true } },
} as const;

async function likedBy(userId: string | undefined, reviewIds: string[]): Promise<Set<string>> {
  if (!userId || reviewIds.length === 0) return new Set();
  const likes = await prisma.reviewLike.findMany({
    where: { userId, reviewId: { in: reviewIds } },
    select: { reviewId: true },
  });
  return new Set(likes.map((l) => l.reviewId));
}

// ---------------------------------------------------------------------------
// Review CRUD
// ---------------------------------------------------------------------------

// POST /api/reviews — write my review of a release (one per release, DB-enforced).
reviewsRouter.post("/", requireAuth, validate(createReviewSchema), async (req: AuthedRequest, res, next) => {
  try {
    const release = await prisma.release.findUnique({
      where: { id: req.body.releaseId },
      select: { id: true },
    });
    if (!release) throw new HttpError(404, "Release not found");

    // Keep the attached rating and the Rating row in step.
    const review = await prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: {
          userId: req.userId!,
          releaseId: req.body.releaseId,
          content: req.body.content,
          rating: req.body.rating,
          containsSpoilers: req.body.containsSpoilers ?? false,
        },
        include: reviewInclude,
      });
      if (req.body.rating !== undefined) {
        await tx.rating.upsert({
          where: { userId_releaseId: { userId: req.userId!, releaseId: req.body.releaseId } },
          create: { userId: req.userId!, releaseId: req.body.releaseId, value: req.body.rating },
          update: { value: req.body.rating },
        });
      }
      return created;
    });
    await emitActivity({ userId: req.userId!, type: "REVIEW", targetId: review.id });
    res.status(201).json({ review: toReviewDTO(review, false) });
  } catch (err) {
    // The @@unique([userId, releaseId]) constraint — surface it kindly.
    if ((err as { code?: string }).code === "P2002") {
      return next(
        new HttpError(409, "You've already reviewed this release — edit your existing review instead")
      );
    }
    next(err);
  }
});

// GET /api/reviews/recent — latest reviews across the catalog (Home feed).
reviewsRouter.get("/recent", optionalAuth, async (req: AuthedRequest, res, next) => {
  try {
    const reviews = await prisma.review.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(req.query.limit) || 10, 25),
      include: {
        user: publicUser,
        release: { select: { id: true, title: true, artistName: true, coverUrl: true, coverColor: true } },
        _count: { select: { likes: true, comments: true } },
      },
    });
    const liked = await likedBy(req.userId, reviews.map((r) => r.id));
    res.json({
      reviews: reviews.map((r) => ({
        id: r.id,
        user: r.user,
        release: r.release,
        content: r.content,
        rating: r.rating,
        containsSpoilers: r.containsSpoilers,
        likeCount: r._count.likes,
        commentCount: r._count.comments,
        likedByMe: liked.has(r.id),
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reviews/release/:releaseId — all reviews of a release, newest first.
reviewsRouter.get("/release/:releaseId", optionalAuth, async (req: AuthedRequest, res, next) => {
  try {
    const reviews = await prisma.review.findMany({
      where: { releaseId: req.params.releaseId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(req.query.limit) || 25, 100),
      include: reviewInclude,
    });
    const liked = await likedBy(req.userId, reviews.map((r) => r.id));
    res.json({ reviews: reviews.map((r) => toReviewDTO(r, liked.has(r.id))) });
  } catch (err) {
    next(err);
  }
});

// GET /api/reviews/:id
reviewsRouter.get("/:id", optionalAuth, async (req: AuthedRequest, res, next) => {
  try {
    const review = await prisma.review.findUnique({
      where: { id: req.params.id },
      include: reviewInclude,
    });
    if (!review) throw new HttpError(404, "Review not found");
    const liked = await likedBy(req.userId, [review.id]);
    res.json({ review: toReviewDTO(review, liked.has(review.id)) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/reviews/:id — edit my review.
reviewsRouter.patch("/:id", requireAuth, validate(updateReviewSchema), async (req: AuthedRequest, res, next) => {
  try {
    const existing = await prisma.review.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, "Review not found");
    if (existing.userId !== req.userId) throw new HttpError(403, "Not your review");

    const review = await prisma.$transaction(async (tx) => {
      const updated = await tx.review.update({
        where: { id: existing.id },
        data: {
          content: req.body.content,
          rating: req.body.rating === undefined ? undefined : req.body.rating,
          containsSpoilers: req.body.containsSpoilers,
        },
        include: reviewInclude,
      });
      if (typeof req.body.rating === "number") {
        await tx.rating.upsert({
          where: { userId_releaseId: { userId: existing.userId, releaseId: existing.releaseId } },
          create: { userId: existing.userId, releaseId: existing.releaseId, value: req.body.rating },
          update: { value: req.body.rating },
        });
      }
      return updated;
    });
    const liked = await likedBy(req.userId, [review.id]);
    res.json({ review: toReviewDTO(review, liked.has(review.id)) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/reviews/:id — delete my review (likes/comments cascade in the DB).
reviewsRouter.delete("/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const existing = await prisma.review.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, "Review not found");
    if (existing.userId !== req.userId) throw new HttpError(403, "Not your review");
    await prisma.review.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Likes
// ---------------------------------------------------------------------------

// POST /api/reviews/:id/like — idempotent.
reviewsRouter.post("/:id/like", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const review = await prisma.review.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!review) throw new HttpError(404, "Review not found");
    await prisma.reviewLike.upsert({
      where: { userId_reviewId: { userId: req.userId!, reviewId: review.id } },
      create: { userId: req.userId!, reviewId: review.id },
      update: {},
    });
    const likeCount = await prisma.reviewLike.count({ where: { reviewId: review.id } });
    res.json({ likeCount, likedByMe: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/reviews/:id/like — idempotent.
reviewsRouter.delete("/:id/like", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    await prisma.reviewLike.deleteMany({ where: { userId: req.userId!, reviewId: req.params.id } });
    const likeCount = await prisma.reviewLike.count({ where: { reviewId: req.params.id } });
    res.json({ likeCount, likedByMe: false });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Threaded comments — one nesting level, soft delete.
// ---------------------------------------------------------------------------

const createCommentSchema = z.object({
  content: z.string().min(1).max(5_000),
  parentId: z.string().optional(),
});

// A soft-deleted comment keeps its row (so replies stay attached) but its
// content never leaves the server.
function toCommentDTO(c: {
  id: string;
  parentId: string | null;
  content: string;
  createdAt: Date;
  deletedAt: Date | null;
  user: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
}) {
  const deleted = c.deletedAt !== null;
  return {
    id: c.id,
    parentId: c.parentId,
    content: deleted ? null : c.content,
    deleted,
    user: deleted ? null : c.user,
    createdAt: c.createdAt,
  };
}

// GET /api/reviews/:id/comments — top-level comments with their replies.
reviewsRouter.get("/:id/comments", async (req, res, next) => {
  try {
    const review = await prisma.review.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!review) throw new HttpError(404, "Review not found");

    const comments = await prisma.reviewComment.findMany({
      where: { reviewId: review.id },
      orderBy: { createdAt: "asc" },
      include: { user: publicUser },
    });

    const topLevel = comments.filter((c) => c.parentId === null);
    const byParent = new Map<string, typeof comments>();
    for (const c of comments) {
      if (c.parentId) {
        const list = byParent.get(c.parentId) ?? [];
        list.push(c);
        byParent.set(c.parentId, list);
      }
    }
    // Hide soft-deleted comments that have no replies; keep them as
    // placeholders when a thread hangs off them.
    const thread = topLevel
      .filter((c) => c.deletedAt === null || (byParent.get(c.id)?.length ?? 0) > 0)
      .map((c) => ({
        ...toCommentDTO(c),
        replies: (byParent.get(c.id) ?? []).filter((r) => r.deletedAt === null).map(toCommentDTO),
      }));
    res.json({ comments: thread });
  } catch (err) {
    next(err);
  }
});

// POST /api/reviews/:id/comments — comment, or reply to a top-level comment.
reviewsRouter.post(
  "/:id/comments",
  requireAuth,
  validate(createCommentSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const review = await prisma.review.findUnique({ where: { id: req.params.id }, select: { id: true } });
      if (!review) throw new HttpError(404, "Review not found");

      if (req.body.parentId) {
        const parent = await prisma.reviewComment.findUnique({ where: { id: req.body.parentId } });
        if (!parent || parent.reviewId !== review.id) throw new HttpError(404, "Parent comment not found");
        // One nesting level only: you can reply to a comment, not to a reply.
        if (parent.parentId !== null) {
          throw new HttpError(422, "Replies can't be nested further — reply to the top-level comment");
        }
      }

      const comment = await prisma.reviewComment.create({
        data: {
          reviewId: review.id,
          userId: req.userId!,
          parentId: req.body.parentId ?? null,
          content: req.body.content,
        },
        include: { user: publicUser },
      });
      await emitActivity({ userId: req.userId!, type: "COMMENT", targetId: comment.id });
      res.status(201).json({ comment: toCommentDTO(comment) });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// Comment edit/delete live under /api/comments (they're review-independent ids).
// ---------------------------------------------------------------------------

export const commentsRouter = Router();

const updateCommentSchema = z.object({ content: z.string().min(1).max(5_000) });

// PATCH /api/comments/:id — edit my comment.
commentsRouter.patch("/:id", requireAuth, validate(updateCommentSchema), async (req: AuthedRequest, res, next) => {
  try {
    const comment = await prisma.reviewComment.findUnique({ where: { id: req.params.id } });
    if (!comment || comment.deletedAt) throw new HttpError(404, "Comment not found");
    if (comment.userId !== req.userId) throw new HttpError(403, "Not your comment");
    const updated = await prisma.reviewComment.update({
      where: { id: comment.id },
      data: { content: req.body.content },
      include: { user: publicUser },
    });
    res.json({ comment: toCommentDTO(updated) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/comments/:id — soft delete, so threads don't collapse.
commentsRouter.delete("/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const comment = await prisma.reviewComment.findUnique({ where: { id: req.params.id } });
    if (!comment || comment.deletedAt) throw new HttpError(404, "Comment not found");
    if (comment.userId !== req.userId) throw new HttpError(403, "Not your comment");
    await prisma.reviewComment.update({
      where: { id: comment.id },
      data: { deletedAt: new Date() },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
