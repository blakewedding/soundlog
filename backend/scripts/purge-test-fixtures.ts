// Remove synthetic test fixtures from BOTH stores.
//   Run from backend/:  npx tsx scripts/purge-test-fixtures.ts --dry-run
//                       npx tsx scripts/purge-test-fixtures.ts
//
// Two distinct kinds of debris, with two different definitions:
//
//  1. Fixture rows in Postgres — releases/artists/labels with synthetic
//     identifiers, created by integration tests. A crashed or interrupted run
//     leaves them behind, and they then surface in Explore's "recently added":
//     user-visible test debris.
//
//  2. Orphaned Elasticsearch documents — a doc whose Postgres row no longer
//     exists. This is the larger problem in practice: deletes that bypassed
//     deleteReleaseEverywhere had left ~1000 stale user documents.
//
// The suite now purges (1) after every run via tests/support/globalTeardown.ts,
// so this script is the operator's tool for an already-dirty database and for
// (2), which no per-run teardown can see.
//
// Detection lives in scripts/lib/fixtures.ts, shared with the teardown so the
// two cannot drift.
import { prisma } from "../src/config/database.js";
import { redis } from "../src/config/redis.js";
import { es } from "../src/config/elasticsearch.js";
import { findFixtureRows, purgeFixtureRows, purgeOrphanDocs } from "./lib/fixtures.js";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(DRY_RUN ? "DRY RUN — nothing will be written.\n" : "Purging test fixtures.\n");

  const found = await findFixtureRows();
  console.log("Postgres — fixture rows");
  for (const [kind, rows] of Object.entries(found)) {
    console.log(`  ${kind}: ${rows.length}`);
    for (const r of rows) console.log(`    ${r.label}`);
  }
  if (!DRY_RUN) {
    const removed = await purgeFixtureRows();
    console.log(`  removed ${removed}.`);
  }

  console.log("\nElasticsearch — documents with no Postgres row");
  const orphans = await purgeOrphanDocs((line) => console.log(line), DRY_RUN);

  if (DRY_RUN) {
    console.log("\nDry run — nothing written.");
  } else {
    await es.indices.refresh({ index: "_all" }).catch(() => {});
    console.log(`\nDone — ${orphans} orphaned document(s) removed.`);
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
