import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/database.js";
import { validate } from "../middleware/validate.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { emitActivity } from "../jobs/activityQueue.js";

export const ratingsRouter = Router();

// Half-star scale, DB-enforced one-per-user-per-release via @@unique.
const ratingSchema = z.object({
  value: z.number().min(0.5).max(5).multipleOf(0.5),
});

// PUT /api/ratings/:releaseId — create or update my rating (upsert).
ratingsRouter.put("/:releaseId", requireAuth, validate(ratingSchema), async (req: AuthedRequest, res, next) => {
  try {
    const { releaseId } = req.params;
    const release = await prisma.release.findUnique({ where: { id: releaseId }, select: { id: true } });
    if (!release) throw new HttpError(404, "Release not found");

    const rating = await prisma.rating.upsert({
      where: { userId_releaseId: { userId: req.userId!, releaseId } },
      create: { userId: req.userId!, releaseId, value: req.body.value },
      update: { value: req.body.value },
    });
    await emitActivity({ userId: req.userId!, type: "RATING", targetId: releaseId });
    res.json({ rating: { releaseId, value: rating.value, updatedAt: rating.updatedAt } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/ratings/:releaseId — remove my rating. Idempotent.
ratingsRouter.delete("/:releaseId", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    await prisma.rating.deleteMany({ where: { userId: req.userId!, releaseId: req.params.releaseId } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
