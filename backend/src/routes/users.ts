import { Router } from "express";
import { prisma } from "../config/database.js";
import { requireAuth, optionalAuth, type AuthedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { emitActivity } from "../jobs/activityQueue.js";
import {
  publicUserSelect,
  toFeedReview,
  hydrateActivities,
  likedReviewIds,
} from "../services/feedService.js";
import { getSimilarListeners, invalidateSimilar } from "../services/similarService.js";

export const usersRouter = Router();

const feedReviewInclude = {
  user: { select: publicUserSelect },
  release: { select: { id: true, title: true, artistName: true, coverUrl: true, coverColor: true } },
  _count: { select: { likes: true, comments: true } },
} as const;
const profileReleaseSelect = {
  id: true,
  title: true,
  artistName: true,
  coverUrl: true,
  coverColor: true,
  type: true,
} as const;

async function userByUsername(username: string) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw new HttpError(404, "User not found");
  return user;
}

function parseCursor(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Follow / unfollow
// ---------------------------------------------------------------------------

usersRouter.post("/:username/follow", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const target = await userByUsername(req.params.username);
    if (target.id === req.userId) throw new HttpError(400, "You can't follow yourself");

    const existing = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: req.userId!, followingId: target.id } },
    });
    if (!existing) {
      await prisma.follow.create({ data: { followerId: req.userId!, followingId: target.id } });
      await emitActivity({ userId: req.userId!, type: "FOLLOW", targetId: target.id });
      await invalidateSimilar(req.userId!); // the followed user should drop out of suggestions
    }
    const followerCount = await prisma.follow.count({ where: { followingId: target.id } });
    res.json({ following: true, followerCount });
  } catch (err) {
    next(err);
  }
});

usersRouter.delete("/:username/follow", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const target = await userByUsername(req.params.username);
    await prisma.follow.deleteMany({ where: { followerId: req.userId!, followingId: target.id } });
    await invalidateSimilar(req.userId!); // they may reappear as a suggestion
    const followerCount = await prisma.follow.count({ where: { followingId: target.id } });
    res.json({ following: false, followerCount });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

usersRouter.get("/:username", optionalAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await userByUsername(req.params.username);
    const isMe = req.userId === user.id;
    const listWhere = isMe ? { userId: user.id } : { userId: user.id, isPublic: true };

    const [followers, following, reviews, ratings, lists, logs, follow] = await Promise.all([
      prisma.follow.count({ where: { followingId: user.id } }),
      prisma.follow.count({ where: { followerId: user.id } }),
      prisma.review.count({ where: { userId: user.id } }),
      prisma.rating.count({ where: { userId: user.id } }),
      prisma.list.count({ where: listWhere }),
      prisma.log.count({ where: { userId: user.id } }),
      req.userId
        ? prisma.follow.findUnique({
            where: { followerId_followingId: { followerId: req.userId, followingId: user.id } },
          })
        : Promise.resolve(null),
    ]);

    res.json({
      profile: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
        avatarUrl: user.avatarUrl,
        // Public, like the bio — these are links a person chose to publish on
        // their profile. Validated https-only on the way in (see
        // profileLinksSchema in routes/me.ts), which is what makes them safe to
        // render as anchors: `javascript:` parses perfectly well as a URL and
        // would otherwise reach an href.
        links: user.links ?? [],
        createdAt: user.createdAt.toISOString(),
        counts: { followers, following, reviews, ratings, lists, logs },
        isFollowing: Boolean(follow),
        isMe,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Followers / following — lists of users, each with the viewer's follow state.
async function followEdgeUsers(userIds: string[], viewerId?: string) {
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: publicUserSelect });
  const followedByViewer = viewerId
    ? new Set(
        (
          await prisma.follow.findMany({
            where: { followerId: viewerId, followingId: { in: userIds } },
            select: { followingId: true },
          })
        ).map((f) => f.followingId)
      )
    : new Set<string>();
  return users.map((u) => ({ ...u, isFollowing: followedByViewer.has(u.id) }));
}

usersRouter.get("/:username/followers", optionalAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await userByUsername(req.params.username);
    const edges = await prisma.follow.findMany({
      where: { followingId: user.id },
      orderBy: { createdAt: "desc" },
      select: { followerId: true },
    });
    res.json({ users: await followEdgeUsers(edges.map((e) => e.followerId), req.userId) });
  } catch (err) {
    next(err);
  }
});

usersRouter.get("/:username/following", optionalAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await userByUsername(req.params.username);
    const edges = await prisma.follow.findMany({
      where: { followerId: user.id },
      orderBy: { createdAt: "desc" },
      select: { followingId: true },
    });
    res.json({ users: await followEdgeUsers(edges.map((e) => e.followingId), req.userId) });
  } catch (err) {
    next(err);
  }
});

// Similar listeners — members whose highly-rated releases overlap this user's,
// excluding those the user already follows. Cached server-side (daily TTL). When
// a viewer is present, each result carries the viewer's own follow state.
usersRouter.get("/:username/similar", optionalAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await userByUsername(req.params.username);
    const similar = await getSimilarListeners(user.id);
    const followedByViewer = req.userId
      ? new Set(
          (
            await prisma.follow.findMany({
              where: { followerId: req.userId, followingId: { in: similar.map((s) => s.id) } },
              select: { followingId: true },
            })
          ).map((f) => f.followingId)
        )
      : new Set<string>();
    res.json({
      listeners: similar.map((s) => ({ ...s, isFollowing: followedByViewer.has(s.id) })),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Profile tabs
// ---------------------------------------------------------------------------

usersRouter.get("/:username/activity", optionalAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await userByUsername(req.params.username);
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const cursor = parseCursor(req.query.cursor);
    const activities = await prisma.activity.findMany({
      where: { userId: user.id, ...(cursor ? { createdAt: { lt: cursor } } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const items = await hydrateActivities(activities, req.userId);
    const nextCursor =
      activities.length === limit ? activities[activities.length - 1].createdAt.toISOString() : null;
    res.json({ items, nextCursor });
  } catch (err) {
    next(err);
  }
});

usersRouter.get("/:username/reviews", optionalAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await userByUsername(req.params.username);
    const reviews = await prisma.review.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(req.query.limit) || 25, 50),
      include: feedReviewInclude,
    });
    const liked = await likedReviewIds(req.userId, reviews.map((r) => r.id));
    res.json({ reviews: reviews.map((r) => toFeedReview(r, liked.has(r.id))) });
  } catch (err) {
    next(err);
  }
});

usersRouter.get("/:username/ratings", async (req, res, next) => {
  try {
    const user = await userByUsername(req.params.username);
    const ratings = await prisma.rating.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: Math.min(Number(req.query.limit) || 40, 100),
      include: { release: { select: profileReleaseSelect } },
    });
    res.json({
      ratings: ratings.map((r) => ({ value: r.value, updatedAt: r.updatedAt.toISOString(), release: r.release })),
    });
  } catch (err) {
    next(err);
  }
});

// Lists tab — private lists hidden from everyone but the owner.
usersRouter.get("/:username/lists", optionalAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await userByUsername(req.params.username);
    const isMe = req.userId === user.id;
    const lists = await prisma.list.findMany({
      where: isMe ? { userId: user.id } : { userId: user.id, isPublic: true },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { items: true } } },
    });
    res.json({
      lists: lists.map((l) => ({
        id: l.id,
        title: l.title,
        description: l.description,
        isRanked: l.isRanked,
        isPublic: l.isPublic,
        itemCount: l._count.items,
      })),
    });
  } catch (err) {
    next(err);
  }
});

usersRouter.get("/:username/diary", async (req, res, next) => {
  try {
    const user = await userByUsername(req.params.username);
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const cursor = parseCursor(req.query.cursor);
    const logs = await prisma.log.findMany({
      where: { userId: user.id, ...(cursor ? { listenedAt: { lt: cursor } } : {}) },
      orderBy: { listenedAt: "desc" },
      take: limit,
      include: { release: { select: profileReleaseSelect } },
    });
    const releaseIds = [...new Set(logs.map((l) => l.releaseId))];
    const ratings = await prisma.rating.findMany({
      where: { userId: user.id, releaseId: { in: releaseIds } },
      select: { releaseId: true, value: true },
    });
    const ratingByRelease = new Map(ratings.map((r) => [r.releaseId, r.value]));
    const nextCursor = logs.length === limit ? logs[logs.length - 1].listenedAt.toISOString() : null;
    res.json({
      logs: logs.map((l) => ({
        id: l.id,
        listenedAt: l.listenedAt.toISOString(),
        isRelisten: l.isRelisten,
        myRating: ratingByRelease.get(l.releaseId) ?? null,
        release: l.release,
      })),
      nextCursor,
    });
  } catch (err) {
    next(err);
  }
});
