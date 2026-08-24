/**
 * 6.3e — a MusicBrainz artist credit is names PLUS the punctuation that joins
 * them, and dropping the punctuation is not a cosmetic bug.
 *
 * `creditName` concatenated names with `""`, producing strings like
 * "ZZ TopGary Moore". Those are stored as `Release.artistName`, rendered by
 * `ArtistCredit`, and linked to `/search?q=<name>` under §3's navigation-
 * affordance allowance — so every one of them is a query that can never match,
 * poisoning a cache key and spending a MusicBrainz slot each time anything
 * walks the link.
 *
 * Every fused example below was observed in production cache keys.
 */
import { describe, expect, it } from "vitest";
import { creditsOf, type MBReleaseGroup } from "../../src/services/musicbrainzService.js";

const rg = (credits: Array<{ name: string; joinphrase?: string; id?: string }>): MBReleaseGroup =>
  ({
    id: "rg",
    title: "t",
    "artist-credit": credits.map((c) => ({
      name: c.name,
      joinphrase: c.joinphrase,
      artist: { id: c.id ?? "a", name: c.name },
    })),
  }) as MBReleaseGroup;

describe("artist-credit reassembly", () => {
  it("honours joinphrase instead of fusing names together", () => {
    expect(
      creditsOf(rg([{ name: "ZZ Top", joinphrase: " & " }, { name: "Gary Moore" }])).artistName
    ).toBe("ZZ Top & Gary Moore");

    expect(
      creditsOf(
        rg([{ name: "Calvin Harris", joinphrase: " & " }, { name: "Ellie Goulding" }])
      ).artistName
    ).toBe("Calvin Harris & Ellie Goulding");
  });

  it("handles a three-way classical credit with slash joins", () => {
    expect(
      creditsOf(
        rg([
          { name: "Rossini", joinphrase: "/" },
          { name: "Donizetti", joinphrase: "/" },
          { name: "I Solisti Italiani" },
        ])
      ).artistName
    ).toBe("Rossini/Donizetti/I Solisti Italiani");
  });

  it("handles feat. credits", () => {
    expect(
      creditsOf(rg([{ name: "Burial", joinphrase: " feat. " }, { name: "El-B" }])).artistName
    ).toBe("Burial feat. El-B");
  });

  it("leaves a single credit exactly as it is", () => {
    expect(creditsOf(rg([{ name: "Neu!" }])).artistName).toBe("Neu!");
    expect(creditsOf(rg([{ name: "AC/DC" }])).artistName).toBe("AC/DC");
  });

  it("drops a trailing joinphrase rather than rendering it", () => {
    // Malformed upstream data: a joinphrase on the LAST credit.
    expect(creditsOf(rg([{ name: "Slipknot", joinphrase: " & " }])).artistName).toBe("Slipknot");
  });

  it("falls back to Unknown Artist on an empty credit list", () => {
    expect(creditsOf({ id: "rg", title: "t" } as MBReleaseGroup).artistName).toBe("Unknown Artist");
  });

  it("still takes identity from the FIRST credit's MBID, never the joined string (§3)", () => {
    const out = creditsOf(
      rg([
        { name: "ZZ Top", joinphrase: " & ", id: "mbid-zz" },
        { name: "Gary Moore", id: "mbid-gary" },
      ])
    );
    expect(out.artistId).toBe("mbid-zz");
  });
});
