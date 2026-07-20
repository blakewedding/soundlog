import type { QueryClient } from "@tanstack/react-query";

// A review can appear in many cached queries at once — the home feed, profile
// activity/reviews tabs, recent reviews, and a release's review list. To keep
// like/comment counts from disagreeing across surfaces, mutations patch EVERY
// cached query in place rather than each surface tracking its own local state.

interface ReviewLike {
  id: string;
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
  content?: string;
  rating?: number | null;
  containsSpoilers?: boolean;
}

type ReviewPatch = Partial<ReviewLike> | ((r: ReviewLike) => Partial<ReviewLike>);

function applyPatch<T extends ReviewLike>(r: T, patch: ReviewPatch): T {
  const delta = typeof patch === "function" ? patch(r) : patch;
  return { ...r, ...delta };
}

/**
 * Return a new copy of a query's data with any review matching `reviewId`
 * patched, or the SAME reference when nothing changed (so React Query doesn't
 * re-render unaffected queries). Handles the two container shapes we cache:
 * Paginated feed items ({ items: [{ review }] }) and review lists ({ reviews }).
 */
export function patchReviewInData(data: unknown, reviewId: string, patch: ReviewPatch): unknown {
  if (!data || typeof data !== "object") return data;

  const obj = data as { items?: Array<{ review?: ReviewLike | null }>; reviews?: ReviewLike[] };

  if (Array.isArray(obj.items)) {
    let changed = false;
    const items = obj.items.map((it) => {
      if (it?.review && it.review.id === reviewId) {
        changed = true;
        return { ...it, review: applyPatch(it.review, patch) };
      }
      return it;
    });
    return changed ? { ...obj, items } : data;
  }

  if (Array.isArray(obj.reviews)) {
    let changed = false;
    const reviews = obj.reviews.map((r) => {
      if (r?.id === reviewId) {
        changed = true;
        return applyPatch(r, patch);
      }
      return r;
    });
    return changed ? { ...obj, reviews } : data;
  }

  return data;
}

/** Patch a review across every cached query that contains it. */
export function patchReviewEverywhere(qc: QueryClient, reviewId: string, patch: ReviewPatch): void {
  qc.setQueriesData({}, (old) => patchReviewInData(old, reviewId, patch));
}
