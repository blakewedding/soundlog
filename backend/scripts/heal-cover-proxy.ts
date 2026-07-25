// One-shot: rewrite stored cover-art URLs into their proxied `/covers/…` form.
// Re-indexes each touched row so Postgres and Elasticsearch stay in agreement —
// a bare SQL UPDATE would leave a stale search document behind (§5).
//   Run from backend/:  npx tsx scripts/heal-cover-proxy.ts
//                       npx tsx scripts/heal-cover-proxy.ts --dry-run
//                       npx tsx scripts/heal-cover-proxy.ts --revert
//
// Why this exists: stored covers pointed browsers straight at coverartarchive.org
// and i.discogs.com. Measured on the live catalog, that meant a 2,254,558-byte
// JPEG original painted into a 140px grid tile, behind two redirects and a
// 1.8–2.4s TTFB, on a hostname Cloudflare cannot cache for us. New rows are
// proxied at persist by resolveCovers; this heals everything seeded before that.
//
// NO NETWORK CALLS, deliberately — the same rule, and the same reason, as
// heal-cover-https.ts. The Cover Art Archive returns intermittent 500s (one URL
// was observed failing four times in a row and succeeding on the fifth), so a
// script that verified each URL and discarded the failures would delete good
// artwork on a transient error: the retryable-treated-as-permanent bug §1 exists
// to prevent. This is a pure string transform, and the proxied form encodes its
// upstream URL, so no lookup is needed either.
//
// `--revert` is the rollback path, and it is the reason the URL is encoded
// rather than hashed: every proxied row decodes straight back to the upstream
// URL it came from. Code rollback and URL rollback are separate decisions, the
// same way code and schema are (see the README's Rollback section).
//
// Idempotent in both directions: rows already in the target form are left
// untouched, so re-running is a no-op.
import { prisma } from "../src/config/database.js";
import { redis } from "../src/config/redis.js";
import { indexRelease } from "../src/services/searchService.js";
import {
  COVER_LARGE_WIDTH,
  COVER_THUMB_WIDTH,
  decodeProxiedCoverPath,
  toProxiedUrl,
} from "../src/services/coverProxy.js";

const DRY_RUN = process.argv.includes("--dry-run");
const REVERT = process.argv.includes("--revert");

/** Proxy a stored URL, or (with --revert) decode it back to its upstream form. */
function heal(url: string | null, width: typeof COVER_THUMB_WIDTH | typeof COVER_LARGE_WIDTH) {
  if (!url) return url;
  if (REVERT) return decodeProxiedCoverPath(url)?.upstreamUrl ?? url;
  return toProxiedUrl(url, width);
}

async function main() {
  const all = await prisma.release.findMany({
    select: { id: true, title: true, coverUrl: true, coverUrlLarge: true },
  });

  const changed = all
    .map((r) => ({
      row: r,
      coverUrl: heal(r.coverUrl, COVER_THUMB_WIDTH),
      coverUrlLarge: heal(r.coverUrlLarge, COVER_LARGE_WIDTH),
    }))
    .filter((c) => c.coverUrl !== c.row.coverUrl || c.coverUrlLarge !== c.row.coverUrlLarge);

  const direction = REVERT ? "un-proxied" : "proxied";
  console.log(`${all.length} releases scanned, ${changed.length} to be ${direction}.`);
  if (!changed.length) return console.log("Nothing to heal.");

  if (DRY_RUN) {
    for (const c of changed.slice(0, 10)) {
      console.log(`  ${c.row.title.slice(0, 40)}`);
      if (c.coverUrl !== c.row.coverUrl) console.log(`    ${c.row.coverUrl}\n → ${c.coverUrl}`);
    }
    if (changed.length > 10) console.log(`  … and ${changed.length - 10} more`);
    return console.log("\nDry run — nothing written.");
  }

  let healed = 0;
  let reindexFailures = 0;

  for (const c of changed) {
    const updated = await prisma.release.update({
      where: { id: c.row.id },
      data: { coverUrl: c.coverUrl, coverUrlLarge: c.coverUrlLarge },
    });
    healed += 1;

    // Elasticsearch is a rebuildable index and must never block the core write
    // (§5) — the Postgres update above is the source of truth. Search results
    // carry coverUrl, so a row healed here with a stale document there would
    // serve un-proxied covers from search until the next reindex.
    try {
      await indexRelease(updated);
    } catch (err) {
      reindexFailures += 1;
      console.warn(`  re-index failed for ${updated.id}: ${(err as Error).message}`);
    }
  }

  console.log(`Healed ${healed} releases (${direction}).`);
  if (reindexFailures) {
    console.warn(
      `${reindexFailures} re-index failures — Postgres is correct; re-run backfill-search.ts to reconcile.`
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });
