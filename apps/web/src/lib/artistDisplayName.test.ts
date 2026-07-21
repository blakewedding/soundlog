// Phase 5.6.1 — display policy for non-Latin artist names: "Latin (Original)".
import { describe, it, expect } from "vitest";
import { artistDisplayName } from "@soundlog/shared";

describe("artistDisplayName", () => {
  it("renders 'Latin (Original)' when both exist", () => {
    expect(artistDisplayName({ name: "フィッシュマンズ", latinName: "Fishmans" })).toBe(
      "Fishmans (フィッシュマンズ)"
    );
    expect(artistDisplayName({ name: "파란노을", latinName: "Parannoul" })).toBe(
      "Parannoul (파란노을)"
    );
  });

  it("renders the plain name when there is no Latin counterpart", () => {
    expect(artistDisplayName({ name: "Autechre", latinName: null })).toBe("Autechre");
    expect(artistDisplayName({ name: "Autechre" })).toBe("Autechre");
  });

  it("never duplicates a name that already is Latin", () => {
    expect(artistDisplayName({ name: "Autechre", latinName: "Autechre" })).toBe("Autechre");
    expect(artistDisplayName({ name: "Autechre", latinName: "  " })).toBe("Autechre");
  });
});
