// Re-filter every stored Release.genres through the 6.3 allowlist.
//
//   Run from backend/:
//     npx tsx scripts/heal-genres.ts              # DRY RUN — reports, writes nothing
//     npx tsx scripts/heal-genres.ts --apply      # writes, after printing the same report
//     npx tsx scripts/heal-genres.ts --apply --limit 20
//
// Why a heal at all: the filter fix only governs NEW enrichment, and the
// catalog is warm. Every junk chip already stored — `favorito`, `totec radio`,
// `these tags suck` — stays on the page and stays navigable at /genre/<slug>
// until something rewrites the row.
//
// ## Three properties this script owes you
//
// 1. DRY BY DEFAULT (`warm-targets.ts`'s shape). The destructive form is the one
//    you have to ask for, and it prints the identical report first.
//
// 2. A §10 READ-BACK BEFORE THE WRITE, not after. Every row is selected, its
//    before/after is printed, and the UPDATE runs against those exact ids — an
//    explicit list, never a pattern. §10 exists because a `deleteMany` with a
//    plausible-looking filter took 131 ratings; the discipline is to look at the
//    rows first.
//
// 3. ELASTICSEARCH REINDEX, non-optional. `genres` is indexed (searchService)
//    and powers /api/charts/genres and the /genre/:tag route. Cleaning Postgres
//    alone would leave /genre/favorito resolving from a stale document — §5's
//    "deletes must clean both stores", applied to an update.
//
// Idempotent: filtering an already-filtered list is a no-op, so a second run
// reports 0 to change. That is also the verification — run it twice.
import { prisma } from "../src/config/database.js";
import { redis } from "../src/config/redis.js";
import {
  genreAllowSet,
  canonicalGenres,
  primeGenreVocabulary,
} from "../src/services/genreVocabulary.js";
import { indexRelease } from "../src/services/searchService.js";
import { es, RELEASE_INDEX } from "../src/config/elasticsearch.js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? Number(args[limitIdx + 1]) : undefined;

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function main() {
  await redis.connect().catch(() => console.warn("[heal-genres] Redis unavailable"));

  // Prime explicitly and AWAIT it: this process exits, so a fire-and-forget
  // page-walk would be killed in flight, populate nothing, and make the next
  // run re-fetch all 22 pages again.
  await primeGenreVocabulary();
  const allow = await genreAllowSet();
  console.log(`[heal-genres] allow-set: ${allow.size} normalized forms`);

  const releases = await prisma.release.findMany({
    where: { NOT: { genres: { isEmpty: true } } },
    select: { id: true, title: true, artistName: true, genres: true },
    orderBy: { id: "asc" }, // deterministic, and Release has no createdAt
    ...(LIMIT ? { take: LIMIT } : {}),
  });

  // ---- The read-back (§10) ------------------------------------------------
  // Computed and PRINTED before a single write, under the exact filter the
  // update will use: a list of ids, each with its before and after.
  const changes = releases
    .map((r) => ({ ...r, next: canonicalGenres(r.genres, allow) }))
    .filter((r) => !sameList(r.genres, r.next));

  const emptied = changes.filter((c) => c.next.length === 0);

  console.log(`[heal-genres] ${releases.length} release(s) carry genres`);
  console.log(`[heal-genres] ${changes.length} would change, ${emptied.length} would end EMPTY\n`);

  for (const c of changes) {
    const removed = c.genres.filter((g) => !c.next.includes(g));
    console.log(`  ${c.artistName} — ${c.title}`);
    console.log(`      before: ${c.genres.join(", ")}`);
    console.log(`      after:  ${c.next.length ? c.next.join(", ") : "(none)"}`);
    console.log(`      dropped: ${removed.join(", ")}`);
  }

  if (!changes.length) {
    console.log("\n[heal-genres] nothing to do — already clean.");
    return;
  }

  if (!APPLY) {
    console.log(`\n[heal-genres] DRY RUN — no writes. Re-run with --apply to commit.`);
    return;
  }

  // ---- The write ----------------------------------------------------------
  // One row at a time by primary key. Slower than a bulk statement and
  // deliberately so: there is no filter here that could match a row the
  // read-back above did not print.
  let written = 0;
  let reindexed = 0;
  let reindexFailed = 0;

  for (const c of changes) {
    const updated = await prisma.release.update({
      where: { id: c.id },
      data: { genres: c.next },
    });
    written++;

    // §5 makes `indexRelease` swallow its own errors so no ES outage can block a
    // core path — which means a try/catch around it is DEAD CODE and would have
    // reported "reindexed N" for zero successful writes. This script's whole job
    // is to make the two stores agree, so it READS THE DOCUMENT BACK and compares
    // instead of trusting the call. Same discipline as §10, pointed at the index.
    await indexRelease(updated);
    try {
      const doc = await es.get<{ genres?: string[] }>({ index: RELEASE_INDEX, id: c.id });
      const indexed = doc._source?.genres ?? [];
      if (sameList(indexed, c.next)) {
        reindexed++;
      } else {
        reindexFailed++;
        console.warn(
          `  [es] STALE for ${c.id}: index still holds [${indexed.join(", ")}], ` +
            `expected [${c.next.join(", ")}]`
        );
      }
    } catch (err) {
      reindexFailed++;
      console.warn(`  [es] read-back FAILED for ${c.id}: ${(err as Error).message}`);
    }
  }

  console.log(`\n[heal-genres] wrote ${written} row(s), reindexed ${reindexed}`);
  if (reindexFailed) {
    console.log(
      `[heal-genres] ${reindexFailed} REINDEX FAILURE(S) — Postgres and Elasticsearch now ` +
        `disagree. Re-run this script (it is idempotent) once Elasticsearch is healthy.`
    );
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("[heal-genres] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit().catch(() => {});
  });
