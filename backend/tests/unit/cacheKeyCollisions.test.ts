/**
 * 6.3e — punctuation-adversarial names must not collide in a cache key.
 *
 * Several caches are keyed `prefix:${artist}:${title}` with both parts
 * interpolated raw, and one of them (`discogs:covermatch`) holds an ARTWORK URL.
 * A collision there serves one record's sleeve for another — the wrong-cover
 * failure §3 exists to prevent, arriving through the cache instead of through
 * identity resolution.
 *
 * `Songs: Ohia` is in the catalog today, so this is not hypothetical.
 */
import { describe, expect, it } from "vitest";
import { keyPart } from "../../src/services/cache.js";

/** The adversarial set: every one of these is a real artist or album. */
const NAMES = [
  "Neu! '75",
  "Neu! ’75", // the same title with MusicBrainz's curly apostrophe
  "Endtroducing.....",
  "Tomorrow's Harvest",
  "Surf's Up",
  "Jim O'Rourke",
  "AC/DC",
  "Godspeed You! Black Emperor",
  "Songs: Ohia",
  "WHY?",
  "Guns N' Roses",
  "フィッシュマンズ",
];

const key = (artist: string, title: string) => `x:${keyPart(artist)}:${keyPart(title)}`;

describe("keyPart", () => {
  it("keeps a colon inside a value from acting as a delimiter", () => {
    // The collision, stated directly. Before the fix these produced the
    // identical string `x:songs: ohia:didn't it rain`.
    expect(key("Songs: Ohia", "Didn't It Rain")).not.toBe(key("Songs", "Ohia:Didn't It Rain"));
  });

  it("is case- and whitespace-insensitive, so one record has one key", () => {
    expect(keyPart("  AC/DC  ")).toBe(keyPart("ac/dc"));
    expect(keyPart("Tomorrow's Harvest")).toBe(keyPart("TOMORROW'S HARVEST"));
  });

  it("survives every punctuation-adversarial name without collapsing", () => {
    const keys = NAMES.map((n) => keyPart(n));
    expect(new Set(keys).size).toBe(NAMES.length);
  });

  it("gives every artist/title PAIR in the set a distinct key", () => {
    const pairs: string[] = [];
    for (const a of NAMES) for (const t of NAMES) pairs.push(key(a, t));
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("produces a key with no raw whitespace or delimiter characters", () => {
    for (const n of NAMES) {
      const k = keyPart(n);
      expect(k).not.toMatch(/[\s:]/);
    }
  });

  it("distinguishes the ASCII and curly apostrophe forms of one title", () => {
    // These ARE different strings and get different keys. That is correct: they
    // are two spellings, each cached separately, and both resolve to the same
    // release-group MBID upstream — identity is the MBID, never the key (§3).
    expect(keyPart("Neu! '75")).not.toBe(keyPart("Neu! ’75"));
  });
});
