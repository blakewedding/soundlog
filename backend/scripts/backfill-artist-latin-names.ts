// One-shot: give non-Latin artist names a Latin/English rendering from their
// MusicBrainz aliases, so they display as "Fishmans (フィッシュマンズ)" and are
// searchable by either script. Idempotent — only touches rows still missing one.
//   Run from backend/:  npx tsx scripts/backfill-artist-latin-names.ts
import { prisma } from "../src/config/database.js";
import { redis } from "../src/config/redis.js";
import { lookupArtist, pickLatinName, isNonLatin } from "../src/services/musicbrainzService.js";
import { indexArtist } from "../src/services/searchService.js";

async function main() {
  const artists = await prisma.artist.findMany({
    where: { latinName: null, musicbrainzId: { not: null } },
  });
  const needing = artists.filter((a) => isNonLatin(a.name));
  console.log(`${artists.length} artists without a Latin name; ${needing.length} are non-Latin.`);

  for (const a of needing) {
    const mb = await lookupArtist(a.musicbrainzId!);
    const latin = pickLatinName(mb);
    if (!latin) {
      console.log(`  – ${a.name}: MusicBrainz offers no Latin alias`);
      continue;
    }
    const updated = await prisma.artist.update({
      where: { id: a.id },
      data: { latinName: latin },
    });
    await indexArtist(updated);
    console.log(`  ✓ ${a.name} → "${latin}"`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
