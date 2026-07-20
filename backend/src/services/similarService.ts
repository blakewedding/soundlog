// "Listeners like you" — members whose taste overlaps a user's, measured by
// releases both rated highly (>= HIGH). Ranked by overlap count, excluding the
// user and anyone they already follow. The computation touches every co-rater,
// so results are cached in Redis for a day (taste graphs move slowly).
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { cached } from "./cache.js";
import { publicUserSelect } from "./feedService.js";

const HIGH = 4; // a "loved" rating: 4★ and up
const DAY = 60 * 60 * 24;
const MAX_RESULTS = 8;

export interface SimilarListener {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  sharedCount: number; // releases both rated >= HIGH
}

async function computeSimilar(userId: string): Promise<SimilarListener[]> {
  // The user's own loved releases.
  const mine = await prisma.rating.findMany({
    where: { userId, value: { gte: HIGH } },
    select: { releaseId: true },
  });
  const releaseIds = mine.map((r) => r.releaseId);
  if (releaseIds.length === 0) return [];

  // Everyone else who also loved any of those releases.
  const overlaps = await prisma.rating.findMany({
    where: { releaseId: { in: releaseIds }, value: { gte: HIGH }, userId: { not: userId } },
    select: { userId: true },
  });
  const sharedByUser = new Map<string, number>();
  for (const o of overlaps) sharedByUser.set(o.userId, (sharedByUser.get(o.userId) ?? 0) + 1);
  if (sharedByUser.size === 0) return [];

  // Exclude people the user already follows — recommend the undiscovered.
  const following = await prisma.follow.findMany({
    where: { followerId: userId },
    select: { followingId: true },
  });
  for (const f of following) sharedByUser.delete(f.followingId);
  if (sharedByUser.size === 0) return [];

  const ranked = [...sharedByUser.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_RESULTS);
  const users = await prisma.user.findMany({
    where: { id: { in: ranked.map(([id]) => id) } },
    select: publicUserSelect,
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  return ranked
    .map(([id, sharedCount]) => {
      const u = userMap.get(id);
      return u ? { ...u, sharedCount } : null;
    })
    .filter((x): x is SimilarListener => x !== null);
}

/** Similar listeners for a user, cached for a day. */
export function getSimilarListeners(userId: string): Promise<SimilarListener[]> {
  return cached(`similar:${userId}`, DAY, () => computeSimilar(userId));
}

/** Drop a user's cached suggestions — call when their follow graph changes. */
export async function invalidateSimilar(userId: string): Promise<void> {
  await redis.del(`similar:${userId}`);
}
