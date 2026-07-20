import { describe, it, expect } from "vitest";
import { dedupeMerge, normalizeText, candidateKey } from "../../src/services/catalog/merge.js";
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

describe("dedupeMerge", () => {
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
