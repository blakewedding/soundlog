// The same-artist, same-title trap — §3's canonical failure, with the real pair
// that hit production.
//
// MusicBrainz lists FOUR distinct self-titled American Football albums:
//
//   8e40a68c-58e8-3c92-a763-645fda2ce8a7   1999-09-14   the debut
//   f98334d4-5eb5-48b2-820b-faa8db645c10   2016-09-30   LP2
//   e19106eb-74a7-4ddf-b52b-381788f447f1   2019-03-22   LP3
//   0ea364bc-243b-4d6b-92ec-521b3a363cff   2026-05-01   LP4
//
// Byte-identical titles, byte-identical artist names, four different records.
// Any matcher that falls back to title+artist without checking the ids it
// already holds will collapse them, and the result is not a visible duplicate —
// it is one row wearing one album's MBID and another album's date, which looks
// perfectly ordinary until you notice the cover belongs to a different record.
// That is what shipped: the 2016 album, dated 1999.
//
// These are unit tests over the pure merge layer because that is where the fault
// lived, and because the fixtures are real MBIDs rather than invented ones — the
// trap is a property of this catalog, not of a hypothetical.
import { describe, it, expect } from "vitest";
import { candidateKey, dedupeMerge, idsContradict } from "../../src/services/catalog/merge.js";
import type { SourceCandidate } from "../../src/services/sources/types.js";

const AF = "American Football";
const LP1 = "8e40a68c-58e8-3c92-a763-645fda2ce8a7";
const LP2 = "f98334d4-5eb5-48b2-820b-faa8db645c10";
const LP3 = "e19106eb-74a7-4ddf-b52b-381788f447f1";

function mb(musicbrainzId: string, year: string): SourceCandidate {
  return {
    source: "musicbrainz",
    title: AF,
    artistName: AF,
    musicbrainzId,
    year,
    type: "ALBUM",
  } as SourceCandidate;
}

describe("the American Football trap", () => {
  it("keeps four same-titled albums as four candidates", () => {
    const merged = dedupeMerge([mb(LP1, "1999"), mb(LP2, "2016"), mb(LP3, "2019")]);
    expect(merged).toHaveLength(3);
    expect(merged.map((c) => c.musicbrainzId).sort()).toEqual([LP1, LP2, LP3].sort());
  });

  it("never lets one album's year land on another album's MBID", () => {
    // The precise production symptom: MBID f98334d4 (2016) carrying 1999.
    const merged = dedupeMerge([mb(LP1, "1999"), mb(LP2, "2016")]);
    const byId = new Map(merged.map((c) => [c.musicbrainzId, c.year]));
    expect(byId.get(LP1)).toBe("1999");
    expect(byId.get(LP2)).toBe("2016");
  });

  it("collapses them under the OLD rule — the regression this pins", () => {
    // Demonstrates the bug rather than describing it: with the id guard removed,
    // the name key alone matches and three albums become one.
    const a = mb(LP1, "1999");
    const b = mb(LP2, "2016");
    expect(candidateKey(a)).toBe(candidateKey(b)); // identical strings, different records
    expect(idsContradict(a, b)).toBe(true); // …and the ids say so
  });
});

describe("idsContradict", () => {
  it("is true only when ids of the SAME kind disagree", () => {
    expect(idsContradict(mb(LP1, "1999"), mb(LP2, "2016"))).toBe(true);
    expect(idsContradict(mb(LP1, "1999"), mb(LP1, "1999"))).toBe(false);
  });

  it("is false when one side simply has no id", () => {
    // The fallback's legitimate job: a Discogs hit with no MBID beside a
    // MusicBrainz one is plausibly the same release, and nothing contradicts it.
    const withId = mb(LP1, "1999");
    const without = { source: "discogs", title: AF, artistName: AF, year: "1999" } as SourceCandidate;
    expect(idsContradict(withId, without)).toBe(false);
  });

  it("still merges the same release across sources that share no id", () => {
    const merged = dedupeMerge([
      mb(LP1, "1999"),
      { source: "discogs", title: AF, artistName: AF, discogsId: "master:12345" } as SourceCandidate,
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].musicbrainzId).toBe(LP1);
    expect(merged[0].discogsId).toBe("master:12345");
  });

  it("catches contradicting Discogs ids too, not only MusicBrainz", () => {
    const a = { source: "discogs", title: AF, artistName: AF, discogsId: "master:1" } as SourceCandidate;
    const b = { source: "discogs", title: AF, artistName: AF, discogsId: "master:2" } as SourceCandidate;
    expect(idsContradict(a, b)).toBe(true);
    expect(dedupeMerge([a, b])).toHaveLength(2);
  });
});

describe("the fallback that remains", () => {
  it("still collapses genuine duplicates with no ids at all", () => {
    // Nothing here carries an id, so the name is all anyone has — and §3 permits
    // it precisely because there is no evidence to contradict.
    const a = { source: "discogs", title: "Kid A", artistName: "Radiohead" } as SourceCandidate;
    const b = { source: "spotify", title: "kid a", artistName: "radiohead" } as SourceCandidate;
    expect(dedupeMerge([a, b])).toHaveLength(1);
  });

  it("still strips the Discogs disambiguation suffix", () => {
    // The 6.2a-era fixture trap, and a pre-existing law: "Danny Brown (2)" must
    // collapse into "Danny Brown", not duplicate.
    const a = { source: "musicbrainz", title: "Atrocity Exhibition", artistName: "Danny Brown" } as SourceCandidate;
    const b = { source: "discogs", title: "Atrocity Exhibition", artistName: "Danny Brown (2)" } as SourceCandidate;
    expect(dedupeMerge([a, b])).toHaveLength(1);
  });
});
