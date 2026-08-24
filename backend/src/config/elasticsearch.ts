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

async function ensureReleaseIndex(): Promise<void> {
  const exists = await es.indices.exists({ index: RELEASE_INDEX });
  if (exists) return;

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
          autocomplete_search: {
            type: "custom",
            tokenizer: "lowercase",
            filter: ["asciifolding"],
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
