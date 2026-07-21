// Re-pull genres for specific releases with the Phase 5.6.1 tag-quality rules
// (album tags weighted over the artist fallback, wider candidate pool, junk
// filtered). Prints before/after. Run: npx tsx scripts/reenrich-genres.ts
import { prisma } from "../src/config/database.js";
import { redis } from "../src/config/redis.js";
import { getGenresWithFallback } from "../src/services/lastfmService.js";
import { indexRelease } from "../src/services/searchService.js";

const TITLES = process.argv.slice(2);

async function main() {
  for (const title of TITLES) {
    // startsWith, not equals: some seeded titles carry stray trailing whitespace
    // from upstream ("The Magnolia Electric Co ").
    const rel =
      (await prisma.release.findFirst({ where: { title: { equals: title, mode: "insensitive" } } })) ??
      (await prisma.release.findFirst({ where: { title: { startsWith: title, mode: "insensitive" } } }));
    if (!rel) {
      console.log(`? ${title}: not in the catalog`);
      continue;
    }
    // Drop the cached Last.fm payloads so we re-read upstream with new rules.
    const a = rel.artistName.toLowerCase();
    await redis.del(`lastfm:tags:${a}:${rel.title.toLowerCase()}`, `lastfm:artisttags:${a}`);

    const before = rel.genres;
    const after = await getGenresWithFallback(rel.artistName, rel.title);
    if (after.length) {
      const updated = await prisma.release.update({ where: { id: rel.id }, data: { genres: after } });
      await indexRelease(updated);
    }
    console.log(`\n${rel.title} — ${rel.artistName}`);
    console.log(`  before: ${before.length ? before.join(", ") : "(none)"}`);
    console.log(`  after : ${after.length ? after.join(", ") : "(none — left unchanged)"}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); redis.disconnect(); });
