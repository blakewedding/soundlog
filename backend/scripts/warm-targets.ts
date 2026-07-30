// Populate `WarmTarget` from a resolved warming list.
//   Run from backend/:
//     npx tsx scripts/warm-targets.ts <list.md> <resolution.tsv>              # dry run
//     npx tsx scripts/warm-targets.ts <list.md> <resolution.tsv> --overrides d.tsv
//     npx tsx scripts/warm-targets.ts <list.md> <resolution.tsv> --apply
//
// The second half of ingestion. `warm-resolve.ts` turns names into MBIDs and
// refuses to guess; this turns the resolved ones into rows. Splitting them is
// what makes "bounce every ambiguity back before writing a single row" a property
// of the tooling rather than a promise about how carefully someone ran it.
//
// ## Dry by default
//
// Writing requires `--apply`. Without it this prints the exact plan — every row
// it would create, every row it would change, and the before/after of each change
// — and touches nothing. That is §10's read-back discipline applied to an upsert:
// creating rows is additive and safe, but UPDATING one overwrites a value that
// was there, and the rule this project learned the hard way is that you look
// first with the same filter you are about to write with.
//
// ## What it will not do
//
// It never disables or deletes a target that is absent from the list. A shorter
// list next month must not silently switch off half the table — that is a bulk
// UPDATE derived from a pattern, which is exactly the shape §10 exists to stop.
// Turning a target off is a deliberate, separate, single-row act.
//
// ## Identity
//
// Rows are keyed by MBID and only ever by MBID (§3). `name` is carried for
// operator legibility and is never matched on — two artists sharing a name is
// normal, and 6.2c is what happens when something treats a name as an identity.
import { readFileSync } from "node:fs";
import { prisma } from "../src/config/database.js";
import type { WarmTargetSource } from "@prisma/client";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const positional = args.filter((a) => !a.startsWith("--"));
const overridesIdx = args.indexOf("--overrides");
const overridesPath = overridesIdx !== -1 ? args[overridesIdx + 1] : null;
const [listPath, resolutionPath] = positional;

if (!listPath || !resolutionPath) {
  console.error(
    "usage: npx tsx scripts/warm-targets.ts <list.md> <resolution.tsv> [--overrides f] [--apply]"
  );
  process.exit(1);
}

/**
 * Which half of the list a name sits in — the one piece of the document's
 * structure that IS data. The spine is chart weight (the artists a stranger tries
 * first); the tail is the curated identity half. It becomes `source`, which is
 * the seam the future aggregation job replaces.
 */
function parseHalves(md: string): Map<string, WarmTargetSource> {
  const halves = new Map<string, WarmTargetSource>();
  let current: WarmTargetSource | null = null;
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (/^##\s/.test(line)) {
      if (/spine/i.test(line)) current = "CHART";
      else if (/tail/i.test(line)) current = "CURATED";
      continue;
    }
    if (!line || line.startsWith("#") || line.startsWith("-") || line.startsWith("*")) continue;
    if (!line.includes("·") || !current) continue;
    for (const piece of line.split("·")) {
      let name = piece.replace(/⚠/g, "").trim();
      if (/\*strike this line/i.test(name)) continue;
      name = name.replace(/\s*—\s*\*.*$/, "").trim();
      if (name && !halves.has(name)) halves.set(name, current);
    }
  }
  return halves;
}

/**
 * Minimal TSV reader. `\r` is stripped from every line, not just trimmed off the
 * file: a CRLF file (anything written by Python's `csv` module, or edited on
 * Windows) otherwise yields a HEADER KEY of `mbid\r`, so `row.mbid` is undefined,
 * every override silently becomes an empty string, and the run reports the names
 * as unresolved rather than as misread. Cost an ingestion pass to diagnose —
 * a parse bug that degrades to "nothing matched" looks exactly like a correct
 * refusal.
 */
/**
 * Unwrap a CSV-quoted field: `"Bonnie ""Prince"" Billy"` → `Bonnie "Prince" Billy`.
 *
 * Anything written by Python's `csv` module — which is how the disambiguation
 * rulings are assembled — quotes a field containing a quote character. A naive
 * split stores the quoting artifacts as part of the NAME, which is not a crash
 * and not a mismatch: it is simply wrong data that looks fine until an operator
 * reads it. Two of 490 targets landed that way before this existed.
 */
function unquote(cell: string): string {
  const s = cell.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/""/g, '"');
  }
  return s;
}

function parseTsv(path: string): Array<Record<string, string>> {
  const lines = readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((l) => l.replace(/\r$/, ""));
  const header = lines[0].split("\t").map(unquote);
  return lines.slice(1).map((l) => {
    const cells = l.split("\t").map(unquote);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

async function main() {
  const halves = parseHalves(readFileSync(listPath, "utf8"));
  const resolved = parseTsv(resolutionPath);

  // Disambiguation rulings, applied on top: `name <TAB> mbid`, or `name <TAB>
  // SKIP` to drop one. This is where a human's answer to an ambiguous name
  // enters — never the script's own inference.
  const overrides = new Map<string, string>();
  if (overridesPath) {
    for (const row of parseTsv(overridesPath)) {
      const name = row.name?.trim();
      const mbid = (row.mbid ?? "").trim();
      if (name) overrides.set(name, mbid);
    }
    console.log(`[targets] ${overrides.size} disambiguation override(s) loaded`);
  }

  interface Planned {
    artistMbid: string;
    name: string;
    source: WarmTargetSource;
    weight: number;
  }
  const planned: Planned[] = [];
  const unresolved: string[] = [];
  let ordinal = 0;

  for (const row of resolved) {
    const name = row.name;
    const override = overrides.get(name);
    if (override === "SKIP") continue;

    const mbid = override || (row.verdict === "resolved" ? row.mbid : "");
    if (!mbid) {
      if (row.verdict !== "excluded") unresolved.push(`${name} (${row.verdict})`);
      continue;
    }

    const source = halves.get(name) ?? "CURATED";
    // Weight is ordering only. The spine outranks the tail, and within each half
    // the author's own order is preserved — so a bounded sweep warms the most
    //-wanted first, and the order is inspectable rather than emergent.
    const weight = (source === "CHART" ? 1_000_000 : 500_000) - ordinal++;
    planned.push({ artistMbid: mbid, name, source, weight });
  }

  // Two names resolving to ONE MBID is a real possibility (an alias pair the
  // author meant to keep separate but that MusicBrainz models as one artist).
  // It must surface as a question, not be silently deduped by the upsert.
  const byMbid = new Map<string, Planned[]>();
  for (const p of planned) byMbid.set(p.artistMbid, [...(byMbid.get(p.artistMbid) ?? []), p]);
  const collisions = [...byMbid.entries()].filter(([, ps]) => ps.length > 1);

  console.log(`\n[targets] ${planned.length} target(s) planned from ${resolved.length} row(s)`);
  if (unresolved.length) {
    console.log(`[targets] ${unresolved.length} NOT ingested (unresolved):`);
    for (const u of unresolved) console.log(`    · ${u}`);
  }
  if (collisions.length) {
    console.log(`\n[targets] ⚠ ${collisions.length} MBID collision(s) — two names, one artist:`);
    for (const [mbid, ps] of collisions) {
      console.log(`    · ${mbid} ← ${ps.map((p) => p.name).join(" + ")}`);
    }
    console.log("    Resolve with --overrides (SKIP one) before applying.");
    if (APPLY) {
      console.error("\n[targets] refusing to apply with unresolved collisions.");
      process.exit(1);
    }
  }

  // The read-back: what is already there, under the same key we are about to
  // write with, BEFORE writing anything.
  const existing = await prisma.warmTarget.findMany({
    where: { artistMbid: { in: planned.map((p) => p.artistMbid) } },
    select: { artistMbid: true, name: true, source: true, weight: true, enabled: true },
  });
  const existingByMbid = new Map(existing.map((e) => [e.artistMbid, e]));

  const creates = planned.filter((p) => !existingByMbid.has(p.artistMbid));
  const updates = planned
    .map((p) => ({ p, e: existingByMbid.get(p.artistMbid) }))
    .filter(
      (x): x is { p: Planned; e: NonNullable<typeof x.e> } =>
        !!x.e && (x.e.name !== x.p.name || x.e.source !== x.p.source || x.e.weight !== x.p.weight)
    );

  console.log(`\n[targets] ${creates.length} to CREATE, ${updates.length} to UPDATE:`);
  for (const c of creates.slice(0, 10)) {
    console.log(`    + ${c.name} [${c.artistMbid}] ${c.source} w=${c.weight}`);
  }
  if (creates.length > 10) console.log(`    … and ${creates.length - 10} more`);
  for (const u of updates) {
    console.log(
      `    ~ ${u.e.name} [${u.p.artistMbid}] ${u.e.source} w=${u.e.weight} → ` +
        `${u.p.name} ${u.p.source} w=${u.p.weight}`
    );
  }

  const total = await prisma.warmTarget.count();
  console.log(`\n[targets] table currently holds ${total} row(s)`);

  if (!APPLY) {
    console.log("[targets] DRY RUN — nothing written. Re-run with --apply.");
    return;
  }

  for (const p of planned) {
    await prisma.warmTarget.upsert({
      where: { artistMbid: p.artistMbid },
      create: p,
      // `enabled` is deliberately absent: re-running ingestion must not switch a
      // target someone turned off back on.
      update: { name: p.name, source: p.source, weight: p.weight },
    });
  }
  console.log(`[targets] applied. Table now holds ${await prisma.warmTarget.count()} row(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
