/**
 * The API is a SINGLE-INSTANCE process, and this is where that is stated out
 * loud — Phase 6.1.4.
 *
 * ## Why this file exists rather than a comment
 *
 * Two pieces of correctness are held in one process's memory:
 *
 *  1. **The MusicBrainz rate gate** (`upstreamPriority.ts`). §7 commits us to
 *     one request per second, process-wide. Two API processes would each honour
 *     that gate perfectly and together make **2 req/s** — a policy violation
 *     that no test fails on and that MusicBrainz answers with 503s that look
 *     exactly like ordinary upstream flakiness.
 *
 *  2. **The enrichment registry** (`enrichmentState.ts`). It reports whether a
 *     release is still being filled in. Behind two processes, a poll landing on
 *     the process that is not doing the work reads `ready` for a release that is
 *     still half-empty — which is precisely the 6.1.1 bug (a partial release
 *     presenting as a finished one), reintroduced by deployment topology rather
 *     than by code.
 *
 * Neither failure announces itself. Both would be found in production, by a
 * user, the way 6.1.1 and 6.1.3 were.
 *
 * ## The decision, recorded
 *
 * Scaling the API to more than one process is **not** a config change. It
 * requires, together:
 *
 *  - a **distributed token bucket in Redis** for the MusicBrainz gate, so the
 *    1 req/s is global rather than per-process; and
 *  - a **shared enrichment registry in Redis**, so progress is a property of the
 *    release rather than of whichever process answered.
 *
 * Doing one without the other trades a visible slowdown for a silent lie. That
 * work was deliberately not done in 6.1.4: production runs a single API
 * container, and building distributed coordination for a topology nobody has
 * asked for would have been the expensive kind of speculation. This assertion is
 * the cheap half — the day someone sets `replicas: 2`, they meet a sentence
 * explaining what else has to move, instead of a 503 and a lying progress field.
 */

/**
 * Warn loudly when the process is configured to run alongside siblings.
 *
 * Deliberately a WARNING, not a crash. A refusal to boot on a misread env var
 * would be its own outage, and the failure modes above degrade rather than
 * corrupt: the rate violation is rude to MusicBrainz and the registry is
 * over-optimistic, but Postgres — the truth (§5) — stays correct either way.
 */
export function assertSingleApiInstance(): void {
  // The usual ways a process learns it is one of several.
  const replicaHints: Array<[string, string | undefined]> = [
    ["WEB_CONCURRENCY", process.env.WEB_CONCURRENCY],
    ["API_REPLICAS", process.env.API_REPLICAS],
    ["NODE_APP_INSTANCE", process.env.NODE_APP_INSTANCE],
    ["pm_id", process.env.pm_id],
  ];

  for (const [name, raw] of replicaHints) {
    if (raw === undefined) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    // WEB_CONCURRENCY/API_REPLICAS count processes; NODE_APP_INSTANCE/pm_id
    // index them, so anything past the first is also a second process.
    const multiple = name === "WEB_CONCURRENCY" || name === "API_REPLICAS" ? n > 1 : n > 0;
    if (!multiple) continue;

    console.warn(
      `[boot] ${name}=${raw} implies more than one API process. The MusicBrainz ` +
        `1 req/s gate and the enrichment registry are BOTH per-process: this ` +
        `configuration makes ~${name === "WEB_CONCURRENCY" || name === "API_REPLICAS" ? n : n + 1} req/s ` +
        `to MusicBrainz (§7 violation) and lets a release still being enriched ` +
        `report "ready" to whichever process did not enrich it (the 6.1.1 bug). ` +
        `Both need moving to Redis together — see config/singleInstance.ts.`
    );
    return;
  }
}
