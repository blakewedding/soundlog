/**
 * Catalog pre-warming — Phase 6.1.4, the anticipation half.
 *
 * Priority tiers fix WHO GOES FIRST when a person and a background job want the
 * same throttle slot. They cannot fix the case where a person is the only
 * caller and the data simply is not there yet: the 1 req/s MusicBrainz gate is
 * their policy, not our knob, so the only way to make a first visit fast is to
 * have done the work already.
 *
 * This sweeps the catalog we ALREADY HOLD, finds releases whose enrichment never
 * completed, and finishes them at the `background` tier — where they are
 * preempted by every click and every discography browse.
 *
 * ## What it deliberately does NOT do
 *
 * It never creates a Release row. `discographyService`'s header states the
 * invariant plainly — "Nothing is bulk-seeded … a row is created only when a
 * user clicks through" — and speculatively seeding an artist's 794 release-
 * groups would both overturn that law and spend ~13 minutes of throttle per
 * artist on records nobody has opened. Warming what we hold is strictly
 * additive: every row it touches is one a person already asked for.
 *
 * Whether to go further and seed *popular un-seeded* entries is a real product
 * question, but it is a change to a documented invariant and belongs to a
 * decision, not to a background job that quietly started doing it.
 *
 * ## Why an attempt is remembered
 *
 * Some releases have no label and no artwork anywhere, and that is a legitimate
 * final answer (§1: `null` is a real outcome). Without a memory of having tried,
 * those rows would be re-swept every cycle forever — the sweep would converge on
 * doing nothing but re-asking questions upstream has already answered. A Redis
 * marker with a long TTL bounds each release to roughly one attempt per week,
 * and expires so that art uploaded later is still eventually picked up.
 */
import { env } from "../config/env.js";
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { reenrichRelease } from "./catalogService.js";
import { runAtTier } from "./upstreamPriority.js";

/** How long a pre-warm attempt is remembered. Art uploaded later still lands. */
const ATTEMPT_TTL_SECONDS = 60 * 60 * 24 * 7;

const attemptKey = (releaseId: string) => `prewarm:tried:${releaseId}`;

export interface PrewarmResult {
  considered: number;
  attempted: string[];
  skipped: number;
}

/**
 * Releases worth finishing, most-wanted first.
 *
 * "Incomplete" is a missing cover or a missing label — the two gaps 6.1.1 showed
 * a reader actually notices. Popularity is rating count then log count: what
 * people have engaged with is the best available predictor of what the next
 * person will open, and it needs no new tracking to compute.
 */
async function candidates(limit: number) {
  return prisma.release.findMany({
    where: {
      // Only rows with something to re-fetch FROM. A release with neither id has
      // no source to heal against and would fail every sweep (`reenrichRelease`
      // answers null for exactly this case).
      OR: [{ musicbrainzId: { not: null } }, { discogsId: { not: null } }],
      AND: [{ OR: [{ coverUrl: null }, { labelId: null }] }],
    },
    select: { id: true, title: true, _count: { select: { ratings: true, logs: true } } },
    orderBy: [{ ratings: { _count: "desc" } }, { logs: { _count: "desc" } }],
    take: limit,
  });
}

/**
 * One sweep. Runs entirely at the `background` tier, so every upstream call it
 * makes yields to any click or browse that arrives while it is working.
 *
 * Sequential on purpose: the MusicBrainz gate serialises these anyway, and
 * issuing them one at a time keeps the queue shallow enough that an arriving
 * interactive call waits for at most the one slot already in flight.
 */
export async function prewarmOnce(batchSize = env.PREWARM_BATCH_SIZE): Promise<PrewarmResult> {
  // Over-fetch, because some candidates will have been attempted recently.
  const pool = await candidates(batchSize * 4);
  const attempted: string[] = [];
  let skipped = 0;

  for (const release of pool) {
    if (attempted.length >= batchSize) break;

    // `NX` makes the claim atomic, so two sweeps (or a future second process)
    // cannot both warm the same release.
    const claimed = await redis.set(attemptKey(release.id), "1", "EX", ATTEMPT_TTL_SECONDS, "NX");
    if (claimed !== "OK") {
      skipped++;
      continue;
    }

    try {
      await runAtTier("background", () => reenrichRelease(release.id));
      attempted.push(release.id);
    } catch (err) {
      // A pre-warm failure is never anyone's problem: the release is exactly as
      // it was, and a real visit will heal it through the interactive path. Log
      // it and carry on rather than abandoning the rest of the batch.
      console.warn(`[prewarm] ${release.title} (${release.id}) failed:`, (err as Error).message);
      attempted.push(release.id);
    }
  }

  return { considered: pool.length, attempted, skipped };
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the periodic sweep, if it is configured on. Returns whether it started.
 *
 * Disabled by default (`PREWARM_INTERVAL_MINUTES=0`) so that no test run, CI job
 * or laptop makes unattended upstream calls — pre-warming is a production
 * behaviour, and one that should be switched on deliberately.
 */
export function startPrewarming(): boolean {
  if (timer || env.PREWARM_INTERVAL_MINUTES <= 0) return false;

  const intervalMs = env.PREWARM_INTERVAL_MINUTES * 60_000;
  timer = setInterval(() => {
    void prewarmOnce()
      .then((r) => {
        if (r.attempted.length) {
          console.log(
            `[prewarm] warmed ${r.attempted.length} release(s), ${r.skipped} already attempted`
          );
        }
      })
      .catch((err) => console.warn("[prewarm] sweep failed:", (err as Error).message));
  }, intervalMs);
  // Never hold the process open for a background nicety.
  timer.unref?.();

  console.log(`[prewarm] catalog pre-warming every ${env.PREWARM_INTERVAL_MINUTES}m`);
  return true;
}

/** Stop the periodic sweep. Used by tests and graceful shutdown. */
export function stopPrewarming(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
