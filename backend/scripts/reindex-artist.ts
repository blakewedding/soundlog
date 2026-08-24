// Re-index a single artist from Postgres into Elasticsearch, by id.
//   npx tsx scripts/reindex-artist.ts <artistId>
//
// Postgres is truth and the index is a rebuildable projection (§5), so this is
// the smallest possible repair: one document, named by the id of a row we have
// looked at, rather than a bulk re-index of everything.
import { prisma } from "../src/config/database.js";
import { es, ARTIST_INDEX } from "../src/config/elasticsearch.js";
import { indexArtist } from "../src/services/searchService.js";

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("usage: reindex-artist.ts <artistId>");
    process.exitCode = 1;
    return;
  }
  const row = await prisma.artist.findUnique({ where: { id } });
  if (!row) {
    console.error(`no artist ${id}`);
    process.exitCode = 1;
    return;
  }
  await indexArtist(row);
  await es.indices.refresh({ index: ARTIST_INDEX }).catch(() => {});
  console.log(`re-indexed ${row.name} (${row.id}), aliases=${JSON.stringify(row.aliases)}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
