// Resolve warming-list NAMES to MusicBrainz artist MBIDs — and refuse to guess.
//   Run from backend/:  npx tsx scripts/warm-resolve.ts <list.md> [--out report.tsv]
//
// This script WRITES NOTHING to the database. It is the first half of ingestion,
// deliberately split off, because the step that turns a name into an identity is
// the step this project has been burned by: §3 forbids inferring identity from a
// name, and 6.2c (American Football) is what it looks like when something does it
// anyway — one artist seeded, its name-twins made unreachable.
//
// So the contract here is narrow and it is the whole point:
//
//   - A name resolves ONLY when exactly one candidate matches it after
//     normalization. Normalization (case, punctuation, diacritics, "&"/"and")
//     decides whether to ASK, never which candidate to PICK. Two survivors is a
//     question for a human, not a tiebreak for a script.
//   - Zero matches is equally a question. A near-miss is how "Osees" quietly
//     becomes "Thee Oh Sees" — possibly right, but not something to assume.
//   - MusicBrainz's own `score` is REPORTED and never acted on. It ranks text
//     similarity, which is precisely the signal §3 says is not identity.
//
// Free side effect, worth knowing: resolution goes through
// `searchMusicBrainzArtists`, which caches for 7 days — so this run also warms
// the `mb:artist:search:<name>` layer for every name on the list. Re-running is
// therefore nearly free, and the first real sweep has one less layer to fetch.
import { readFileSync, writeFileSync } from "node:fs";
import { redis } from "../src/config/redis.js";
import { runAtTier } from "../src/services/upstreamPriority.js";
import { searchMusicBrainzArtists, type MBArtist } from "../src/services/musicbrainzService.js";

const args = process.argv.slice(2);
const listPath = args.find((a) => !a.startsWith("--"));
const outIdx = args.indexOf("--out");
const outPath = outIdx !== -1 ? args[outIdx + 1] : "warm-resolution.tsv";

if (!listPath) {
  console.error("usage: npx tsx scripts/warm-resolve.ts <list.md> [--out report.tsv]");
  process.exit(1);
}

/**
 * Names the ruling excludes from WARMING. Not a block list and not a moderation
 * decision about the catalog: users may still seed these organically. The warming
 * list is editorial, and this is the editorial line.
 */
const EXCLUDED = new Set(["burzum", "death in june"]);

/**
 * Comparison form. Used ONLY to decide whether a name is unambiguous enough to
 * resolve without asking — never to choose between two candidates.
 */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics: Motörhead ↔ Motorhead
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\bthe\b/g, "") // "The Fall" ↔ "Fall" — MB is inconsistent about it
    .trim()
    .replace(/\s+/g, " ");
}

/** Every alias MusicBrainz lists, plus the artist's own name and sort-name. */
function namesOf(a: MBArtist): string[] {
  const names = [a.name, a["sort-name"] ?? "", ...(a.aliases ?? []).map((x) => x.name ?? "")];
  return names.filter(Boolean);
}

function matches(a: MBArtist, wanted: string): boolean {
  return namesOf(a).some((n) => normalize(n) === wanted);
}

/**
 * Parse the list. The section headers are editing scaffolding, not data — only
 * the `·`-separated name runs are read. `⚠` is the author's own pre-guess at
 * ambiguity and is stripped: this script's resolution is the arbiter, and
 * trusting the flag would mean skipping the check on everything unflagged.
 */
function parseNames(md: string): string[] {
  const names: string[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(">") || line.startsWith("---")) continue;
    if (line.startsWith("-") || line.startsWith("*")) continue; // prose bullets
    if (!line.includes("·")) continue; // every name run uses the separator
    for (const piece of line.split("·")) {
      let name = piece.replace(/⚠/g, "").trim();
      // An inline editorial strike ("… — *strike this line …*") marks a
      // placeholder rather than an artist. Drop the annotation and the name.
      if (/\*strike this line/i.test(name)) continue;
      name = name.replace(/\s*—\s*\*.*$/, "").trim();
      if (name) names.push(name);
    }
  }
  return names;
}

type Verdict = "resolved" | "ambiguous" | "no-match" | "excluded";

interface Row {
  name: string;
  verdict: Verdict;
  mbid: string;
  detail: string;
}

function describe(a: MBArtist & { score?: number }): string {
  const bits = [
    a.type,
    a.country ?? a.area?.name,
    a["life-span"]?.begin,
    a.disambiguation ? `“${a.disambiguation}”` : "",
    a.score !== undefined ? `score ${a.score}` : "",
  ].filter(Boolean);
  return `${a.name} [${a.id}] ${bits.join(" · ")}`;
}

async function main() {
  await redis.connect().catch(() => console.warn("[resolve] Redis unavailable — no cache reuse"));

  const names = parseNames(readFileSync(listPath!, "utf8"));
  const unique = [...new Set(names)];
  console.log(`[resolve] ${names.length} names parsed, ${unique.length} unique`);
  if (names.length !== unique.length) {
    const seen = new Set<string>();
    const dupes = names.filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
    console.log(`[resolve] duplicates dropped: ${[...new Set(dupes)].join(", ")}`);
  }

  // Parsing is the step most likely to be quietly wrong — a separator missed, a
  // header swallowed as a name — and it costs nothing to check before spending
  // five minutes of throttle on it.
  if (args.includes("--parse-only")) {
    console.log(unique.join("\n"));
    await redis.quit().catch(() => {});
    return;
  }

  const rows: Row[] = [];
  let done = 0;

  for (const name of unique) {
    done++;
    if (EXCLUDED.has(normalize(name)) || EXCLUDED.has(name.toLowerCase())) {
      rows.push({ name, verdict: "excluded", mbid: "", detail: "excluded by ruling" });
      continue;
    }

    // `background`: nobody is waiting on this, and it must yield to every click.
    const candidates = (await runAtTier("background", () =>
      searchMusicBrainzArtists(name)
    )) as Array<MBArtist & { score?: number }>;

    const wanted = normalize(name);
    const exact = candidates.filter((c) => matches(c, wanted));

    if (exact.length === 1) {
      rows.push({ name, verdict: "resolved", mbid: exact[0].id, detail: describe(exact[0]) });
    } else if (exact.length > 1) {
      rows.push({
        name,
        verdict: "ambiguous",
        mbid: "",
        detail: exact.map(describe).join(" || "),
      });
    } else {
      rows.push({
        name,
        verdict: "no-match",
        mbid: "",
        detail: candidates.slice(0, 4).map(describe).join(" || ") || "no candidates returned",
      });
    }

    if (done % 25 === 0) console.log(`[resolve] ${done}/${unique.length}`);
  }

  const header = "name\tverdict\tmbid\tdetail";
  const body = rows.map((r) => [r.name, r.verdict, r.mbid, r.detail].join("\t")).join("\n");
  writeFileSync(outPath, `${header}\n${body}\n`);

  const count = (v: Verdict) => rows.filter((r) => r.verdict === v).length;
  console.log(
    `\n[resolve] resolved ${count("resolved")} · ambiguous ${count("ambiguous")} · ` +
      `no-match ${count("no-match")} · excluded ${count("excluded")}`
  );
  console.log(`[resolve] report written to ${outPath}`);
  await redis.quit().catch(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
