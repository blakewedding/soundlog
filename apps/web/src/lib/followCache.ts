import type { QueryClient } from "@tanstack/react-query";

// The third sibling of reviewCache (4.1) and releaseCache (5.7), applying the
// same principle to the social graph: whether you follow someone shows up on
// several cached surfaces at once — their profile header, "listeners like you"
// on Explore and on profiles, and the followers/following tabs. A follow
// mutation patches EVERY cached query in place so the button can respond
// instantly without one surface contradicting another.
//
// Follower counts move too, and in two directions: the target gains a follower,
// and the viewer gains a following. Both are patched, because a header that
// says "12 followers" beside a button that says "Following" after you were the
// 13th is exactly the kind of disagreement this file exists to prevent.

interface FollowableUser {
  username: string;
  isFollowing?: boolean;
}

interface ProfileShape extends FollowableUser {
  counts?: { followers: number; following: number; [k: string]: number };
}

export interface FollowPatch {
  isFollowing: boolean;
  /** +1 when following, -1 when unfollowing. Applied to counts, never below 0. */
  delta: number;
}

const bump = (n: number | undefined, delta: number) => Math.max(0, (n ?? 0) + delta);

/**
 * Return a new copy of a query's data with follow state for `username` patched,
 * or the SAME reference when nothing changed (so React Query doesn't re-render
 * unaffected queries). Handles the shapes we cache:
 *   { profile }              — the profile page (isFollowing + counts.followers)
 *   { listeners: [...] }     — similar listeners
 *   { users: [...] }         — followers / following tabs
 *
 * `viewerUsername` is optional and only used to move the viewer's own
 * `counts.following` when their profile happens to be cached.
 */
export function patchFollowInData(
  data: unknown,
  username: string,
  patch: FollowPatch,
  viewerUsername?: string
): unknown {
  if (!data || typeof data !== "object") return data;

  const obj = data as {
    profile?: ProfileShape | null;
    listeners?: FollowableUser[];
    users?: FollowableUser[];
  };

  if (obj.profile) {
    const p = obj.profile;
    // The followed user's profile: flip the flag and move their follower count.
    if (p.username === username) {
      return {
        ...obj,
        profile: {
          ...p,
          isFollowing: patch.isFollowing,
          ...(p.counts ? { counts: { ...p.counts, followers: bump(p.counts.followers, patch.delta) } } : {}),
        },
      };
    }
    // The viewer's own profile: only their "following" count moved.
    if (viewerUsername && p.username === viewerUsername && p.counts) {
      return {
        ...obj,
        profile: { ...p, counts: { ...p.counts, following: bump(p.counts.following, patch.delta) } },
      };
    }
    return data;
  }

  for (const key of ["listeners", "users"] as const) {
    const arr = obj[key];
    if (!Array.isArray(arr)) continue;
    let changed = false;
    const next = arr.map((u) => {
      if (u?.username !== username || u.isFollowing === patch.isFollowing) return u;
      changed = true;
      return { ...u, isFollowing: patch.isFollowing };
    });
    return changed ? { ...obj, [key]: next } : data;
  }

  return data;
}

/** Patch follow state for a user across every cached query that mentions them. */
export function patchFollowEverywhere(
  qc: QueryClient,
  username: string,
  patch: FollowPatch,
  viewerUsername?: string
): void {
  qc.setQueriesData({}, (old) => patchFollowInData(old, username, patch, viewerUsername));
}

/**
 * Queries whose *shape* can change on a follow — the feed gains a FOLLOW
 * activity item, and suggestions recompute — so they are refetched rather than
 * patched. Patching handles the counts; these handle the content.
 */
export const FOLLOW_SURFACES = [
  ["profile"],
  ["profile-people"],
  ["similar-listeners"],
  ["feed"],
] as const;

export function invalidateFollowSurfaces(qc: QueryClient): void {
  for (const key of FOLLOW_SURFACES) qc.invalidateQueries({ queryKey: key });
}
