/**
 * 6.3 — the genre allowlist.
 *
 * The bug: *Transaction de Novo* rendered five chips and zero genres —
 * `favorito`, `totec radio`, `these tags suck`, `delicate and nostalgic`,
 * `whitesabbat` — past a popularity floor of 5, because every one of them scored
 * 33 or better on Last.fm's RELATIVE weight scale.
 *
 * What these pin is the two-sided property. Junk must die, but the far more
 * dangerous failure is over-filtering: a pure MusicBrainz allowlist drops bare
 * `alternative` and `indie`, our two most-used chips at 147 uses each, and would
 * have been a worse regression than the bug it fixed.
 */
import { describe, it, expect } from "vitest";
import {
  canonicalGenre,
  canonicalGenres,
  normalizeGenre,
} from "../../src/services/genreVocabulary.js";
import { MB_GENRE_SNAPSHOT } from "../../src/services/genre/mbGenreSnapshot.js";
import {
  GENRE_SUPPLEMENT,
  GENRE_ALIASES,
} from "../../src/services/genre/genreSupplement.js";
import { hasInformativeWeights } from "../../src/services/lastfmService.js";

/** The snapshot allow-set, built the same way the service builds it. */
const ALLOW = new Set<string>([
  ...MB_GENRE_SNAPSHOT.map(normalizeGenre),
  ...GENRE_SUPPLEMENT.map(normalizeGenre),
  ...Object.values(GENRE_ALIASES).map(normalizeGenre),
]);

const keep = (t: string) => canonicalGenre(t, ALLOW);

describe("genre allowlist", () => {
  it("drops every tag that shipped on Transaction de Novo", () => {
    // The exact payload from production, weights included, all >= 33.
    const observed = [
      "favorito",
      "totec radio",
      "these tags suck",
      "delicate and nostalgic",
      "best record ever",
      "whitesabbat",
    ];
    expect(canonicalGenres(observed, ALLOW)).toEqual([]);
  });

  it("keeps the umbrella genres MusicBrainz does not carry", () => {
    // The over-filtering guard. These are absent from the 2,184-entry
    // vocabulary and are the two most common chips in the catalog.
    expect(keep("alternative")).toBe("alternative");
    expect(keep("indie")).toBe("indie");
    for (const g of GENRE_SUPPLEMENT) expect(keep(g)).toBe(g);
  });

  it("matches regardless of separators, because taggers and MB disagree", () => {
    // MusicBrainz spells these `post-rock`, `synth-pop`, `dark wave`.
    for (const variant of ["post rock", "post-rock", "synthpop", "synth-pop", "darkwave"]) {
      expect(keep(variant), variant).not.toBeNull();
    }
  });

  it("resolves variant spellings to their canonical MusicBrainz term", () => {
    expect(keep("alt-country")).toBe("alternative country");
    expect(keep("prog rock")).toBe("progressive rock");
    expect(keep("rnb")).toBe("r&b");
    expect(keep("ost")).toBe("soundtrack");
    expect(keep("doom jazz")).toBe("dark jazz");
  });

  it("drops decades and release-year tags — the field is genres", () => {
    for (const d of ["80s", "90s", "1970s", "2020s", "00s", "2017 releases"]) {
      expect(keep(d), d).toBeNull();
    }
    // But a genre that merely CONTAINS digits survives.
    expect(keep("2 tone")).toBe("2 tone");
  });

  it("drops the non-genre categories a denylist could never enumerate", () => {
    const junk = [
      "4ad", // label
      "secretly canadian", // label
      "albini", // producer
      "alec empire", // artist
      "savonlinna", // place
      "albuns de 2018 que ouvi", // another language
      "1001 albums you must hear before you die", // list membership
      "album not for me", // personal note
      "wrong tag", // meta
      "live album", // format
    ];
    expect(canonicalGenres(junk, ALLOW)).toEqual([]);
  });

  it("de-duplicates after aliasing, so one genre yields one chip", () => {
    // `score` and `film score` both resolve to `soundtrack`.
    expect(canonicalGenres(["score", "film score", "soundtrack"], ALLOW)).toEqual(["soundtrack"]);
  });

  it("preserves order, so Last.fm's ranking survives filtering", () => {
    expect(canonicalGenres(["shoegaze", "junk-nonsense-tag", "slowcore"], ALLOW)).toEqual([
      "shoegaze",
      "slowcore",
    ]);
  });
});

describe("weight informativeness", () => {
  it("rejects the degenerate spread that let the junk through", () => {
    // Transaction de Novo: three taggers, six tags, three distinct values.
    expect(hasInformativeWeights([100, 100, 66, 66, 33, 33])).toBe(false);
  });

  it("accepts a genuinely graded spread", () => {
    // Bedhead at the ARTIST level, where the weights do mean something.
    expect(hasInformativeWeights([100, 49, 32, 23, 11, 3, 1, 1])).toBe(true);
  });

  it("treats absent weights as uninformative rather than as zero", () => {
    // 43% of cached payloads carry no counts at all. Reading that as "every tag
    // scores 0" would discard the whole set instead of filtering it.
    expect(hasInformativeWeights([0, 0, 0, 0, 0])).toBe(false);
    expect(hasInformativeWeights([])).toBe(false);
  });
});
