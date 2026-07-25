// Phase 6.1 — asking the cover proxy for the size actually rendered.
//
// Two things must hold, and both are about not breaking what already works:
// a proxied URL is resized by rewriting its width segment (never by re-encoding
// anything, so the client cannot disagree with the server about the cache key),
// and anything else passes through untouched — an un-healed legacy row must
// keep rendering rather than becoming a broken image.
import { describe, it, expect } from "vitest";
import {
  COVER_SIZES,
  coverAt,
  coverSources,
  isProxiedCover,
  proxiedUpstream,
} from "./coverVariant";

const UPSTREAM = "https://coverartarchive.org/release/abc/12345-500.jpg";
const PROXIED = "/covers/w400/aHR0cHM6Ly9jb3ZlcmFydGFyY2hpdmUub3JnL3JlbGVhc2UvYWJjLzEyMzQ1LTUwMC5qcGc.webp";

describe("coverAt", () => {
  it("rewrites only the width segment", () => {
    expect(coverAt(PROXIED, 96)).toBe(PROXIED.replace("/w400/", "/w96/"));
    expect(coverAt(PROXIED, 1200)).toBe(PROXIED.replace("/w400/", "/w1200/"));
  });

  it("leaves the encoded segment byte-identical", () => {
    // The encoded segment IS the cache key on disk and at the edge. A helper
    // that re-encoded it would quietly create a second object per cover.
    const encoded = PROXIED.split("/")[3];
    expect(coverAt(PROXIED, 200)?.split("/")[3]).toBe(encoded);
  });

  it("passes through anything that isn't ours to resize", () => {
    expect(coverAt(UPSTREAM, 96)).toBe(UPSTREAM);
    expect(coverAt("https://i.discogs.com/x.jpeg", 96)).toBe("https://i.discogs.com/x.jpeg");
    expect(coverAt(null, 96)).toBeNull();
    expect(coverAt(undefined, 96)).toBeNull();
  });
});

describe("coverSources", () => {
  it("offers a 1x and a 2x rendition for each surface", () => {
    for (const [size, [oneX, twoX]] of Object.entries(COVER_SIZES)) {
      const served = coverSources(PROXIED, size as keyof typeof COVER_SIZES);
      expect(served.src).toBe(coverAt(PROXIED, oneX));
      expect(served.srcSet).toBe(`${coverAt(PROXIED, oneX)} 1x, ${coverAt(PROXIED, twoX)} 2x`);
    }
  });

  it("asks for a smaller rendition in a row than in a grid tile", () => {
    // The whole point: a 40px diary thumbnail stopped downloading the 500px
    // original the day this landed.
    expect(COVER_SIZES.row[0]).toBeLessThan(COVER_SIZES.grid[0]);
    expect(COVER_SIZES.grid[0]).toBeLessThan(COVER_SIZES.hero[0]);
  });

  it("omits srcSet for an unproxied src rather than claiming a 2x it hasn't got", () => {
    const served = coverSources(UPSTREAM, "grid");
    expect(served.src).toBe(UPSTREAM);
    expect(served.srcSet).toBeUndefined();
  });

  it("yields nothing at all for a missing cover", () => {
    expect(coverSources(null, "grid")).toEqual({ src: undefined, srcSet: undefined });
  });
});

describe("proxiedUpstream", () => {
  it("encodes exactly as the backend does, so the URL is one the route accepts", () => {
    // base64url of the UTF-8 URL, unpadded — the same bytes Buffer.toString
    // ("base64url") produces server-side. This value was taken from the
    // backend's own output for this URL.
    expect(proxiedUpstream(UPSTREAM, 400)).toBe(PROXIED);
  });

  it("round-trips through the resize helper", () => {
    const built = proxiedUpstream(UPSTREAM, 200);
    expect(isProxiedCover(built)).toBe(true);
    expect(coverAt(built, 400)).toBe(PROXIED);
  });
});
