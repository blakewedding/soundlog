// Phase 5.6.1 — non-Latin artist names. Fishmans displayed only as
// フィッシュマンズ: unreadable for most users and impossible to type. We store a
// Latin rendering from MusicBrainz aliases and display "Latin (Original)".
import { describe, it, expect } from "vitest";
import { isNonLatin, pickLatinName, type MBArtist } from "../../src/services/musicbrainzService.js";

const artist = (o: Partial<MBArtist>): MBArtist => ({ id: "x", name: "x", ...o });

describe("isNonLatin", () => {
  it("detects scripts a Latin reader can't read", () => {
    expect(isNonLatin("フィッシュマンズ")).toBe(true); // Japanese
    expect(isNonLatin("파란노을")).toBe(true); // Korean
    expect(isNonLatin("Мумий Тролль")).toBe(true); // Cyrillic
    expect(isNonLatin("崔健")).toBe(true); // Han
  });

  it("leaves Latin names (including accents) alone", () => {
    expect(isNonLatin("Fishmans")).toBe(false);
    expect(isNonLatin("Björk")).toBe(false);
    expect(isNonLatin("Sigur Rós")).toBe(false);
    expect(isNonLatin("Godspeed You! Black Emperor")).toBe(false);
  });
});

describe("pickLatinName", () => {
  it("prefers a primary English-locale alias", () => {
    expect(
      pickLatinName(
        artist({
          name: "フィッシュマンズ",
          aliases: [
            { name: "Fisshumanzu", locale: "ja" },
            { name: "Fishmans", locale: "en", primary: true },
          ],
        })
      )
    ).toBe("Fishmans");
  });

  it("falls back to any Latin alias, then to a Latin sort-name", () => {
    expect(
      pickLatinName(artist({ name: "파란노을", aliases: [{ name: "Parannoul" }] }))
    ).toBe("Parannoul");
    expect(
      pickLatinName(artist({ name: "崔健", "sort-name": "Cui Jian", aliases: [] }))
    ).toBe("Cui Jian");
  });

  it("returns null when the name is already Latin", () => {
    expect(pickLatinName(artist({ name: "Autechre", aliases: [{ name: "AE" }] }))).toBeNull();
  });

  it("returns null rather than echoing the original or a non-Latin sort-name", () => {
    expect(pickLatinName(artist({ name: "崔健", "sort-name": "崔健" }))).toBeNull();
    expect(pickLatinName(artist({ name: "フィッシュマンズ", aliases: [] }))).toBeNull();
    expect(pickLatinName(null)).toBeNull();
  });
});
