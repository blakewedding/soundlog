// One-shot: fold releases duplicated by a leaked Discogs disambiguation suffix
// ("Danny Brown (2)") into their MusicBrainz-anchored canonical row, preserving
// all user data. Idempotent — safe to re-run.
//   Run from backend/:  npx tsx scripts/heal-suffix-dupes.ts
import { prisma } from "../src/config/database.js";
import { redis } from "../src/config/redis.js";
import { healDiscogsSuffixDuplicates } from "../src/services/catalogService.js";

async function main() {
  const before = await prisma.release.count();
  const healed = await healDiscogsSuffixDuplicates();
  if (healed.length === 0) {
    console.log("No suffix-caused duplicates found.");
  } else {
    for (const h of healed) {
      console.log(
        `✓ ${h.artistName} — ${h.title}: merged ${h.mergedLoserIds.length} duplicate(s) into ${h.winnerId}`
      );
    }
  }
  const after = await prisma.release.count();
  console.log(`Releases: ${before} → ${after} (removed ${before - after})`);
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
