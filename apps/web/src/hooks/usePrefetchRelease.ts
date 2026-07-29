import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { useAuth } from "../contexts/AuthContext";

/**
 * How long a hover-prefetched release stays fresh. Long enough that moving the
 * cursor across a grid doesn't re-request the same release repeatedly, short
 * enough that the page still reconciles on arrival.
 */
const PREFETCH_STALE_MS = 30_000;

/**
 * A ref is safe to prefetch only if it is already in our catalog.
 *
 * `GET /api/releases/<source>:<id>` is seed-on-first-access: it CREATES a
 * Release row and spends a slot on the process-wide 1 req/s MusicBrainz
 * throttle (CLAUDE.md §7). Prefetching one of those on hover would let a mouse
 * moving across a search grid silently seed a dozen releases and exhaust the
 * throttle that first-access lookups depend on — writes and rate-limit spend
 * triggered by an action the user never committed to.
 *
 * **This now governs ARTISTS too.** 6.2d gave artist search the same cold-entity
 * contract — `GET /api/artists/mb:<mbid>` materializes an Artist row on open —
 * so an artist result is exactly as unsafe to speculatively fetch as a release
 * result, for exactly the same reason. The rule is stated once here rather than
 * reimplemented per entity, because the failure it prevents is silent: nothing
 * errors, the catalog simply fills with rows nobody asked for.
 *
 * Internal ids carry no colon; every unseeded ref is "<source>:<sourceId>".
 * Anything colon-shaped is refused, which covers both entities and any entity
 * added later without needing this function to learn about it.
 */
export function isPrefetchableRef(ref: string): boolean {
  return ref.length > 0 && !ref.includes(":");
}

/**
 * Returns a hover handler that warms the release page's query. The key matches
 * Release.tsx exactly — ["release", id, user?.id] — so the page reads the
 * prefetched data instead of showing its skeleton.
 */
export function usePrefetchRelease() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useCallback(
    (ref: string) => {
      if (!isPrefetchableRef(ref)) return;
      queryClient.prefetchQuery({
        queryKey: ["release", ref, user?.id],
        queryFn: () => api.getRelease(ref),
        staleTime: PREFETCH_STALE_MS,
      });
    },
    [queryClient, user?.id]
  );
}
