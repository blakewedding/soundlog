// Suite-wide fixture hygiene.
//
// Per-suite `afterAll` blocks are necessary but not sufficient: they don't run
// when a test file throws during setup, when a run is interrupted (Ctrl+C in a
// watch session), or when cleanup itself fails part-way through. Anything left
// behind lands in the shared dev database and then surfaces in the UI —
// "Record 7 — Prolific mrwiup8e" appeared at the top of Explore's recently
// added, which is how this was found.
//
// Vitest runs `teardown` after the whole run regardless of pass or fail, which
// makes it the right place for a backstop. Same discipline as the Phase 2.5
// Elasticsearch cleanup fix: the sanctioned removal path has to be the one that
// always runs, not the one that runs on the happy path.
import { findFixtureRows, purgeFixtureRows, purgeOrphanDocs } from "../../scripts/lib/fixtures.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";

export async function setup() {
  // Nothing to prepare — a dirty database is reported, not repaired, on the way
  // in, so a pre-existing mess is never silently attributed to this run.
  const before = await findFixtureRows().catch(() => null);
  const count = before
    ? before.releases.length + before.artists.length + before.labels.length + before.users.length
    : 0;
  if (count > 0) {
    console.warn(
      `\n[fixtures] ${count} fixture row(s) already present before this run — ` +
        `pre-existing debris, will be cleaned on teardown.`
    );
  }
}

export async function teardown() {
  try {
    const removed = await purgeFixtureRows();
    if (removed > 0) {
      console.warn(
        `\n[fixtures] cleaned ${removed} leftover fixture row(s) after the run.\n` +
          `[fixtures] a suite's afterAll missed them — see tests/support/globalTeardown.ts`
      );
    }

    // Elasticsearch orphans, the other half of the same problem. Suites delete
    // their users and lists with `prisma.deleteMany`, which never touches the
    // index — so every run leaves stale documents behind that search can still
    // return (CLAUDE.md §5: deletes must clean BOTH stores). Reconciling
    // against Postgres is exact and cannot catch live data.
    const orphans = await purgeOrphanDocs().catch(() => 0);
    if (orphans > 0) {
      console.warn(`[fixtures] removed ${orphans} orphaned search document(s) after the run.`);
    }

    // The guard: nothing synthetic may survive. Left as a hard failure rather
    // than a warning, because silent debris is exactly what this replaces.
    const remaining = await findFixtureRows();
    const stillThere =
      remaining.releases.length +
      remaining.artists.length +
      remaining.labels.length +
      remaining.users.length;
    if (stillThere > 0) {
      const lines = [
        ...remaining.releases,
        ...remaining.artists,
        ...remaining.labels,
        ...remaining.users,
      ]
        .map((r) => `  - ${r.label}`)
        .join("\n");
      throw new Error(
        `Fixture rows survived cleanup — the dev database is dirty:\n${lines}\n` +
          `Run: npx tsx scripts/purge-test-fixtures.ts`
      );
    }
  } finally {
    await prisma.$disconnect().catch(() => {});
    await redis.quit().catch(() => {});
  }
}
