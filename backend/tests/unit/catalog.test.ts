import { describe, it, expect } from "vitest";
import {
  dedupeMerge,
  normalizeText,
  candidateKey,
  stripArtistDisambiguation,
} from "../../src/services/catalog/merge.js";
import {
  mapReleaseGroupType,
  mapDiscogsFormats,
  mapSpotifyType,
} from "../../src/services/catalog/typeMapping.js";
import type { SourceCandidate } from "../../src/services/sources/types.js";

const mb = (o: Partial<SourceCandidate>): SourceCandidate => ({
  source: "musicbrainz",
  title: "In Rainbows",
  artistName: "Radiohead",
  type: "ALBUM",
  ...o,
});
const dc = (o: Partial<SourceCandidate>): SourceCandidate => ({
  source: "discogs",
  title: "In Rainbows",
  artistName: "Radiohead",
  type: "ALBUM",
  ...o,
});
const sp = (o: Partial<SourceCandidate>): SourceCandidate => ({
  source: "spotify",
  title: "In Rainbows",
  artistName: "Radiohead",
  type: "ALBUM",
  ...o,
});

describe("normalizeText / candidateKey", () => {
  it("folds case, diacritics, and punctuation", () => {
    expect(normalizeText("Björk – Homogénic!")).toBe("bjork homogenic");
    expect(candidateKey({ title: "In Rainbows", artistName: "Radiohead" })).toBe(
      candidateKey({ title: "in  rainbows.", artistName: "RADIOHEAD" })
    );
  });
});

describe("stripArtistDisambiguation (Discogs '(n)' suffix)", () => {
  it("removes a trailing numeric disambiguation suffix", () => {
    expect(stripArtistDisambiguation("Danny Brown (2)")).toBe("Danny Brown");
    expect(stripArtistDisambiguation("Nirvana (3)")).toBe("Nirvana");
    expect(stripArtistDisambiguation("John (12)")).toBe("John");
  });

  it("leaves real parentheticals and titles alone", () => {
    // Not a bare integer → kept.
    expect(stripArtistDisambiguation("Godspeed You! Black Emperor")).toBe(
      "Godspeed You! Black Emperor"
    );
    expect(stripArtistDisambiguation("Sunn O)))")).toBe("Sunn O)))");
    expect(stripArtistDisambiguation("Panic! (At The Disco)")).toBe("Panic! (At The Disco)");
    // A name that is ONLY a suffix stays intact rather than becoming empty.
    expect(stripArtistDisambiguation("(2)")).toBe("(2)");
  });

  it("makes the dedupe key collapse a suffixed artist onto the bare name", () => {
    expect(candidateKey({ title: "Old", artistName: "Danny Brown (2)" })).toBe(
      candidateKey({ title: "Old", artistName: "Danny Brown" })
    );
  });
});

describe("dedupeMerge", () => {
  it("dedupes a Discogs '(n)'-suffixed artist against the MusicBrainz release", () => {
    // Regression: 'Danny Brown (2)' from Discogs used to defeat title+artist
    // dedupe and produce a duplicate release (seen on Atrocity Exhibition, Old).
    const merged = dedupeMerge([
      mb({ title: "Atrocity Exhibition", artistName: "Danny Brown", musicbrainzId: "mb-db" }),
      dc({ title: "Atrocity Exhibition", artistName: "Danny Brown (2)", discogsId: "release:9248136" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ musicbrainzId: "mb-db", discogsId: "release:9248136" });
    // The canonical, un-suffixed name is what survives.
    expect(merged[0].artistName).toBe("Danny Brown");
  });


  it("merges the same release across sources by title+artist, unioning ids", () => {
    const merged = dedupeMerge([
      mb({ musicbrainzId: "mbid-1", coverUrl: "caa.jpg" }),
      dc({ discogsId: "d-1" }),
      sp({ spotifyId: "s-1", coverUrl: "spotify.jpg" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      musicbrainzId: "mbid-1",
      discogsId: "d-1",
      spotifyId: "s-1",
    });
    // First non-empty cover wins (MB came first).
    expect(merged[0].coverUrl).toBe("caa.jpg");
  });

  it("merges by musicbrainzId even when titles differ slightly", () => {
    const merged = dedupeMerge([
      mb({ musicbrainzId: "same", title: "In Rainbows" }),
      dc({ musicbrainzId: "same", title: "In Rainbows (Bonus)", discogsId: "d-9" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].discogsId).toBe("d-9");
  });

  it("merges by discogsId", () => {
    const merged = dedupeMerge([
      dc({ discogsId: "d-2", artistName: "Radiohead" }),
      sp({ discogsId: "d-2", title: "Completely Different", artistName: "Nobody", spotifyId: "s-2" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].spotifyId).toBe("s-2");
  });

  it("keeps genuinely different releases separate", () => {
    const merged = dedupeMerge([
      mb({ title: "In Rainbows" }),
      mb({ title: "OK Computer", musicbrainzId: "ok" }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("never merges a Discogs master with a same-numbered release (separate namespaces)", () => {
    const merged = dedupeMerge([
      dc({ discogsId: "release:9459", title: "Live At The Liquid Room", artistName: "Jeff Mills" }),
      dc({ discogsId: "master:9459", title: "Bodycage", artistName: "Nadja" }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("lets the MusicBrainz type win when merging", () => {
    const merged = dedupeMerge([
      sp({ type: "SINGLE", spotifyId: "s-3" }),
      mb({ type: "ALBUM", musicbrainzId: "mb-3" }),
    ]);
    // MB candidate processed second but its type is canonical.
    expect(merged).toHaveLength(1);
    expect(merged[0].type).toBe("ALBUM");
  });
});

describe("type mapping → full ReleaseType enum", () => {
  it("maps MusicBrainz release-group types", () => {
    expect(mapReleaseGroupType("Album")).toBe("ALBUM");
    expect(mapReleaseGroupType("EP")).toBe("EP");
    expect(mapReleaseGroupType("Single")).toBe("SINGLE");
    expect(mapReleaseGroupType("Album", ["Compilation"])).toBe("COMPILATION");
    expect(mapReleaseGroupType("Album", ["DJ-mix"])).toBe("DJ_MIX");
    expect(mapReleaseGroupType("Album", ["Mixtape/Street"])).toBe("MIXTAPE");
    expect(mapReleaseGroupType(undefined)).toBe("ALBUM");
  });

  it("maps Discogs formats, including video", () => {
    expect(mapDiscogsFormats(["DVD"])).toBe("VIDEO");
    expect(mapDiscogsFormats(["DVD"], ["Music Video"])).toBe("MUSIC_VIDEO");
    expect(mapDiscogsFormats(["Vinyl"], ["EP"])).toBe("EP");
    expect(mapDiscogsFormats(["CD"], ["Single"])).toBe("SINGLE");
    expect(mapDiscogsFormats(["CD"], ["Compilation"])).toBe("COMPILATION");
    expect(mapDiscogsFormats(["Vinyl"], ["LP", "Album"])).toBe("ALBUM");
    // CDs of DJ mixes are often marked just "Mixed".
    expect(mapDiscogsFormats(["CD"], ["Mixed"])).toBe("DJ_MIX");
    expect(mapDiscogsFormats(["CD", "Mixed"])).toBe("DJ_MIX");
  });

  it("maps Spotify album types, distinguishing a one-track SONG", () => {
    expect(mapSpotifyType("album")).toBe("ALBUM");
    expect(mapSpotifyType("single", 3)).toBe("SINGLE");
    expect(mapSpotifyType("single", 1)).toBe("SONG");
    expect(mapSpotifyType("compilation")).toBe("COMPILATION");
  });
});
