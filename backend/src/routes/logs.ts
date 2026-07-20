import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/database.js";
import { validate } from "../middleware/validate.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { emitActivity } from "../jobs/activityQueue.js";

export const logsRouter = Router();

// Diary entries. Multiple logs per release per user are allowed — relistens
// create new rows (the Letterboxd diary model), never update old ones.
const createLogSchema = z.object({
  releaseId: z.string().min(1),
  listenedAt: z.string().datetime().optional(),
  isRelisten: z.boolean().optional(),
});

const updateLogSchema = z.object({
  listenedAt: z.string().datetime().optional(),
  isRelisten: z.boolean().optional(),
});

// POST /api/logs — add a diary entry.
logsRouter.post("/", requireAuth, validate(createLogSchema), async (req: AuthedRequest, res, next) => {
  try {
    const release = await prisma.release.findUnique({
      where: { id: req.body.releaseId },
      select: { id: true },
    });
    if (!release) throw new HttpError(404, "Release not found");

    // A second log of the same release is a relisten unless the client says otherwise.
    const priorCount = await prisma.log.count({
      where: { userId: req.userId!, releaseId: req.body.releaseId },
    });
    const log = await prisma.log.create({
      data: {
        userId: req.userId!,
        releaseId: req.body.releaseId,
        listenedAt: req.body.listenedAt ? new Date(req.body.listenedAt) : undefined,
        isRelisten: req.body.isRelisten ?? priorCount > 0,
      },
    });
    await emitActivity({ userId: req.userId!, type: "LOG", targetId: log.releaseId });
    res.status(201).json({ log });
  } catch (err) {
    next(err);
  }
});

// GET /api/logs/me — my diary, newest listens first, with my rating attached.
// Cursor pagination: pass ?cursor=<ISO listenedAt> to fetch the next page.
logsRouter.get("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const cursor = typeof req.query.cursor === "string" ? new Date(req.query.cursor) : null;
    const validCursor = cursor && !Number.isNaN(cursor.getTime()) ? cursor : null;
    const logs = await prisma.log.findMany({
      where: { userId: req.userId!, ...(validCursor ? { listenedAt: { lt: validCursor } } : {}) },
      orderBy: { listenedAt: "desc" },
      take: limit,
      include: {
        release: { select: { id: true, title: true, artistName: true, coverUrl: true, type: true } },
      },
    });

    // One batched lookup for my ratings across the page's releases.
    const releaseIds = [...new Set(logs.map((l) => l.releaseId))];
    const ratings = await prisma.rating.findMany({
      where: { userId: req.userId!, releaseId: { in: releaseIds } },
      select: { releaseId: true, value: true },
    });
    const ratingByRelease = new Map(ratings.map((r) => [r.releaseId, r.value]));

    // More may exist only when we filled the page.
    const nextCursor = logs.length === limit ? logs[logs.length - 1].listenedAt.toISOString() : null;
    res.json({
      logs: logs.map((l) => ({ ...l, myRating: ratingByRelease.get(l.releaseId) ?? null })),
      nextCursor,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/logs/:id — edit my diary entry (date / relisten flag).
logsRouter.patch("/:id", requireAuth, validate(updateLogSchema), async (req: AuthedRequest, res, next) => {
  try {
    const log = await prisma.log.findUnique({ where: { id: req.params.id } });
    if (!log) throw new HttpError(404, "Log not found");
    if (log.userId !== req.userId) throw new HttpError(403, "Not your log");

    const updated = await prisma.log.update({
      where: { id: log.id },
      data: {
        listenedAt: req.body.listenedAt ? new Date(req.body.listenedAt) : undefined,
        isRelisten: req.body.isRelisten,
      },
    });
    res.json({ log: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/logs/:id — remove my diary entry.
logsRouter.delete("/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const log = await prisma.log.findUnique({ where: { id: req.params.id } });
    if (!log) throw new HttpError(404, "Log not found");
    if (log.userId !== req.userId) throw new HttpError(403, "Not your log");
    await prisma.log.delete({ where: { id: log.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
