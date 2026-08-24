/**
 * 6.3e follow-up #9 — the junk-tap shutoff.
 *
 * `ArtistCredit` links an unresolved credit to `/search?q=<name>`. Every string
 * that reaches a link becomes a real MusicBrainz artist search the first time
 * anything walks it, so a fragment that is not a plausible artist name is not a
 * cosmetic problem: it is a cache key poisoned and an upstream slot spent.
 *
 * Every fused example here was observed in production cache keys.
 */
import { describe, expect, it } from "vitest";
import { splitArtistCredit, isSearchableName } from "./artistCreditSplit";

describe("splitArtistCredit", () => {
  it("splits the MusicBrainz joinphrases, not just commas", () => {
    expect(splitArtistCredit("ZZ Top & Gary Moore")).toEqual(["ZZ Top", "Gary Moore"]);
    expect(splitArtistCredit("Burial feat. El-B")).toEqual(["Burial", "El-B"]);
    expect(splitArtistCredit("Calvin Harris & Ellie Goulding")).toEqual([
      "Calvin Harris",
      "Ellie Goulding",
    ]);
    expect(splitArtistCredit("Rossini / Donizetti / I Solisti Italiani")).toEqual([
      "Rossini",
      "Donizetti",
      "I Solisti Italiani",
    ]);
  });

  it("still splits plain comma lists", () => {
    expect(splitArtistCredit("New Order, Joy Division")).toEqual(["New Order", "Joy Division"]);
  });

  it("NEVER splits a bare slash — AC/DC is one artist", () => {
    // A false split invents an artist that does not exist and sends a person to
    // a broken search. A false join leaves one query that matches nothing. The
    // second is strictly less harmful, so ambiguity stays joined.
    expect(splitArtistCredit("AC/DC")).toEqual(["AC/DC"]);
  });

  it("leaves single artists whose names contain separator-like text alone", () => {
    expect(splitArtistCredit("Godspeed You! Black Emperor")).toEqual([
      "Godspeed You! Black Emperor",
    ]);
    expect(splitArtistCredit("Neu!")).toEqual(["Neu!"]);
    expect(splitArtistCredit("Songs: Ohia")).toEqual(["Songs: Ohia"]);
  });

  it("always returns at least one fragment", () => {
    expect(splitArtistCredit("Slint")).toEqual(["Slint"]);
    expect(splitArtistCredit("  ")).toEqual([""]);
  });
});

describe("isSearchableName", () => {
  it("accepts real artist names, including punctuation-heavy ones", () => {
    for (const n of ["Neu!", "AC/DC", "!!!", "Songs: Ohia", "フィッシュマンズ", "WHY?"]) {
      expect(isSearchableName(n), n).toBe(true);
    }
  });

  it("rejects a fragment long enough to be a sentence, not a name", () => {
    expect(isSearchableName("A".repeat(61))).toBe(false);
    // ...but accepts genuinely long real credits.
    expect(isSearchableName("Godspeed You! Black Emperor")).toBe(true);
    expect(isSearchableName("The Brian Jonestown Massacre")).toBe(true);
  });

  it("rejects blanks", () => {
    expect(isSearchableName("")).toBe(false);
    expect(isSearchableName("   ")).toBe(false);
  });

  it("does NOT claim to detect Discogs role strings — that is an ingestion job", () => {
    // "Directed For The Stage By Peter Konwitschny" is 43 characters and
    // indistinguishable from a long artist name by any client-side rule that
    // does not also reject real credits. Asserting the current behaviour rather
    // than a guard we cannot honestly build: §3 puts marker-stripping at
    // ingestion, and that is where these belong.
    expect(isSearchableName("Directed For The Stage By Peter Konwitschny")).toBe(true);
  });
});
