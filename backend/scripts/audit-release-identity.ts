// Find and heal releases whose stored date disagrees with their own MBID.
//
//   Run from backend/:  npx tsx scripts/audit-release-identity.ts            (dry run)
//                       npx tsx scripts/audit-release-identity.ts --fix
//
// ## What this is for
//
// American Football's self-titled 2016 album was stored with the 1999 debut's
// release date. The row's `musicbrainzId` was the 2016 release-group and its
// cover art was the 2016 album's — both correct and mutually consistent — while
// the date belonged to a different record entirely. A chimera: one album's
// identity wearing another's date.
//
// It got that way through the title+artist fallback tier. MusicBrainz lists
// four distinct self-titled American Football albums (1999, 2016, 2019, 2026)
// with byte-identical titles and artist names, and two code paths matched on
// those strings while ignoring MBIDs that already said the records differed —
// `dedupeMerge` collapsing search candidates, and `findExistingRelease` falling
// through to a name lookup when a candidate's MBID matched no row. Both are
// fixed; this repairs what they already wrote.
//
// ## Why `reenrichReleaseDates()` cannot do this job
//
// That function only ever moves a date EARLIER — correctly, because it exists to
// repair rows seeded from a reissue pressing, and §4 says an original date may
// only move earlier. A chimera needs the opposite: 1999 → 2016, moving LATER,
// which the §4 rule forbids for very good reasons in its own context. So this is
// a separate, deliberate, one-shot repair rather than a widening of that rule.
//
// ## Discipline
//
// Dry run by default, printing every row it would touch and the exact before →
// after (§10: read the rows before overwriting them). Only `--fix` writes, and
// each write re-indexes so Postgres and Elasticsearch stay in agreement (§5).
// MusicBrainz calls go through `lookupReleaseGroup`, so they ride the shared
// 1 req/s gate at the background tier — nobody is waiting on this.
import { prisma } from "../src/config/database.js";
import { lookupReleaseGroup } from "../src/services/musicbrainzService.js";
import { indexRelease } from "../src/services/searchService.js";

const FIX = process.argv.includes("--fix");

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  // MusicBrainz dates may be "1999", "1999-09" or "1999-09-14".
  const parts = value.split("-").map(Number);
  if (!parts[0] || Number.isNaN(parts[0])) return null;
  return new Date(Date.UTC(parts[0], (parts[1] ?? 1) - 1, parts[2] ?? 1));
}

async function main() {
  const rows = await prisma.release.findMany({
    where: { musicbrainzId: { not: null } },
    select: { id: true, title: true, artistName: true, releaseDate: true, musicbrainzId: true },
    orderBy: { title: "asc" },
  });

  console.log(`Auditing ${rows.length} release(s) with an MBID${FIX ? "" : "  (DRY RUN)"}\n`);

  const disagree: Array<{ id: string; label: string; before: Date | null; after: Date }> = [];
  const unresolved: string[] = [];

  for (const row of rows) {
    const rg = await lookupReleaseGroup(row.musicbrainzId!, "background").catch(() => null);
    if (!rg) {
      // Either the MBID is not a release-group id, or MusicBrainz could not be
      // reached. Reported, never guessed at: silently "healing" a row whose
      // truth we failed to fetch is the §1 mistake with a database behind it.
      unresolved.push(`${row.artistName} — ${row.title}  (${row.musicbrainzId})`);
      continue;
    }

    const truth = parseDate(rg["first-release-date"]);
    if (!truth) continue;

    const stored = row.releaseDate;
    // Compare on the day, so a stored midnight and a date-only MB value agree.
    const differs = !stored || stored.toISOString().slice(0, 10) !== truth.toISOString().slice(0, 10);
    if (!differs) continue;

    disagree.push({
      id: row.id,
      label: `${row.artistName} — ${row.title}`,
      before: stored,
      after: truth,
    });
  }

  if (unresolved.length) {
    console.log(`Could not resolve ${unresolved.length} release-group(s) — left untouched:`);
    for (const u of unresolved) console.log(`  ? ${u}`);
    console.log();
  }

  if (!disagree.length) {
    console.log("No release dates disagree with their MBID. Nothing to do.");
    return;
  }

  console.log(`${disagree.length} release(s) disagree with their own MBID:\n`);
  for (const d of disagree) {
    const before = d.before ? d.before.toISOString().slice(0, 10) : "(none)";
    const arrow = d.before && d.after < d.before ? "earlier" : "later";
    console.log(`  ${d.label}`);
    console.log(`    ${before}  →  ${d.after.toISOString().slice(0, 10)}   (${arrow})`);
  }

  if (!FIX) {
    console.log(`\nDry run — nothing written. Re-run with --fix to apply.`);
    return;
  }

  console.log();
  for (const d of disagree) {
    const updated = await prisma.release.update({
      where: { id: d.id },
      data: { releaseDate: d.after },
    });
    await indexRelease(updated);
    console.log(`  fixed  ${d.label}  →  ${d.after.toISOString().slice(0, 10)}`);
  }
  console.log(`\nHealed ${disagree.length} release(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
