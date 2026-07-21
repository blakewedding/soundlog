// One-shot: strip stray leading/trailing whitespace from release titles.
// Re-indexes each touched row so Postgres and Elasticsearch stay in agreement —
// a bare SQL UPDATE would leave a stale search document behind.
//   Run from backend/:  npx tsx scripts/trim-release-titles.ts
import { prisma } from "../src/config/database.js";
import { redis } from "../src/config/redis.js";
import { indexRelease } from "../src/services/searchService.js";

async function main() {
  const all = await prisma.release.findMany({ select: { id: true, title: true } });
  const padded = all.filter((r) => r.title !== r.title.trim());
  if (!padded.length) return console.log("No padded titles.");

  for (const r of padded) {
    const updated = await prisma.release.update({
      where: { id: r.id },
      data: { title: r.title.trim() },
    });
    await indexRelease(updated); // keep the search index truthful
    console.log(`  ✓ ["${r.title}"] -> ["${updated.title}"]`);
  }
  console.log(`Trimmed ${padded.length} title(s).`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); redis.disconnect(); });
