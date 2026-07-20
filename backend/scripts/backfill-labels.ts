// One-shot: seed the primary Label for every release that has none.
// MusicBrainz-first (label credits on the release-group's releases), Discogs
// fallback. Rate-limited by the source throttles, so ~1s per release.
//   Run from backend/:  npx tsx scripts/backfill-labels.ts
import { prisma } from "../src/config/database.js";
import { redis } from "../src/config/redis.js";
import { ensureIndices } from "../src/config/elasticsearch.js";
import { backfillReleaseLabels } from "../src/services/catalogService.js";

async function main() {
  await ensureIndices(); // make sure the labels index exists before we index into it
  const before = await prisma.release.count({ where: { labelId: null } });
  console.log(`Releases missing a label: ${before}`);
  const linked = await backfillReleaseLabels();
  for (const r of linked) console.log(`  ✓ ${r.title} → label ${r.labelId}`);
  const after = await prisma.release.count({ where: { labelId: null } });
  console.log(`Linked ${linked.length}; still unlabeled: ${after}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
