// Backfill `Release.coverColor` — the dominant-colour placeholder tint — for
// rows seeded before it existed, and warm the cover cache while doing it.
//   Run from backend/:  npx tsx scripts/backfill-cover-tints.ts
//                       npx tsx scripts/backfill-cover-tints.ts --dry-run
//                       npx tsx scripts/backfill-cover-tints.ts --force
//
// This one DOES make network calls, and that is not a contradiction of the rule
// in heal-cover-proxy.ts / heal-cover-https.ts. The distinction is what a
// failure can cost:
//
//   - Those scripts REWRITE a column that already holds good data, so a script
//     that consulted a flaky upstream could destroy artwork on a transient error.
//   - This script only ADDS a value where there is none. A fetch that fails
//     leaves the column null, the client falls back to browser-side extraction
//     exactly as it did before 6.1, and the next access-time heal tries again.
//
// So the safety property here is narrower and explicit: **never write over an
// existing colour, never write null, and never fail the run because one cover
// could not be sampled.** `--force` re-samples rows that already have a colour
// (for when the sampling itself changes); it still only writes a colour it got.
//
// Sampling renders the w400 rendition, so this doubles as a cache warm-up: after
// a run, the first visitor to any of these releases gets a disk HIT rather than
// a fetch from the Internet Archive.
import { prisma } from "../src/config/database.js";
import { redis } from "../src/config/redis.js";
import { indexRelease } from "../src/services/searchService.js";
import { sampleCoverTint } from "../src/services/coverTint.js";
import { UpstreamUnavailableError } from "../src/services/musicbrainzService.js";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

async function main() {
  const rows = await prisma.release.findMany({
    where: { coverUrl: { not: null }, ...(FORCE ? {} : { coverColor: null }) },
    select: { id: true, title: true, coverUrl: true, coverColor: true },
    orderBy: { id: "asc" }, // Release has no createdAt; id is a stable cuid order
  });

  console.log(`${rows.length} releases with artwork and no tint${FORCE ? " (--force: all)" : ""}.`);
  if (!rows.length) return;
  if (DRY_RUN) {
    for (const r of rows.slice(0, 10)) console.log(`  ${r.title.slice(0, 50)} — ${r.coverUrl}`);
    if (rows.length > 10) console.log(`  … and ${rows.length - 10} more`);
    return console.log("\nDry run — nothing fetched, nothing written.");
  }

  let sampled = 0;
  let unavailable = 0;
  let noColor = 0;
  let reindexFailures = 0;

  for (const row of rows) {
    let color: string | null = null;
    try {
      color = await sampleCoverTint(row.coverUrl!);
    } catch (err) {
      // Retryable by definition (that is the only thing sampleCoverTint throws).
      // Leave the column alone and say so — this row is worth another run, and
      // the access-time heal will also pick it up.
      unavailable += 1;
      const why = err instanceof UpstreamUnavailableError ? err.message : (err as Error).message;
      console.warn(`  unavailable: ${row.title.slice(0, 40)} — ${why}`);
      continue;
    }

    if (!color) {
      noColor += 1;
      continue;
    }

    const updated = await prisma.release.update({
      where: { id: row.id },
      data: { coverColor: color },
    });
    sampled += 1;
    console.log(`  ${color}  ${row.title.slice(0, 50)}`);

    try {
      await indexRelease(updated);
    } catch (err) {
      reindexFailures += 1;
      console.warn(`  re-index failed for ${updated.id}: ${(err as Error).message}`);
    }
  }

  console.log(
    `\nTinted ${sampled}; ${noColor} had nothing to sample; ${unavailable} upstream-unavailable (re-runnable).`
  );
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
