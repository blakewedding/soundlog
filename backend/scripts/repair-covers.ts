// Repair stored cover art for releases we already hold — the 6.3 backfill.
//   Run from backend/:
//     npx tsx scripts/repair-covers.ts --artist "Tom Waits" --dry-run
//     npx tsx scripts/repair-covers.ts --artist "Tom Waits"
//     npx tsx scripts/repair-covers.ts --artist "Boris" --blanks-only
//     npx tsx scripts/repair-covers.ts --all --limit 500
//
// Why this exists rather than leaning on the nightly warm sweep, which also
// writes covers back now:
//
//   - `needsWarming` gates on the four METADATA layers, so an artist warmed
//     yesterday is skipped no matter how broken its artwork is. Measured on
//     production the day after a sweep: `0 of 1 target(s) due` for Tom Waits.
//   - `coverPrefetchSet` is studio albums/EPs capped at 24, so SINGLES are
//     never in scope. Four of the reported blanks were singles.
//
// The sweep is the self-maintaining half; this is the repair half.
//
// SCOPE IS EXPLICIT AND READ BACK. `--dry-run` resolves upstream and prints
// exactly what would change without writing a row, and the selection is printed
// with counts before any write happens (§10: a destructive or overwriting
// statement is read back BEFORE it runs, carrying the identical filter).
//
// Everything runs at the `background` tier, so a person clicking the site while
// this runs always gets the next gate slot, and the Cover Art Archive's bounded
// concurrency (§7) applies unchanged — this cannot become a thundering herd.
import { prisma } from "../src/config/database.js";
import { redis } from "../src/config/redis.js";
import { repairCover, isRepairableCover, type CoverRepairOutcome } from "../src/services/coverRepair.js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ALL = args.includes("--all");

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

const artist = flag("--artist");
/**
 * Repair ONLY rows with no cover at all, leaving Discogs-sourced ones alone.
 *
 * The two populations have different risk. A blank tile can only improve: there
 * is nothing to lose and the worst case is it stays blank. Replacing a
 * Discogs-sourced cover is a judgement call about which of two real images is
 * the front, and the `discogsId` re-pick path that the label-scan population
 * actually needs is still unbuilt — so a Discogs pass would fix only the subset
 * the archive can answer and silently leave the rest looking repaired.
 */
const BLANKS_ONLY = args.includes("--blanks-only");
const limit = Number(flag("--limit") ?? 0) || undefined;

async function main() {
  if (!artist && !ALL) {
    console.error("Refusing to run without a scope. Pass --artist \"<name>\" or --all.");
    process.exit(1);
  }
  await redis.connect().catch(() => console.warn("[repair-covers] Redis unavailable"));

  // The selection, read back in full before anything is written.
  const candidates = await prisma.release.findMany({
    where: {
      musicbrainzId: { not: null },
      ...(artist ? { artistName: { contains: artist, mode: "insensitive" as const } } : {}),
    },
    select: { id: true, title: true, artistName: true, musicbrainzId: true, coverUrl: true },
    orderBy: { title: "asc" },
  });

  // Filtered in code rather than SQL because "Discogs-sourced" is a property of
  // the DECODED upstream inside the proxied path, not a LIKE pattern — and §10
  // prefers an explicit list of rows we have looked at over a pattern we believe.
  const targets = candidates
    .filter((r) => (BLANKS_ONLY ? r.coverUrl === null : isRepairableCover(r.coverUrl)))
    .slice(0, limit);

  const blanks = targets.filter((r) => r.coverUrl === null).length;
  console.log(
    `\n[repair-covers] scope: ${artist ? `artist ~ "${artist}"` : "ENTIRE CATALOG"}` +
      `${BLANKS_ONLY ? " · BLANKS ONLY" : ""}${limit ? ` (limit ${limit})` : ""}\n` +
      `  ${candidates.length} release(s) with an MBID\n` +
      `  ${targets.length} repairable — ${blanks} blank, ${targets.length - blanks} Discogs-sourced\n` +
      `  ${DRY_RUN ? "DRY RUN — no rows will be written" : "WRITING"}\n`
  );
  if (!targets.length) {
    console.log("Nothing to do.");
    return;
  }

  const tally: Record<CoverRepairOutcome, number> = {
    repaired: 0,
    kept: 0,
    "no-art": 0,
    unavailable: 0,
    "not-held": 0,
  };

  // Sequential on purpose: the gate serialises upstream anyway, and going one at
  // a time keeps the queue shallow enough that an arriving interactive call
  // waits for at most the one slot already in flight (prewarmService's reason).
  for (const [i, row] of targets.entries()) {
    const result = await repairCover(row.musicbrainzId!, { dryRun: DRY_RUN });
    tally[result.outcome]++;
    const mark =
      result.outcome === "repaired" ? "FIX " : result.outcome === "unavailable" ? "RETRY" : "    ";
    console.log(
      `  ${mark} [${i + 1}/${targets.length}] ${row.title} — ${result.outcome}` +
        (result.outcome === "repaired" ? `\n         ${result.before ?? "(blank)"}\n      -> ${result.after}` : "")
    );
  }

  console.log(
    `\n[repair-covers] ${DRY_RUN ? "would repair" : "repaired"} ${tally.repaired}` +
      ` · kept ${tally.kept} · no art on file ${tally["no-art"]}` +
      ` · upstream unavailable ${tally.unavailable} · not held ${tally["not-held"]}`
  );
  if (tally.unavailable) {
    // §1, stated out loud: these are RETRY-ABLE, not absences. Nothing was
    // cached for them, and a later run can still find the artwork.
    console.log(
      `  ${tally.unavailable} could not be resolved right now. That is "we could not tell",` +
        ` not "no artwork" — nothing was cached, and re-running picks them up.`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit().catch(() => {});
  });
