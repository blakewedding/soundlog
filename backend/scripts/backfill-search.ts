// One-shot: index existing members (users) and public lists into Elasticsearch
// for the tabbed search. Idempotent — re-running just re-indexes.
//   Run from backend/:  npx tsx scripts/backfill-search.ts
import { prisma } from "../src/config/database.js";
import { redis } from "../src/config/redis.js";
import { ensureIndices } from "../src/config/elasticsearch.js";
import { indexUser, indexList } from "../src/services/searchService.js";

async function main() {
  await ensureIndices();

  const users = await prisma.user.findMany();
  for (const u of users) await indexUser(u);
  console.log(`Indexed ${users.length} members`);

  const lists = await prisma.list.findMany({
    where: { isPublic: true },
    include: { user: { select: { username: true } }, _count: { select: { items: true } } },
  });
  for (const l of lists) {
    await indexList({
      id: l.id,
      title: l.title,
      description: l.description,
      isPublic: l.isPublic,
      username: l.user.username,
      itemCount: l._count.items,
    });
  }
  console.log(`Indexed ${lists.length} public lists`);
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
