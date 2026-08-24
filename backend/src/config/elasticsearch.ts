import { Client } from "@elastic/elasticsearch";
import { env } from "./env.js";

export const es = new Client({ node: env.ELASTICSEARCH_NODE });

export const RELEASE_INDEX = "releases";
export const ARTIST_INDEX = "artists";
export const USER_INDEX = "users";
export const LIST_INDEX = "lists";
export const LABEL_INDEX = "labels";

/**
 * Idempotent index bootstrap. Called once at server start; each index is
 * checked independently so adding a new one doesn't require a wipe.
 * edge_ngram analyzer powers search-as-you-type across the catalog.
 */
export async function ensureIndices(): Promise<void> {
  await ensureReleaseIndex();
  await ensureArtistIndex();
  await ensureSimpleIndex(USER_INDEX, {
    username: { type: "text" },
    displayName: { type: "text" },
    bio: { type: "text" },
  });
  await ensureSimpleIndex(LIST_INDEX, {
    title: { type: "text" },
    description: { type: "text" },
    username: { type: "keyword" },
    itemCount: { type: "integer" },
  });
  await ensureSimpleIndex(LABEL_INDEX, {
    name: { type: "text" },
    area: { type: "keyword" },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureSimpleIndex(index: string, properties: Record<string, any>): Promise<void> {
  const exists = await es.indices.exists({ index });
  if (exists) return;
  await es.indices.create({ index, mappings: { properties } });
}

/**
 * The analyzer-proof half of the release mapping.
 *
 * ## Why a keyword fallback exists at all (6.3e)
 *
 * The deploy canary failed on its first production run with
 * `find release "!!!" — NOT FOUND`, and the document was indexed correctly. Its
 * TITLE analysed to nothing:
 *
 *   "!!!"  index -> []   query -> []
 *
 * An edge-ngram tokenizer restricted to `token_chars: ["letter", "digit"]`
 * erases a title made entirely of punctuation, so the field is stored empty and
 * no text query can ever match it. Not ranked low — unmatchable by
 * construction, and invisible because the document is plainly there.
 *
 * `!!!`, `!!!Fuck You!!!`, `¡Uno!` and `…` are real releases. So each text
 * field carries a `keyword` twin holding the raw string lowercased, written by
 * `indexRelease`, and the query ORs a `term` against it. Analysis cannot erase a
 * keyword.
 *
 * These are ADDITIVE: Elasticsearch accepts new fields on a live mapping. But a
 * new subfield is only populated when a document is next written, so existing
 * documents need a rebuild from Postgres — §5's "the index is a rebuildable
 * projection", cashed in. See `scripts/reindex-releases.ts`, which builds
 * alongside the live index and never drops it.
 */
const RELEASE_EXACT_PROPERTIES = {
  titleExact: { type: "keyword", ignore_above: 256 },
  artistNameExact: { type: "keyword", ignore_above: 256 },
  /**
   * A plain `standard`-analysed twin, for everything the edge-ngram pair
   * mishandles that a keyword cannot rescue.
   *
   * The edge-ngram pair is asymmetric: the index side sets
   * `token_chars: ["letter", "digit"]` and stores digits, while the query side's
   * `lowercase` tokenizer is LETTER-only and cannot emit a digit token at all.
   * So `38` could never match a release called `#38`, and `Neu! ’75` could never
   * outrank `Neu! 4`. The keyword twin fixes the exact string but not a partial
   * one, which is what someone typing `38` is giving us.
   *
   * The obvious fix — repoint `autocomplete_search` at the `standard` tokenizer
   * — is an ANALYSIS SETTING, and Elasticsearch requires a closed index to
   * change one. Closing the live search index to fix search is the wrong trade.
   * A subfield using a BUILT-IN analyzer needs no settings change at all: it is
   * purely additive, applies to a live index, and the corrected
   * `autocomplete_search` definition above still lands on any index built fresh.
   */
  titleStd: { type: "text", analyzer: "standard" },
  artistNameStd: { type: "text", analyzer: "standard" },
} as const;

async function ensureReleaseIndex(): Promise<void> {
  const exists = await es.indices.exists({ index: RELEASE_INDEX });
  if (exists) {
    // Additive and idempotent. The search_analyzer change above is query-time,
    // so it also applies to a live index without touching stored tokens.
    await es.indices.putMapping({
      index: RELEASE_INDEX,
      properties: { ...RELEASE_EXACT_PROPERTIES },
    });
    return;
  }

  await es.indices.create({
    index: RELEASE_INDEX,
    settings: {
      analysis: {
        analyzer: {
          autocomplete: {
            type: "custom",
            tokenizer: "autocomplete_tokenizer",
            filter: ["lowercase", "asciifolding"],
          },
          /**
           * Query-side analyzer.
           *
           * `standard`, NOT the `lowercase` tokenizer. The latter is a LETTER
           * tokenizer with a lowercase filter, so it cannot emit a digit token
           * at all — while the index side sets
           * `token_chars: ["letter", "digit"]` and happily indexes them. The
           * pair was asymmetric: every digit in the catalogue was indexed and
           * none of it was reachable. `Neu! '75` and `Neu! 75` both analysed to
           * `["neu"]`, so `Neu! ’75` could never outrank `Neu! 4`, and a
           * release called `#38` was unfindable by its own title.
           *
           * Query-time only, so this can be updated on a live index without a
           * reindex — no stored token changes.
           */
          autocomplete_search: {
            type: "custom",
            tokenizer: "standard",
            filter: ["lowercase", "asciifolding"],
          },
        },
        tokenizer: {
          autocomplete_tokenizer: {
            type: "edge_ngram",
            min_gram: 2,
            max_gram: 15,
            token_chars: ["letter", "digit"],
          },
        },
      },
    },
    mappings: {
      properties: {
        title: { type: "text", analyzer: "autocomplete", search_analyzer: "autocomplete_search" },
        artistName: { type: "text", analyzer: "autocomplete", search_analyzer: "autocomplete_search" },
        // Exact, analyzer-proof fallbacks. See RELEASE_EXACT_PROPERTIES.
        titleExact: { type: "keyword", ignore_above: 256 },
        artistNameExact: { type: "keyword", ignore_above: 256 },
        titleStd: { type: "text", analyzer: "standard" },
        artistNameStd: { type: "text", analyzer: "standard" },
        artistId: { type: "keyword" },
        type: { type: "keyword" },
        genres: { type: "keyword" },
        releaseDate: { type: "date" },
        coverUrl: { type: "keyword", index: false },
        coverColor: { type: "keyword", index: false },
        avgRating: { type: "float" },
        ratingCount: { type: "integer" },
      },
    },
  });
}

/**
 * The artist mapping.
 *
 * `aliases` is multi-valued and uses the SAME analyzer as `name` (both plain
 * `text`, i.e. the standard analyzer) so an alias matches exactly the way a
 * canonical name does. It is search-only: §3 keeps identity on the MBID, and
 * aliases are explicitly not unique — several unrelated acts share one.
 */
const ARTIST_PROPERTIES = {
  name: { type: "text" },
  aliases: { type: "text" },
  sortName: { type: "keyword" },
  type: { type: "keyword" },
  area: { type: "keyword" },
} as const;

/**
 * Artists — indexed at seed time; powers the Members/Artists search tabs.
 *
 * ## Why this does more than `create` (6.3e)
 *
 * `ensureArtistIndex` used to return early when the index existed, which is
 * correct for creation and silently wrong for EVOLUTION: adding `aliases` to the
 * literal above would have taken effect only on a machine that had never run
 * before, so it would work in tests and on a fresh dev box and do nothing at all
 * in production. That is the worst shape a schema change can have.
 *
 * Elasticsearch can add a NEW field to a live mapping in place, with no reindex
 * and no downtime — existing documents simply have no value for it until they
 * are next written. So an existing index gets a `putMapping` instead of a skip.
 * (This only works for additive changes; changing an existing field's type or
 * analyzer still needs build-new-index-then-swap-alias.)
 */
async function ensureArtistIndex(): Promise<void> {
  const exists = await es.indices.exists({ index: ARTIST_INDEX });
  if (!exists) {
    await es.indices.create({
      index: ARTIST_INDEX,
      mappings: { properties: { ...ARTIST_PROPERTIES } },
    });
    return;
  }

  // Additive only, and idempotent: re-putting an identical field is a no-op.
  await es.indices.putMapping({
    index: ARTIST_INDEX,
    properties: { aliases: { type: "text" } },
  });
}
