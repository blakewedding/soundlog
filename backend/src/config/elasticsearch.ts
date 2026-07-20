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
        avgRating: { type: "float" },
        ratingCount: { type: "integer" },
      },
    },
  });
}

// Artists — indexed at seed time; powers the Members/Artists search tabs (Phase 5).
async function ensureArtistIndex(): Promise<void> {
  const exists = await es.indices.exists({ index: ARTIST_INDEX });
  if (exists) return;

  await es.indices.create({
    index: ARTIST_INDEX,
    mappings: {
      properties: {
        name: { type: "text" },
        sortName: { type: "keyword" },
        type: { type: "keyword" },
        area: { type: "keyword" },
      },
    },
  });
}
