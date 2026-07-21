import type { QueryClient } from "@tanstack/react-query";

// The sibling of reviewCache (Phase 4.1), applying the same principle to
// ratings: a release's "my rating" shows up on several cached surfaces at once —
// the release page, the diary (each entry shows your rating), and release lists.
// A rating mutation patches EVERY cached query in place so the star input can
// respond instantly without any surface disagreeing with another.

interface ReleaseLike {
  id: string;
  myRating?: number | null;
  avgRating?: number;
  ratingCount?: number;
  myLogCount?: number;
}

type ReleasePatch = Partial<ReleaseLike> | ((r: ReleaseLike) => Partial<ReleaseLike>);

function applyPatch<T extends ReleaseLike>(r: T, patch: ReleasePatch): T {
  const delta = typeof patch === "function" ? patch(r) : patch;
  return { ...r, ...delta };
}

/**
 * Return a new copy of a query's data with the matching release patched, or the
 * SAME reference when nothing changed (so React Query doesn't re-render
 * unaffected queries). Handles the three container shapes we cache:
 *   { release }            — the release detail page
 *   { releases: [...] }    — recent releases, artist/label pages
 *   { logs: [{ release, myRating }] } — the diary, where the rating sits on the
 *                            log entry rather than on the nested release
 */
export function patchReleaseInData(data: unknown, releaseId: string, patch: ReleasePatch): unknown {
  if (!data || typeof data !== "object") return data;

  const obj = data as {
    release?: ReleaseLike | null;
    releases?: ReleaseLike[];
    logs?: Array<{ myRating?: number | null; release?: { id: string } | null }>;
  };

  if (obj.release && obj.release.id === releaseId) {
    return { ...obj, release: applyPatch(obj.release, patch) };
  }

  if (Array.isArray(obj.releases)) {
    let changed = false;
    const releases = obj.releases.map((r) => {
      if (r?.id === releaseId) {
        changed = true;
        return applyPatch(r, patch);
      }
      return r;
    });
    return changed ? { ...obj, releases } : data;
  }

  if (Array.isArray(obj.logs)) {
    let changed = false;
    const logs = obj.logs.map((log) => {
      if (log?.release?.id !== releaseId) return log;
      // Only `myRating` is meaningful on a diary entry.
      const delta = applyPatch({ id: releaseId, myRating: log.myRating ?? null }, patch);
      if (delta.myRating === log.myRating) return log;
      changed = true;
      return { ...log, myRating: delta.myRating ?? null };
    });
    return changed ? { ...obj, logs } : data;
  }

  return data;
}

/** Patch a release across every cached query that contains it. */
export function patchReleaseEverywhere(
  qc: QueryClient,
  releaseId: string,
  patch: ReleasePatch
): void {
  qc.setQueriesData({}, (old) => patchReleaseInData(old, releaseId, patch));
}
