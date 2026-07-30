// Run ONE artist-warming sweep, in the foreground, with live progress.
//   Run from backend/:
//     npx tsx scripts/warm-run.ts                # honours WARM_BATCH_SIZE
//     npx tsx scripts/warm-run.ts --batch 500    # the whole list in one pass
//     npx tsx scripts/warm-run.ts --dry-run      # what it WOULD warm, no calls
//
// Why this exists rather than just switching the timer on: `startWarming` uses
// `setInterval` with no leading call, so the first sweep is one interval after
// boot. 6.1.5 filed that as the thing which made a pre-warming verification plan
// unfalsifiable — "check right after deploy" cannot work against that shape. The
// first run against a cold list is also half an hour of upstream work, which is
// something to watch happen, not something to discover in a log the next day.
//
// Everything runs at the `background` tier inside `warmOnce`, so a person
// clicking through the site while this runs always gets the next gate slot.
import { prisma } from "../src/config/database.js";
import { redis } from "../src/config/redis.js";
import { needsWarming, warmOnce } from "../src/services/warmService.js";
import { ttlOf } from "../src/services/cache.js";
import { discographyCacheKey } from "../src/services/musicbrainzService.js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const batchIdx = args.indexOf("--batch");
const batch = batchIdx !== -1 ? Number(args[batchIdx + 1]) : undefined;
// `--only <mbid>[,<mbid>…]` re-warms named artists without waiting behind the
// list — the usual reason being that a previous sweep reported a failed layer
// for them and upstream has since recovered.
const onlyIdx = args.indexOf("--only");
const only = onlyIdx !== -1 ? args[onlyIdx + 1]?.split(",").filter(Boolean) : undefined;

function hhmmss(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}m${String(s % 60).padStart(2, "0")}s`;
}

async function main() {
  await redis.connect().catch(() => console.warn("[warm-run] Redis unavailable"));
  const startedAt = Date.now();

  if (DRY_RUN) {
    // Read-only: report what the sweep would pick up, without an upstream call.
    //
    // It asks `needsWarming` — the SAME function `warmOnce` selects with — rather
    // than re-implementing the TTL question. It used to re-implement it, and when
    // `needsWarming` was fixed to consider every layer this preview silently kept
    // the old single-key rule: it reported 2 targets due where the real sweep
    // would take 16. A dry run that disagrees with the run it previews is worse
    // than having none, because it is trusted.
    const targets = await prisma.warmTarget.findMany({
      where: { enabled: true, ...(only ? { artistMbid: { in: only } } : {}) },
      orderBy: [{ weight: "desc" }, { name: "asc" }],
      select: { artistMbid: true, name: true, source: true },
    });
    let due = 0;
    for (const t of targets) {
      if (!(await needsWarming(t.artistMbid, t.name))) continue;
      due++;
      // The discography TTL alone no longer decides, but it is still the useful
      // thing to SHOW: it says whether this is a cold artist or a warm one with a
      // thinner layer that expired first.
      const ttl = await ttlOf(discographyCacheKey(t.artistMbid));
      const state = ttl === null ? "COLD" : `discography warm ${Math.round(ttl / 3600)}h`;
      console.log(`  due  ${t.name} [${t.source}] ${state}`);
    }
    console.log(`\n[warm-run] ${due} of ${targets.length} target(s) due. DRY RUN — no calls made.`);
    return;
  }

  const result = await warmOnce({
    batchSize: batch,
    only,
    onProgress: (outcome, done, total) => {
      const bits = [
        outcome.releaseGroups !== null ? `${outcome.releaseGroups} groups` : null,
        outcome.covers ? `${outcome.covers} covers` : null,
        outcome.failed.length ? `FAILED: ${outcome.failed.join(",")}` : null,
      ].filter(Boolean);
      console.log(
        `[${String(done).padStart(3)}/${total}] ${hhmmss(Date.now() - startedAt)}  ` +
          `${outcome.name} — ${bits.join(", ") || "nothing to warm"}`
      );
    },
  });

  if (result.lockedOut) {
    console.warn("[warm-run] another sweep holds the lock — nothing done.");
    return;
  }

  const groups = result.attempted.reduce((n, a) => n + (a.releaseGroups ?? 0), 0);
  const covers = result.attempted.reduce((n, a) => n + a.covers, 0);
  const failed = result.attempted.filter((a) => a.failed.length);

  console.log(
    `\n[warm-run] ${result.attempted.length} warmed, ${result.skipped} already warm, ` +
      `${result.considered} considered, in ${hhmmss(Date.now() - startedAt)}`
  );
  console.log(`[warm-run] ${groups} release-groups cached, ${covers} cover renditions on disk`);

  // Reported explicitly rather than buried: a sweep that "finished" with a third
  // of its targets partly broken is not a success, and `warmed N` alone cannot
  // tell the difference (6.1.5's lesson about attempts versus outcomes).
  if (failed.length) {
    console.log(`\n[warm-run] ${failed.length} target(s) had a failed layer:`);
    for (const f of failed) console.log(`    · ${f.name} — ${f.failed.join(", ")}`);
    console.log("    These stay uncached (§2) and the next sweep retries them.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit().catch(() => {});
  });
