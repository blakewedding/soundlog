import { Router } from "express";
import { prisma } from "../config/database.js";
import { requireAuth, optionalAuth, type AuthedRequest } from "../middleware/auth.js";
import { hydrateActivities, getPopularReviews } from "../services/feedService.js";

export const feedRouter = Router();

// GET /api/feed/popular — a likes-plus-recency-weighted review feed, open to
// everyone (the logged-out front door). Anonymous responses are cacheable by
// Varnish (likedByMe is uniformly false); authenticated responses carry a
// viewer-specific likedByMe, so they must never be shared from cache.
feedRouter.get("/popular", optionalAuth, async (req: AuthedRequest, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const reviews = await getPopularReviews(req.userId, limit);
    if (req.userId) res.set("Cache-Control", "private, no-cache");
    else res.set("Cache-Control", "public, max-age=300");
    res.json({ reviews });
  } catch (err) {
    next(err);
  }
});

// GET /api/feed?limit=&cursor=<ISO createdAt>
// Reverse-chronological activity from the people the viewer follows.
feedRouter.get("/", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const raw = typeof req.query.cursor === "string" ? new Date(req.query.cursor) : null;
    const cursor = raw && !Number.isNaN(raw.getTime()) ? raw : null;

    const following = await prisma.follow.findMany({
      where: { followerId: req.userId! },
      select: { followingId: true },
    });
    const followeeIds = following.map((f) => f.followingId);
    if (followeeIds.length === 0) return res.json({ items: [], nextCursor: null });

    const activities = await prisma.activity.findMany({
      where: { userId: { in: followeeIds }, ...(cursor ? { createdAt: { lt: cursor } } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const items = await hydrateActivities(activities, req.userId);
    // Advance the cursor past every DB row we scanned (some may hydrate to
    // nothing after privacy/deletion filtering), so paging never stalls.
    const nextCursor =
      activities.length === limit ? activities[activities.length - 1].createdAt.toISOString() : null;
    res.json({ items, nextCursor });
  } catch (err) {
    next(err);
  }
});
