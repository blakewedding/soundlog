// Search canary — run on every deploy. Exits non-zero when search is broken.
//   Run from backend/:
//     npx tsx scripts/search-canary.ts
//     npx tsx scripts/search-canary.ts --json      # machine-readable for CI
//
// ## Why this exists (6.3e)
//
// Three artists were unfindable on the live site for an unknown length of time,
// and nothing we owned noticed. Every individual component reported health:
// Elasticsearch was green, the API returned HTTP 200, MusicBrainz answered a
// manual `curl` with a 200, and the search route logged nothing because an empty
// result is not an error. The failure was only ever visible END TO END, as
// "a query that should return something returns nothing".
//
// So this asserts exactly that, against artists we KNOW are indexed, through the
// real read path — and it is deliberately the crudest possible check, because
// the sophisticated ones all passed while search was broken.
//
// It catches, specifically:
//   * a hollow or dropped index (counts near zero)
//   * an index that has silently drifted from Postgres (§5: Postgres is truth,
//     so a large delta means the projection needs rebuilding)
//   * a mapping/analyzer regression that stops known documents matching
//   * the article-fallback and alias paths regressing
//
// It does NOT call MusicBrainz. A canary that depends on a third party fails
// when the third party does, which trains everyone to ignore it.
import { prisma } from "../src/config/database.js";
import { es, ARTIST_INDEX, RELEASE_INDEX } from "../src/config/elasticsearch.js";
import { esSearchArtists, esSearchReleases } from "../src/services/searchService.js";

const JSON_OUT = process.argv.includes("--json");

/** A delta larger than this between Postgres and the index is a real problem. */
const DRIFT_TOLERANCE = 0.1; // 10%

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

async function main() {
  // ---- 1. The index is not hollow -----------------------------------------
  const [pgArtists, pgReleases] = await Promise.all([
    prisma.artist.count(),
    prisma.release.count(),
  ]);
  const [esArtists, esReleases] = await Promise.all([
    es.count({ index: ARTIST_INDEX }).then((r) => r.count).catch(() => -1),
    es.count({ index: RELEASE_INDEX }).then((r) => r.count).catch(() => -1),
  ]);

  record("artist index reachable", esArtists >= 0, `docs=${esArtists}`);
  record("release index reachable", esReleases >= 0, `docs=${esReleases}`);
  record("artist index not hollow", esArtists > 0, `${esArtists} docs (Postgres holds ${pgArtists})`);
  record("release index not hollow", esReleases > 0, `${esReleases} docs (Postgres holds ${pgReleases})`);

  // ---- 2. The index has not drifted from Postgres --------------------------
  // §5: Postgres is truth and the index is a rebuildable projection, so drift is
  // not corruption — but a big gap means the projection is stale and search is
  // lying to people about what we hold.
  record(
    "artist index tracks Postgres",
    esArtists >= 0 && withinTolerance(esArtists, pgArtists),
    `es=${esArtists} pg=${pgArtists} (tolerance ${DRIFT_TOLERANCE * 100}%)`
  );
  record(
    "release index tracks Postgres",
    esReleases >= 0 && withinTolerance(esReleases, pgReleases),
    `es=${esReleases} pg=${pgReleases} (tolerance ${DRIFT_TOLERANCE * 100}%)`
  );

  // ---- 3. Known-indexed artists are actually findable ----------------------
  // Sampled from Postgres rather than hardcoded, so the canary cannot rot as the
  // catalog changes — and so it exercises whatever is really in there.
  const sample = await prisma.artist.findMany({
    where: { musicbrainzId: { not: null } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 10,
  });

  for (const artist of sample) {
    const hits = await esSearchArtists(artist.name, 10);
    const found = hits.some((h) => h.id === artist.id);
    record(`find artist "${artist.name}"`, found, found ? "found" : "*** NOT FOUND ***");
  }

  const releaseSample = await prisma.release.findMany({
    select: { id: true, title: true },
    orderBy: { title: "asc" },
    take: 5,
  });
  for (const release of releaseSample) {
    const hits = await esSearchReleases(release.title);
    const found = hits.some((h) => h.id === release.id);
    record(`find release "${release.title}"`, found, found ? "found" : "*** NOT FOUND ***");
  }

  // ---- 4. The article fallback still works ---------------------------------
  // An artist whose canonical name carries no leading article must still be
  // reachable by the colloquial "The X" spelling. This is the Chromatics case.
  const noArticle = sample.find((a) => !/^(the|a|an)\s/i.test(a.name));
  if (noArticle) {
    const hits = await esSearchArtists(`The ${noArticle.name}`, 10);
    const found = hits.some((h) => h.id === noArticle.id);
    record(
      `article fallback: "The ${noArticle.name}" -> ${noArticle.name}`,
      found,
      found ? "found" : "*** NOT FOUND — fallback regressed ***"
    );
  }

  // ---- 4b. A title the analyser erases --------------------------------------
  // The canary's first production run failed exactly here: `find release "!!!"`
  // — NOT FOUND, on a document that was indexed correctly, because a title made
  // only of punctuation analyses to nothing. Sampled from the catalogue rather
  // than hardcoded, so it exercises whatever punctuation-heavy titles are real.
  const punctuated = releaseSample.concat(
    await prisma.release.findMany({
      where: { title: { not: { contains: " " } } },
      select: { id: true, title: true },
      take: 40,
    })
  );
  const analyzerProof = punctuated.find((r) => !/[a-z0-9]/i.test(r.title));
  if (analyzerProof) {
    const hits = await esSearchReleases(analyzerProof.title);
    const found = hits.some((h) => h.id === analyzerProof.id);
    record(
      `punctuation-only title "${analyzerProof.title}"`,
      found,
      found ? "found" : "*** NOT FOUND — the keyword fallback regressed ***"
    );
  } else {
    record("punctuation-only title", true, "skipped — no such title in the catalogue");
  }

  // ---- 5. Aliases are indexed and searchable ------------------------------
  const withAlias = await prisma.artist.findFirst({
    where: { aliases: { isEmpty: false } },
    select: { id: true, name: true, aliases: true },
  });
  if (withAlias) {
    const alias = withAlias.aliases[0];
    const hits = await esSearchArtists(alias, 10);
    const found = hits.some((h) => h.id === withAlias.id);
    record(
      `alias search: "${alias}" -> ${withAlias.name}`,
      found,
      found ? "found" : "*** NOT FOUND — aliases not indexed? ***"
    );
  } else {
    record("alias search", true, "skipped — no artist has aliases yet");
  }

  report();
}

function withinTolerance(a: number, b: number): boolean {
  if (b === 0) return a === 0;
  return Math.abs(a - b) / b <= DRIFT_TOLERANCE;
}

function report(): void {
  const failed = checks.filter((c) => !c.ok);
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
  } else {
    console.log("\n[canary] search end-to-end\n");
    for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name} — ${c.detail}`);
    console.log(
      `\n[canary] ${checks.length - failed.length}/${checks.length} passed` +
        (failed.length ? ` — ${failed.length} FAILING` : "")
    );
  }
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("[canary] crashed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
