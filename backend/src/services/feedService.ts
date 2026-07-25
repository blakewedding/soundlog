// Hydrate raw Activity rows into rich feed items, batching every lookup. The
// shapes match the shared FeedItem/FeedReview so the client renders them with
// its existing components (ReviewCard, StarRating, list/release cards).
//
// Privacy: private lists never surface — LIST_CREATE / LIST_ITEM_ADD activities
// for a private list are dropped here (defence in depth; they aren't emitted in
// the first place). Deleted targets are dropped too.
import type { Activity } from "@prisma/client";
import { prisma } from "../config/database.js";

export const publicUserSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
} as const;

const feedReviewInclude = {
  user: { select: publicUserSelect },
  release: { select: { id: true, title: true, artistName: true, coverUrl: true, coverColor: true } },
  _count: { select: { likes: true, comments: true } },
} as const;

type ReviewRow = Awaited<ReturnType<typeof fetchReviews>>[number];
function fetchReviews(ids: string[]) {
  return prisma.review.findMany({ where: { id: { in: ids } }, include: feedReviewInclude });
}

/** Which of these reviews the viewer has liked (empty when anonymous). */
export async function likedReviewIds(viewerId: string | undefined, reviewIds: string[]): Promise<Set<string>> {
  if (!viewerId || reviewIds.length === 0) return new Set();
  const likes = await prisma.reviewLike.findMany({
    where: { userId: viewerId, reviewId: { in: reviewIds } },
    select: { reviewId: true },
  });
  return new Set(likes.map((l) => l.reviewId));
}

export function toFeedReview(rv: ReviewRow, likedByMe: boolean) {
  return {
    id: rv.id,
    user: rv.user,
    release: rv.release,
    content: rv.content,
    rating: rv.rating,
    containsSpoilers: rv.containsSpoilers,
    likeCount: rv._count.likes,
    commentCount: rv._count.comments,
    likedByMe,
    createdAt: rv.createdAt.toISOString(),
  };
}

// Popular reviews: likes drive the ranking (the feed is "led by the most-liked
// review"); a bounded recency bonus keeps fresh writing surfacing and breaks
// ties among equally-liked reviews. A brand-new review scores just under a
// single like, so it still appears without displacing genuinely popular ones.
const POPULAR_HALF_LIFE_DAYS = 7;
const DAY_MS = 86_400_000;
const POPULAR_CANDIDATES = 200; // cap the set we score in memory

export async function getPopularReviews(viewerId: string | undefined, limit = 20) {
  const reviews = await prisma.review.findMany({
    include: feedReviewInclude,
    orderBy: { createdAt: "desc" },
    take: POPULAR_CANDIDATES,
  });
  const now = Date.now();
  const scored = reviews.map((rv) => {
    const ageDays = (now - rv.createdAt.getTime()) / DAY_MS;
    const recency = Math.pow(0.5, ageDays / POPULAR_HALF_LIFE_DAYS); // (0, 1]
    return { rv, score: rv._count.likes + recency };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit).map((s) => s.rv);
  const liked = await likedReviewIds(
    viewerId,
    top.map((r) => r.id)
  );
  return top.map((rv) => toFeedReview(rv, liked.has(rv.id)));
}

const releaseSelect = {
  id: true,
  title: true,
  artistName: true,
  coverUrl: true,
  coverColor: true,
  type: true,
} as const;

export async function hydrateActivities(activities: Activity[], viewerId?: string) {
  const releaseIds = new Set<string>();
  const reviewIds = new Set<string>();
  const listIds = new Set<string>();
  const commentIds = new Set<string>();
  const followTargetIds = new Set<string>();
  for (const a of activities) {
    if (a.type === "LOG" || a.type === "RATING") releaseIds.add(a.targetId);
    else if (a.type === "REVIEW") reviewIds.add(a.targetId);
    else if (a.type === "LIST_CREATE" || a.type === "LIST_ITEM_ADD") listIds.add(a.targetId);
    else if (a.type === "COMMENT") commentIds.add(a.targetId);
    else if (a.type === "FOLLOW") followTargetIds.add(a.targetId);
  }
  const actorIds = [...new Set(activities.map((a) => a.userId))];
  const ratingActs = activities.filter((a) => a.type === "RATING");

  const [actors, releases, reviews, lists, comments, followTargets, ratings] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: actorIds } }, select: publicUserSelect }),
    prisma.release.findMany({ where: { id: { in: [...releaseIds] } }, select: releaseSelect }),
    fetchReviews([...reviewIds]),
    prisma.list.findMany({
      where: { id: { in: [...listIds] } },
      include: { _count: { select: { items: true } } },
    }),
    prisma.reviewComment.findMany({
      where: { id: { in: [...commentIds] } },
      select: { id: true, content: true, reviewId: true, deletedAt: true },
    }),
    prisma.user.findMany({ where: { id: { in: [...followTargetIds] } }, select: publicUserSelect }),
    ratingActs.length
      ? prisma.rating.findMany({
          where: { OR: ratingActs.map((a) => ({ userId: a.userId, releaseId: a.targetId })) },
          select: { userId: true, releaseId: true, value: true },
        })
      : Promise.resolve([]),
  ]);

  const liked = await likedReviewIds(viewerId, [...reviewIds]);

  const actorMap = new Map(actors.map((u) => [u.id, u]));
  const releaseMap = new Map(releases.map((r) => [r.id, r]));
  const reviewMap = new Map(reviews.map((r) => [r.id, r]));
  const listMap = new Map(lists.map((l) => [l.id, l]));
  const commentMap = new Map(comments.map((c) => [c.id, c]));
  const followMap = new Map(followTargets.map((u) => [u.id, u]));
  const ratingMap = new Map(ratings.map((r) => [`${r.userId}:${r.releaseId}`, r.value]));

  const items = [];
  for (const a of activities) {
    const user = actorMap.get(a.userId);
    if (!user) continue;
    const base = { id: a.id, type: a.type, createdAt: a.createdAt.toISOString(), user };

    if (a.type === "LOG") {
      const release = releaseMap.get(a.targetId);
      if (release) items.push({ ...base, release });
    } else if (a.type === "RATING") {
      const release = releaseMap.get(a.targetId);
      if (release) items.push({ ...base, release, rating: ratingMap.get(`${a.userId}:${a.targetId}`) ?? null });
    } else if (a.type === "REVIEW") {
      const rv = reviewMap.get(a.targetId);
      if (rv) items.push({ ...base, review: toFeedReview(rv, liked.has(rv.id)) });
    } else if (a.type === "LIST_CREATE" || a.type === "LIST_ITEM_ADD") {
      const list = listMap.get(a.targetId);
      if (list && list.isPublic) items.push({ ...base, list: { id: list.id, title: list.title, itemCount: list._count.items } });
    } else if (a.type === "COMMENT") {
      const c = commentMap.get(a.targetId);
      if (c && !c.deletedAt) items.push({ ...base, comment: { content: c.content, reviewId: c.reviewId } });
    } else if (a.type === "FOLLOW") {
      const targetUser = followMap.get(a.targetId);
      if (targetUser) items.push({ ...base, targetUser });
    }
  }
  return items;
}
