/**
 * What `profileVisibility = PRIVATE` actually means, in one place.
 *
 * ## The rule: PRIVATE means you do not BROADCAST
 *
 * Hidden from everyone but the owner:
 *
 *  - the profile page and every tab hanging off it (activity, reviews,
 *    ratings, lists, diary, followers, following, similar)
 *  - presence in member search
 *  - activity in other people's feeds
 *  - reviews in the popular-reviews discovery feed
 *
 * NOT hidden — and the settings copy says so plainly:
 *
 *  - a review still sits on the release page it was written about
 *  - a public list is still public
 *
 * The line is **discovery versus context**. A private account should not be
 * browsable or discoverable as a person; it does not retroactively unpublish
 * things the person deliberately posted onto shared pages, where other people
 * have already replied to and liked them. The field is named
 * `profileVisibility`, not `accountPrivacy`, and promising the second while
 * implementing the first is the kind of gap that only surfaces when it matters.
 *
 * ## Why the Elasticsearch side DELETES rather than filters
 *
 * §5 makes Postgres truth and Elasticsearch a rebuildable index — which means
 * the index is a SECOND place the same fact lives, and the one that can answer
 * a question nobody thought to guard. A query-time filter has to be remembered
 * at every call site; deleting the document means the index physically cannot
 * answer, whatever anyone asks it later. That follows `indexList`, which
 * already de-indexes a list the moment it stops being public.
 */
import type { ProfileVisibility } from "@prisma/client";

export interface VisibilityOwner {
  id: string;
  profileVisibility: ProfileVisibility;
}

/**
 * The Prisma filter every DISCOVERY query must carry.
 *
 * Spread into a `where` — `where: { user: discoverableUser }` for a query over
 * content, or `where: { ...discoverableUser, id: { in: ids } }` for one over
 * members directly.
 *
 * This exists because of a leak that reached production. Enforcement was done
 * surface-by-surface from a written list, the list was not exhaustive, and
 * `/api/reviews/recent` — the logged-out home page's review feed, full text
 * included — was not on it. A private member's review was readable by anyone,
 * immediately and indefinitely, while the profile page, member search and the
 * activity feed were all correctly sealed.
 *
 * `routes/users.ts` already had the right shape and I did not carry it across
 * service boundaries: one chokepoint, because nine call sites each remembering
 * a rule is nine chances to forget it. This is that chokepoint for the queries.
 *
 * Deliberately NOT viewer-aware. Every caller is a shared, cacheable, or
 * broadcast surface where the answer must be the same for everybody — see the
 * note on `getPopularReviews`, whose anonymous response Varnish holds for five
 * minutes. A per-viewer discovery feed would make that cache entry a lie.
 */
export const discoverableUser = { profileVisibility: "PUBLIC" } as const;

/** Is this profile hidden from `viewerId`? The owner always sees their own. */
export function isHiddenFrom(owner: VisibilityOwner, viewerId: string | undefined): boolean {
  if (owner.profileVisibility !== "PRIVATE") return false;
  return owner.id !== viewerId;
}

/** True when the viewer may read the profile and everything hanging off it. */
export function canViewProfile(owner: VisibilityOwner, viewerId: string | undefined): boolean {
  return !isHiddenFrom(owner, viewerId);
}

/**
 * Of `userIds`, the ones whose activity must not be broadcast to `viewerId`.
 *
 * Returned as a Set of ids to EXCLUDE rather than a list to include, because
 * the failure modes are not symmetric: forgetting to apply an exclusion set
 * leaks, and that is loud in a test, whereas an inclusion list that silently
 * drops someone looks like an empty feed and nobody files a bug.
 */
export function hiddenActorIds(
  owners: readonly VisibilityOwner[],
  viewerId: string | undefined
): Set<string> {
  return new Set(owners.filter((o) => isHiddenFrom(o, viewerId)).map((o) => o.id));
}
