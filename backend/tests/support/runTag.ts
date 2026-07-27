/**
 * A per-file fixture tag that cannot collide **in the search index**.
 *
 * ## Why `Date.now().toString(36)` is not enough
 *
 * Almost every integration file tags its fixtures with a run id so rows can be
 * created and cleaned up without colliding, and the usual idiom is
 * `Date.now().toString(36)`. That is perfectly unique as a STRING, and it is not
 * unique once Elasticsearch has analyzed it.
 *
 * The release index uses an edge-ngram `autocomplete` analyzer, and its search
 * analyzer splits letter/digit runs. A tag like `ms3jrtg7` tokenizes to
 * `["ms", "jrtg"]` — so every fixture created in the same era shares the leading
 * `ms` token, and a search for one file's fixture matches every other file's.
 *
 * That is invisible to most tests, which look their fixture up by id. It is not
 * invisible to the two that assert on SEARCH: `searchCatalog` returns early
 * without fanning out to live sources once Elasticsearch already has
 * `THIN_RESULTS` (5) matches, so a query that accidentally matches five other
 * files' fixtures never reaches the mocked MusicBrainz, and the test's own
 * title is simply absent from the results. The failure looks like a broken
 * fan-out and is actually a naming collision.
 *
 * Diagnosed in 6.2a after this presented as an intermittent, moving failure
 * across `catalog.test.ts` and `discogsSeed.test.ts` — the only two files that
 * assert on search. It survived the vitest single-fork split precisely because
 * it was never a parallelism problem: sequential files still share one index.
 *
 * ## What this returns
 *
 * Letters only, so it analyzes to exactly ONE token with no shared prefix, and
 * long enough that two runs colliding is not a practical concern. Use it
 * anywhere a fixture's name can reach Elasticsearch.
 */
const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

export function runTag(prefix = ""): string {
  let out = "";
  // 12 letters ≈ 56 bits. Random rather than time-derived on purpose: time is
  // exactly what produces the shared prefix this exists to avoid.
  for (let i = 0; i < 12; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `${prefix}${out}`;
}
