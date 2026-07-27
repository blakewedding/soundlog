import type { QueryClient } from "@tanstack/react-query";

// A user's avatar and display name appear in far more cached queries than the
// one on screen: the home feed, profile activity/reviews tabs, recent and
// popular reviews, comment threads, follower and following lists, similar
// listeners, and list pages. §6 requires a mutation to invalidate EVERY query
// that renders the changed data — otherwise you change your picture, the
// settings page updates, and your own face on your own reviews stays stale
// until something else happens to refetch.
//
// Patched in place rather than invalidated wholesale, for the same reason
// reviewCache.ts patches: blanket invalidation refetches the entire feed to
// change one <img src>, and does it while the user is looking at it.

/** The user-shaped object embedded across cached payloads. */
interface UserLike {
  id: string;
  username?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

type UserPatch = Partial<Omit<UserLike, "id">>;

function isUserLike(value: unknown): value is UserLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    // `avatarUrl` or `username` present distinguishes a user object from the
    // many other things in these payloads that have an `id` — a release, a
    // review, a list. Matching on `id` alone would rewrite the wrong rows.
    ("avatarUrl" in value || "username" in value)
  );
}

/**
 * Walk a cached payload and patch every embedded user matching `userId`.
 *
 * A structural walk rather than one branch per container shape. The review
 * cache can enumerate its shapes because a review appears in three known
 * places; a user appears inside feed items, reviews, comments, list owners,
 * follower rows and similar-listener cards, and that list grows every time a
 * surface is added. A walk that misses nothing is the only version of this that
 * stays correct without being revisited.
 *
 * Returns the SAME reference when nothing changed, so React Query does not
 * re-render queries that do not contain this user.
 */
export function patchUserInData(data: unknown, userId: string, patch: UserPatch): unknown {
  if (Array.isArray(data)) {
    let changed = false;
    const next = data.map((item) => {
      const patched = patchUserInData(item, userId, patch);
      if (patched !== item) changed = true;
      return patched;
    });
    return changed ? next : data;
  }

  if (typeof data !== "object" || data === null) return data;

  // The node itself.
  if (isUserLike(data) && data.id === userId) {
    return { ...data, ...patch };
  }

  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const patched = patchUserInData(value, userId, patch);
    if (patched !== value) changed = true;
    next[key] = patched;
  }
  return changed ? next : data;
}

/** Patch a user across every cached query that embeds them. */
export function patchUserEverywhere(qc: QueryClient, userId: string, patch: UserPatch): void {
  qc.setQueriesData({}, (old) => patchUserInData(old, userId, patch));
}
