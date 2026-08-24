// Backfill MusicBrainz aliases onto Artist rows, and re-index them (6.3e).
//   Run from backend/:
//     npx tsx scripts/backfill-artist-aliases.ts --dry-run
//     npx tsx scripts/backfill-artist-aliases.ts --limit 200
//     npx tsx scripts/backfill-artist-aliases.ts            # resumes automatically
//     npx tsx scripts/backfill-artist-aliases.ts --restart  # from the beginning
//
// ## Rate limits are not this script's job, and that is deliberate
//
// Every lookup goes through `lookupArtist`, which goes through `mbFetch`, which
// rides the ONE process-wide 1 req/s gate (§7). There is no sleep in this file
// and there must not be one: a second throttle here would be a second opinion
// about MusicBrainz's policy, and the two would drift. Everything runs at the
// `background` tier, so a person clicking the site always takes the next slot —
// §7's rule that only work blocking nobody opts down.
//
// `lookupArtist` is also cached for a week, so re-running this soon after a run
// costs almost no upstream calls at all.
//
// ## Resumability
//
// A cursor (the last artist id completed, ordered by id) is written to Redis
// after every row. An interrupted run resumes from it rather than from zero,
// because re-walking thousands of artists to reach the point of interruption is
// exactly the MusicBrainz budget this is trying to spend carefully.
//
// §10: the selection is read back and printed with counts BEFORE anything is
// written, and every write is a single-row update by primary key.
import { prisma } from "../src/config/database.js";
import { redis } from "../src/config/redis.js";
import { lookupArtist, aliasNames } from "../src/services/musicbrainzService.js";
import { indexArtist } from "../src/services/searchService.js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const RESTART = args.includes("--restart");
const flag = (n: string) => (args.indexOf(n) !== -1 ? args[args.indexOf(n) + 1] : undefined);
const limit = Number(flag("--limit") ?? 0) || undefined;

const CURSOR_KEY = "backfill:artist-aliases:cursor";

async function main() {
  await redis.connect().catch(() => console.warn("[aliases] Redis unavailable"));

  if (RESTART) {
    const had = await redis.get(CURSOR_KEY);
    await redis.del(CURSOR_KEY);
    console.log(`[aliases] --restart: cleared cursor (was ${had ?? "unset"})`);
  }
  const cursor = RESTART ? null : await redis.get(CURSOR_KEY);

  // The selection, read back in full before anything is written (§10).
  const candidates = await prisma.artist.findMany({
    where: {
      musicbrainzId: { not: null },
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    select: { id: true, name: true, musicbrainzId: true, aliases: true },
    orderBy: { id: "asc" },
    ...(limit ? { take: limit } : {}),
  });

  const total = await prisma.artist.count({ where: { musicbrainzId: { not: null } } });
  console.log(
    `\n[aliases] scope: artists with an MBID` +
      `\n[aliases]   ${total} in catalog, ${candidates.length} to process` +
      (cursor ? ` (resuming after ${cursor})` : " (from the start)") +
      (limit ? ` [--limit ${limit}]` : "") +
      `\n[aliases]   ${DRY_RUN ? "DRY RUN — nothing will be written" : "WRITING"}\n`
  );
  if (!candidates.length) {
    console.log("[aliases] nothing to do.");
    return;
  }

  let updated = 0;
  let unchanged = 0;
  let noAliases = 0;
  let failed = 0;

  for (const [i, artist] of candidates.entries()) {
    const label = `${i + 1}/${candidates.length} ${artist.name}`;
    try {
      // `background`: nobody is waiting on this (§7).
      const mb = await lookupArtist(artist.musicbrainzId as string, "background");
      const aliases = aliasNames(mb);

      if (!aliases.length) {
        noAliases++;
        console.log(`  ${label} — no aliases upstream`);
      } else if (sameSet(aliases, artist.aliases ?? [])) {
        unchanged++;
        console.log(`  ${label} — already current (${aliases.length})`);
      } else if (DRY_RUN) {
        updated++;
        console.log(`  ${label} — WOULD SET ${aliases.length}: ${aliases.slice(0, 4).join(", ")}`);
      } else {
        const row = await prisma.artist.update({ where: { id: artist.id }, data: { aliases } });
        // Postgres is truth; the index is the rebuildable projection (§5), so a
        // failed re-index is logged inside indexArtist and never fails the row.
        await indexArtist(row);
        updated++;
        console.log(`  ${label} — set ${aliases.length}: ${aliases.slice(0, 4).join(", ")}`);
      }
    } catch (err) {
      // An unreachable MusicBrainz is not "this artist has no aliases" (§1), so
      // the row is left alone and the cursor still advances past it — a later
      // run picks it up because the row keeps whatever it had.
      failed++;
      console.warn(`  ${label} — FAILED: ${(err as Error).message}`);
    }

    // Checkpoint after every row, including failures: the cursor records
    // "processed", not "succeeded".
    if (!DRY_RUN) await redis.set(CURSOR_KEY, artist.id);
  }

  console.log(
    `\n[aliases] done — ${updated} updated, ${unchanged} already current, ` +
      `${noAliases} with none upstream, ${failed} failed`
  );
  if (!DRY_RUN) {
    console.log(`[aliases] cursor at ${candidates[candidates.length - 1].id}`);
    console.log(`[aliases] re-run to continue, or --restart to sweep again from the top.`);
  }
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((x) => set.has(x));
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
