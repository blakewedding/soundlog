// Rebuild the release index from Postgres — resumable, and never destructive.
//   Run from backend/:
//     npx tsx scripts/reindex-releases.ts --dry-run
//     npx tsx scripts/reindex-releases.ts                 # resumes automatically
//     npx tsx scripts/reindex-releases.ts --restart
//     npx tsx scripts/reindex-releases.ts --verify        # counts only, no writes
//
// ## Why this is an UPDATE IN PLACE and not a build-and-swap
//
// The usual zero-downtime shape is: build a new index, verify, swap an alias.
// It is the right shape when the INDEX-TIME analyzer or a field's type changes,
// because those cannot be altered on a live index.
//
// This change is neither. `titleExact`/`artistNameExact` are ADDITIVE fields
// (Elasticsearch accepts new fields on a live mapping) and the
// `autocomplete_search` change is query-time only. So every document can be
// rewritten in place, and at no point is there an index that does not exist or
// is missing documents. A rebuild-and-swap here would introduce a window with
// two divergent copies to keep in step, for no benefit.
//
// The live index is therefore never dropped, never closed, and stays fully
// searchable throughout. Documents gain the new fields as they are rewritten;
// until then they simply match on the analysed fields exactly as before.
//
// (If a future change alters an index-time analyzer or a field type, THAT one
// needs build-new -> verify -> swap-alias, and `RELEASE_INDEX` would need to
// become an alias first. Filed rather than pre-built.)
//
// §5: Postgres is truth and the index is a rebuildable projection. This is that
// sentence as a script.
import { prisma } from "../src/config/database.js";
import { redis } from "../src/config/redis.js";
import { es, RELEASE_INDEX, ensureIndices } from "../src/config/elasticsearch.js";
import { indexRelease } from "../src/services/searchService.js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const RESTART = args.includes("--restart");
const VERIFY_ONLY = args.includes("--verify");
const flag = (n: string) => (args.indexOf(n) !== -1 ? args[args.indexOf(n) + 1] : undefined);
const BATCH = Number(flag("--batch") ?? 0) || 500;

const CURSOR_KEY = "reindex:releases:cursor";

async function counts() {
  const pg = await prisma.release.count();
  await es.indices.refresh({ index: RELEASE_INDEX }).catch(() => {});
  const idx = await es.count({ index: RELEASE_INDEX }).then((r) => r.count).catch(() => -1);
  return { pg, idx };
}

async function main() {
  await redis.connect().catch(() => console.warn("[reindex] Redis unavailable"));
  // Makes sure the additive mapping exists before anything is written against it.
  await ensureIndices();

  const before = await counts();
  console.log(`\n[reindex] Postgres holds ${before.pg}, index holds ${before.idx}`);

  if (VERIFY_ONLY) {
    const drift = Math.abs(before.pg - before.idx);
    console.log(`[reindex] drift ${drift}`);
    if (drift !== 0) process.exitCode = 1;
    return;
  }

  if (RESTART) {
    const had = await redis.get(CURSOR_KEY);
    await redis.del(CURSOR_KEY);
    console.log(`[reindex] --restart: cleared cursor (was ${had ?? "unset"})`);
  }
  const cursor = RESTART ? null : await redis.get(CURSOR_KEY);
  if (cursor) console.log(`[reindex] resuming after ${cursor}`);
  if (DRY_RUN) console.log("[reindex] DRY RUN — nothing will be written");

  let done = 0;
  let last = cursor;
  for (;;) {
    // Keyset pagination by id: stable under concurrent writes, and the cursor
    // is a row we have actually processed rather than an offset that shifts.
    const batch = await prisma.release.findMany({
      where: last ? { id: { gt: last } } : undefined,
      orderBy: { id: "asc" },
      take: BATCH,
    });
    if (!batch.length) break;

    for (const release of batch) {
      // `indexRelease` swallows and logs its own failures (§5) — an index write
      // must never be able to fail a core path, and that holds here too: a row
      // that fails to index leaves the cursor advanced and is picked up by a
      // later `--restart`, rather than stopping the whole rebuild.
      if (!DRY_RUN) await indexRelease(release);
      done++;
    }
    last = batch[batch.length - 1].id;
    if (!DRY_RUN) await redis.set(CURSOR_KEY, last);
    console.log(`[reindex] ${done}/${before.pg} (cursor ${last})`);
  }

  if (!DRY_RUN) {
    const after = await counts();
    console.log(`\n[reindex] done — ${done} rewritten`);
    console.log(`[reindex] Postgres ${after.pg} · index ${after.idx} · drift ${Math.abs(after.pg - after.idx)}`);
    if (after.idx !== after.pg) {
      console.warn("[reindex] counts disagree — run scripts/search-canary.ts and investigate");
      process.exitCode = 1;
    }
  } else {
    console.log(`\n[reindex] DRY RUN — would have rewritten ${done}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
    await redis.quit().catch(() => {});
  });
