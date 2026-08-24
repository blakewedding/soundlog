/**
 * 6.3e — the two ways an artist name can be unsearchable.
 *
 * ## 1. Leading articles
 *
 * MusicBrainz's canonical name for the Portland band is `Chromatics`, and
 * `esSearchArtists` matches with `operator: "and"` — every query term must be
 * present. So "The Chromatics" matched NOTHING: not ranked low, zero hits,
 * because the document has no `the` token to satisfy.
 *
 * The obvious fix — strip leading articles in the analyzer — is the one that
 * must never ship, and these tests exist to keep it from shipping. `The The`,
 * `The Who` and `The Band` are real artists whose names ARE an article plus a
 * word. Analyzer-level stripping indexes them as `The`, `Who` and `Band`, so
 * searching their own canonical spelling stops finding them: the fix for the
 * colloquial spelling breaks the correct one.
 *
 * A zero-result FALLBACK cannot do that, and the difference is the whole design.
 * For `The Who` the literal query already matches, so the fallback never runs.
 *
 * ## 2. Punctuation
 *
 * Punctuation-heavy names are about to hit these paths hard. `AC/DC` contains a
 * Lucene metacharacter, `Neu! ’75` mixes a bang with a curly apostrophe, and
 * `Endtroducing.....` ends in five dots. None may become unsearchable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/config/database.js";
import { es, ARTIST_INDEX } from "../../src/config/elasticsearch.js";
import { ensureIndices } from "../../src/config/elasticsearch.js";
import { esSearchArtists, indexArtist, stripLeadingArticle } from "../../src/services/searchService.js";
import { runTag } from "../support/runTag.js";

const RUN = runTag("artpunct");
const created: string[] = [];

/**
 * Fixture names carry the run tag so they cannot collide in a shared index, and
 * the tag is letters-only (see runTag) so it analyzes to exactly one extra
 * token. Every assertion below checks for a SPECIFIC row id, never merely that
 * some result came back.
 */
const NAMES = [
  "The The",
  "The Who",
  "The Band",
  "Chromatics",
  "Neu!",
  "AC/DC",
  "Godspeed You! Black Emperor",
  "Jim O'Rourke",
  "Boards of Canada",
] as const;

const ids = new Map<string, string>();
const tagged = (name: string) => `${name} ${RUN}`;

beforeAll(async () => {
  await ensureIndices();
  for (const name of NAMES) {
    const row = await prisma.artist.create({ data: { name: tagged(name), aliases: [] } });
    created.push(row.id);
    ids.set(name, row.id);
    await indexArtist(row);
  }
  await es.indices.refresh({ index: ARTIST_INDEX }).catch(() => {});
});

afterAll(async () => {
  // §10: an explicit list of ids we created and have looked at, never a pattern.
  if (created.length) {
    await prisma.artist.deleteMany({ where: { id: { in: created } } });
    for (const id of created) {
      await es.delete({ index: ARTIST_INDEX, id }).catch(() => {});
    }
  }
  await prisma.$disconnect();
});

async function finds(query: string, name: string): Promise<boolean> {
  const hits = await esSearchArtists(query, 25);
  return hits.some((h) => h.id === ids.get(name));
}

describe("stripLeadingArticle", () => {
  it("strips a leading article, case-insensitively", () => {
    expect(stripLeadingArticle("The Chromatics")).toBe("Chromatics");
    expect(stripLeadingArticle("the chromatics")).toBe("chromatics");
    expect(stripLeadingArticle("AN Albatross")).toBe("Albatross");
    expect(stripLeadingArticle("A Silver Mt. Zion")).toBe("Silver Mt. Zion");
  });

  it("returns null when there is no leading article to strip", () => {
    expect(stripLeadingArticle("Chromatics")).toBeNull();
    expect(stripLeadingArticle("Theatre of Hate")).toBeNull(); // not "The" + "atre"
    expect(stripLeadingArticle("Anthrax")).toBeNull(); // not "An" + "thrax"
    expect(stripLeadingArticle("The")).toBeNull(); // nothing left over
  });
});

describe("the colloquial 'The X' spelling reaches the canonical artist", () => {
  it('finds Chromatics when the query says "The Chromatics"', async () => {
    expect(await finds(`The ${tagged("Chromatics")}`, "Chromatics")).toBe(true);
  });

  it("still finds it by its canonical name", async () => {
    expect(await finds(tagged("Chromatics"), "Chromatics")).toBe(true);
  });
});

describe("artists whose name IS an article — the fallback must not cost them", () => {
  // These are the regression. An index-side article char filter makes every one
  // of these fail, because the canonical spelling stops matching itself.
  it.each(["The The", "The Who", "The Band"])("finds %s by its canonical name", async (name) => {
    expect(await finds(tagged(name), name)).toBe(true);
  });
});

describe("punctuation-adversarial names stay searchable", () => {
  it.each([
    ["Neu!", "Neu!"],
    ["AC/DC", "AC/DC"],
    ["Godspeed You! Black Emperor", "Godspeed You! Black Emperor"],
    ["Jim O'Rourke", "Jim O'Rourke"],
  ])("finds %s", async (query, name) => {
    expect(await finds(tagged(query), name)).toBe(true);
  });

  it("finds AC/DC when the slash is typed as a space", async () => {
    expect(await finds(`AC DC ${RUN}`, "AC/DC")).toBe(true);
  });

  it("does not blow up on a query that is only punctuation", async () => {
    await expect(esSearchArtists("!!!", 5)).resolves.toBeInstanceOf(Array);
    await expect(esSearchArtists("/", 5)).resolves.toBeInstanceOf(Array);
    await expect(esSearchArtists('"', 5)).resolves.toBeInstanceOf(Array);
  });
});

describe("aliases are searchable", () => {
  it("finds an artist by an alias that is not its canonical name", async () => {
    const row = await prisma.artist.create({
      data: { name: `Bloody Valentine ${RUN}`, aliases: [`MBV${RUN}`, `Loveless Band ${RUN}`] },
    });
    created.push(row.id);
    await indexArtist(row);
    await es.indices.refresh({ index: ARTIST_INDEX }).catch(() => {});

    const hits = await esSearchArtists(`MBV${RUN}`, 25);
    expect(hits.some((h) => h.id === row.id)).toBe(true);
  });
});
