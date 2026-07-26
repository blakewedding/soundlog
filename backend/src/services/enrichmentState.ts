/**
 * Whether a release is still being filled in — the thing the API could not say
 * before, and the reason a half-seeded release page looked exactly like a
 * finished one.
 *
 * ## The bug this exists to close
 *
 * Seeding writes a canonical skeleton immediately and races enrichment (artist,
 * label, genres, cover art) against a budget, answering with whatever it has
 * (Phase 5.7). Production logs show that race is lost essentially every time —
 * twelve consecutive seeds, all `servedAs: "skeleton"`. The response was a
 * perfectly ordinary 200, so the client cached it and rendered a release with no
 * label, no genres and no cover as though that were the whole truth. The only
 * thing that ever repaired the page was the rating mutation's query
 * invalidation, because it was the sole refetch trigger on the surface.
 *
 * A page rendering partial data indistinguishably from complete data is a
 * silent-failure variant (CLAUDE.md §6). Fixing it needs the server to say
 * "still working", so this module tracks that and `toReleaseDTO` reports it.
 *
 * ## Three states, and why `failed` is one of them
 *
 *  - `pending` — enrichment is in flight. The client shows loading affordances
 *                and polls.
 *  - `ready`   — nothing is running and nothing failed. What the row holds IS
 *                the answer, including legitimate absences (some releases have
 *                no label, and no cover art exists for them anywhere).
 *  - `failed`  — enrichment finished with at least one stage broken, or died
 *                outright. The data is partial and we know it. The client stops
 *                polling and shows a visible, retryable failure.
 *
 * Without `failed`, a release whose Last.fm call died would poll forever and
 * present as eternal loading — trading one silent failure for a quieter one.
 *
 * ## Scope, honestly
 *
 * This is per-process, in-memory state. One API container serves production, so
 * it is accurate there; behind two it would under-report (a poll landing on the
 * other process reads `ready`). That degrades to today's behaviour rather than
 * to a wrong answer, and the row is still correct — it is the progress signal,
 * not the data.
 */

export type EnrichmentStatus = "pending" | "ready" | "failed";

/** How long a failure keeps being reported before it lapses back to `ready`. */
const FAILURE_TTL_MS = 5 * 60_000;

/**
 * A hung enrichment is marked failed rather than left pending forever. Upstream
 * calls all carry their own timeouts, so overshooting this means something we
 * did not anticipate is stuck — and "stuck" must not read as "loading".
 */
const WATCHDOG_MS = 90_000;

export interface EnrichmentHandle {
  /** Stages that threw. Non-empty at settle time means `failed`. */
  readonly failures: string[];
  /** Record a stage failure. Called from the enrichment's own `attempt`. */
  fail(stage: string, err: unknown): void;
}

const inFlight = new Map<string, Promise<unknown>>();
const failedAt = new Map<string, number>();

/**
 * Run `work` as this release's enrichment, reporting `pending` while it runs and
 * `failed` afterwards if any stage broke.
 *
 * The returned promise resolves with the work's value and never rejects on the
 * caller's behalf differently than the work itself would — this only observes.
 */
export function trackEnrichment<T>(
  releaseId: string,
  work: (handle: EnrichmentHandle) => Promise<T>
): Promise<T> {
  const failures: string[] = [];
  const handle: EnrichmentHandle = {
    failures,
    fail(stage, err) {
      failures.push(stage);
      console.warn(`[enrich] ${releaseId} stage ${stage} failed:`, (err as Error).message);
    },
  };

  // A previous failure is superseded the moment we try again — otherwise a
  // retried release would report `failed` while it is visibly working.
  failedAt.delete(releaseId);

  const watchdog = setTimeout(() => {
    if (inFlight.has(releaseId)) {
      console.warn(`[enrich] ${releaseId} exceeded ${WATCHDOG_MS}ms — reporting failed`);
      failedAt.set(releaseId, Date.now());
      inFlight.delete(releaseId);
    }
  }, WATCHDOG_MS);
  watchdog.unref?.();

  const run = work(handle)
    .then(
      (value) => {
        if (failures.length > 0) failedAt.set(releaseId, Date.now());
        return value;
      },
      (err) => {
        // The enrichment itself died, not just one stage.
        failedAt.set(releaseId, Date.now());
        throw err;
      }
    )
    .finally(() => {
      clearTimeout(watchdog);
      if (inFlight.get(releaseId) === run) inFlight.delete(releaseId);
    });

  inFlight.set(releaseId, run);
  return run;
}

/** What to tell a client asking about this release right now. */
export function enrichmentStatus(releaseId: string): EnrichmentStatus {
  if (inFlight.has(releaseId)) return "pending";

  const failed = failedAt.get(releaseId);
  if (failed === undefined) return "ready";
  if (Date.now() - failed < FAILURE_TTL_MS) return "failed";

  // Lapsed. The next access re-runs the heal, so claiming failure indefinitely
  // would be staler than the truth.
  failedAt.delete(releaseId);
  return "ready";
}

/**
 * Await every enrichment currently in flight. Used by tests, which must not race
 * a detached promise, and available for a graceful shutdown.
 */
export async function settleEnrichments(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight.values()]);
  }
}

/** Test seam: forget all tracked state. */
export function __resetEnrichmentState(): void {
  inFlight.clear();
  failedAt.clear();
}
