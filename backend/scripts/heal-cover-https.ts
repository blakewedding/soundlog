// One-shot: rewrite stored cover-art URLs from http:// to https://.
// Re-indexes each touched row so Postgres and Elasticsearch stay in agreement —
// a bare SQL UPDATE would leave a stale search document behind.
//   Run from backend/:  npx tsx scripts/heal-cover-https.ts
//                       npx tsx scripts/heal-cover-https.ts --dry-run
//
// Why this exists: cleartext image URLs break the web app once it is served
// over TLS (browsers block mixed content) and break the native app in a release
// build (iOS ATS). New rows are normalized at persist by resolveCovers; this
// heals everything seeded before that landed.
//
// NO NETWORK CALLS, deliberately. The Cover Art Archive returns intermittent
// 500s — one URL was observed failing four times in a row and succeeding on the
// fifth — so verifying each URL and discarding the failures would delete good
// artwork on a transient error. That is the retryable-treated-as-permanent bug
// CLAUDE.md §1 exists to prevent. This is a pure scheme rewrite; every upstream
// we use serves the identical bytes over https.
//
// Idempotent: rows already on https are left untouched, so re-running is a
// no-op.
import { prisma } from "../src/config/database.js";
import { redis } from "../src/config/redis.js";
import { indexRelease } from "../src/services/searchService.js";
import { toSecureUrl } from "../src/services/coverUrl.js";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const all = await prisma.release.findMany({
    select: { id: true, title: true, coverUrl: true, coverUrlLarge: true },
  });

  const changed = all
    .map((r) => ({
      row: r,
      coverUrl: toSecureUrl(r.coverUrl),
      coverUrlLarge: toSecureUrl(r.coverUrlLarge),
    }))
    .filter(
      (c) => c.coverUrl !== c.row.coverUrl || c.coverUrlLarge !== c.row.coverUrlLarge
    );

  console.log(`${all.length} releases scanned, ${changed.length} with cleartext cover URLs.`);
  if (!changed.length) return console.log("Nothing to heal.");

  if (DRY_RUN) {
    for (const c of changed.slice(0, 10)) {
      console.log(`  ${c.row.title.slice(0, 40)}`);
      if (c.coverUrl !== c.row.coverUrl) console.log(`    ${c.row.coverUrl}\n → ${c.coverUrl}`);
    }
    if (changed.length > 10) console.log(`  … and ${changed.length - 10} more`);
    return console.log("\nDry run — nothing written.");
  }

  let healed = 0;
  let reindexFailures = 0;

  for (const c of changed) {
    const updated = await prisma.release.update({
      where: { id: c.row.id },
      data: { coverUrl: c.coverUrl, coverUrlLarge: c.coverUrlLarge },
    });
    healed += 1;

    // Elasticsearch is a rebuildable index and must never block the core write
    // (CLAUDE.md §5) — the Postgres update above is the source of truth.
    try {
      await indexRelease(updated);
    } catch (err) {
      reindexFailures += 1;
      console.warn(`  re-index failed for ${updated.id}: ${(err as Error).message}`);
    }
  }

  console.log(`Healed ${healed} releases.`);
  if (reindexFailures) {
    console.warn(
      `${reindexFailures} re-index failures — Postgres is correct; re-run backfill-search.ts to reconcile.`
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });
