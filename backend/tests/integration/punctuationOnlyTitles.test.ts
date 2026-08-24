/**
 * 6.3e — a title the analyser erases entirely.
 *
 * The deploy canary failed on its first production run with
 * `find release "!!!" — NOT FOUND`, on a document that was indexed correctly.
 * The edge-ngram tokenizer is restricted to `token_chars: ["letter", "digit"]`,
 * so a title made only of punctuation analyses to `[]`, is stored as an empty
 * field, and cannot be matched by any text query. Not ranked low — unmatchable,
 * while plainly present in the index.
 *
 * The mixed-punctuation cases (`Neu! ’75`, `AC/DC`) survived because they have
 * letters to fall back on. These are the pure case, and they are real records.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/config/database.js";
import { es, RELEASE_INDEX, ensureIndices } from "../../src/config/elasticsearch.js";
import { esSearchReleases, indexRelease, exactKey } from "../../src/services/searchService.js";
import { runTag } from "../support/runTag.js";

const RUN = runTag("punct");
const created: string[] = [];
const ids = new Map<string, string>();

/** Every one of these is a real release or artist. */
const TITLES = [
  "!!!",
  "!!!Fuck You!!!",
  "¡Uno!",
  "#38",
  "+'''+",
  "///",
  "?",
] as const;

beforeAll(async () => {
  await ensureIndices();
  for (const title of TITLES) {
    const row = await prisma.release.create({
      data: { title, artistName: `Punct ${RUN}`, type: "ALBUM" },
    });
    created.push(row.id);
    ids.set(title, row.id);
    await indexRelease(row);
  }
  await es.indices.refresh({ index: RELEASE_INDEX }).catch(() => {});
});

afterAll(async () => {
  // §10: an explicit list of ids this file created and has looked at.
  if (created.length) {
    await prisma.release.deleteMany({ where: { id: { in: created } } });
    for (const id of created) await es.delete({ index: RELEASE_INDEX, id }).catch(() => {});
  }
  await prisma.$disconnect();
});

async function finds(query: string, title: string): Promise<boolean> {
  const hits = await esSearchReleases(query);
  return hits.some((h) => h.id === ids.get(title));
}

describe("exactKey", () => {
  it("normalises case and whitespace but never strips punctuation", () => {
    expect(exactKey("  !!!  ")).toBe("!!!");
    expect(exactKey("Neu!  ’75")).toBe("neu! ’75");
    expect(exactKey("AC/DC")).toBe("ac/dc");
    // Punctuation is the entire reason the field exists.
    expect(exactKey("???")).toBe("???");
  });
});

describe("a title made only of punctuation is still findable", () => {
  it.each(["!!!", "¡Uno!", "+'''+", "///", "?"])("finds %s by its exact title", async (t) => {
    expect(await finds(t, t)).toBe(true);
  });

  it("finds a title whose letters are wrapped in punctuation", async () => {
    expect(await finds("!!!Fuck You!!!", "!!!Fuck You!!!")).toBe(true);
  });

  it("is case- and whitespace-insensitive on the exact path", async () => {
    expect(await finds("  !!!fuck you!!!  ", "!!!Fuck You!!!")).toBe(true);
  });
});

describe("digits are queryable, not merely indexable", () => {
  // The index side sets token_chars ["letter","digit"]; the query side used the
  // LETTER-only `lowercase` tokenizer, so no digit token could ever be emitted.
  it("finds a title that is punctuation plus digits", async () => {
    expect(await finds("#38", "#38")).toBe(true);
  });

  it("finds it by the bare number too", async () => {
    expect(await finds("38", "#38")).toBe(true);
  });
});
