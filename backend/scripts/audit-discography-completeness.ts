// Completeness audit — where does what we SHOW disagree with what we can LOAD?
//   Run from backend/:
//     npx tsx scripts/audit-discography-completeness.ts
//     npx tsx scripts/audit-discography-completeness.ts --limit 25
//     npx tsx scripts/audit-discography-completeness.ts --json
//     npx tsx scripts/audit-discography-completeness.ts --restart
//
// ## What this does and does NOT flag
//
// It would be easy to write this as "our Release count vs MusicBrainz's release
// count, report every delta" — and it would report a delta for every artist in
// the catalog, all of them expected. Soundlog does not mirror MusicBrainz. A
// Release row exists because a PERSON seeded it, so holding 17 of David Bowie's
// ~1,000 release-groups is the product working, not a gap to backfill. A report
// where every line is a false positive is a report nobody reads.
//
// The number that CAN lie is the discography view's. It shows a total taken from
// MusicBrainz's own `release-group-count` ("1192") next to a list assembled by
// paging that endpoint — so "total shown" and "items loadable" come from two
// different places and can disagree silently. That is the Dylan report:
// "1192 releases" above a page that had 200.
//
// So the audit compares, per artist:
//
//   held     Release rows we hold          (expected to be small — not a defect)
//   cached   entries in the assembled discography, if one is cached
//   mbTotal  MusicBrainz's release-group-count for that artist MBID
//
// and flags exactly one condition as a DEFECT: a cached discography that is
// SHORTER than mbTotal. That is a §2 violation — `assembleDiscography` is
// supposed to throw rather than return a short read, so a short cached value
// means an incomplete assembly was persisted and every visitor now sees it.
//
// ## Rate limits
//
// One MusicBrainz call per artist (`limit=1`, for the count only), through the
// shared 1 req/s gate at the `background` tier (§7). No sleep here — see
// backfill-artist-aliases.ts for why a second throttle would be wrong.
// Resumable via a Redis cursor, for the same reason.
import { prisma } from "../src/config/database.js";
import { redis } from "../src/config/redis.js";
import { peekCached } from "../src/services/cache.js";
import {
  discographyCacheKey,
  releaseGroupCountFor,
  type MBDiscographyEntry,
} from "../src/services/musicbrainzService.js";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const RESTART = args.includes("--restart");
const flag = (n: string) => (args.indexOf(n) !== -1 ? args[args.indexOf(n) + 1] : undefined);
const limit = Number(flag("--limit") ?? 0) || undefined;

const CURSOR_KEY = "audit:discography:cursor";

interface Row {
  artist: string;
  mbid: string;
  held: number;
  cached: number | null;
  mbTotal: number | null;
  verdict: "ok" | "INCOMPLETE" | "not-cached" | "unknown";
}

async function main() {
  await redis.connect().catch(() => console.warn("[audit] Redis unavailable"));
  if (RESTART) await redis.del(CURSOR_KEY);
  const cursor = RESTART ? null : await redis.get(CURSOR_KEY);

  const artists = await prisma.artist.findMany({
    where: { musicbrainzId: { not: null }, ...(cursor ? { id: { gt: cursor } } : {}) },
    select: { id: true, name: true, musicbrainzId: true, _count: { select: { releases: true } } },
    orderBy: { id: "asc" },
    ...(limit ? { take: limit } : {}),
  });

  if (!JSON_OUT) {
    console.log(
      `\n[audit] ${artists.length} artist(s) with an MBID` +
        (cursor ? ` (resuming after ${cursor})` : "") +
        `\n[audit] flagging only: a CACHED discography shorter than MusicBrainz's own count\n`
    );
  }

  const rows: Row[] = [];
  for (const a of artists) {
    const mbid = a.musicbrainzId as string;
    const cachedEntries = await peekCached<MBDiscographyEntry[]>(discographyCacheKey(mbid));
    const cached = Array.isArray(cachedEntries) ? cachedEntries.length : null;

    let mbTotal: number | null = null;
    try {
      mbTotal = await releaseGroupCountFor(mbid, "background");
    } catch (err) {
      // §1: we could not tell. Not a defect claim.
      if (!JSON_OUT) console.warn(`  ${a.name} — MusicBrainz unavailable: ${(err as Error).message}`);
    }

    const verdict: Row["verdict"] =
      cached === null
        ? "not-cached"
        : mbTotal === null
          ? "unknown"
          : cached < mbTotal
            ? "INCOMPLETE"
            : "ok";

    const row: Row = { artist: a.name, mbid, held: a._count.releases, cached, mbTotal, verdict };
    rows.push(row);
    if (!JSON_OUT) {
      const mark = row.verdict === "INCOMPLETE" ? "  *** " : "      ";
      console.log(
        `${mark}${a.name.padEnd(28)} held=${String(row.held).padStart(4)} ` +
          `cached=${String(row.cached ?? "-").padStart(5)} ` +
          `mbTotal=${String(row.mbTotal ?? "?").padStart(5)}  ${row.verdict}`
      );
    }
    await redis.set(CURSOR_KEY, a.id);
  }

  const incomplete = rows.filter((r) => r.verdict === "INCOMPLETE");
  if (JSON_OUT) {
    console.log(JSON.stringify({ rows, incomplete: incomplete.length }, null, 2));
  } else {
    console.log(
      `\n[audit] ${rows.length} checked · ${incomplete.length} INCOMPLETE · ` +
        `${rows.filter((r) => r.verdict === "not-cached").length} not cached · ` +
        `${rows.filter((r) => r.verdict === "unknown").length} unknown`
    );
    if (incomplete.length) {
      console.log(
        `\n[audit] These hold a SHORT discography — a §2 violation. Drop the cached\n` +
          `[audit] key so the next visit reassembles, e.g.:\n` +
          incomplete.map((r) => `           redis-cli del '${discographyCacheKey(r.mbid)}'`).join("\n")
      );
    }
  }
  if (incomplete.length) process.exitCode = 1;
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
