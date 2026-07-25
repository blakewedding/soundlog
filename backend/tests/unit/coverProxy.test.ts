// The proxied cover URL shape. Two properties carry the design and are worth
// pinning: it round-trips (the heal and the rollback are pure string
// transforms, no network — the §1 discipline coverUrl.ts established), and it
// refuses anything that is not artwork from a host we already take covers from
// (an image proxy that fetches arbitrary URLs is an SSRF hole and an open CDN).
import { describe, it, expect } from "vitest";
import {
  COVER_LARGE_WIDTH,
  COVER_THUMB_WIDTH,
  COVER_WIDTHS,
  decodeProxiedCoverPath,
  isProxiedCoverUrl,
  isProxyableCoverHost,
  parseCoverWidth,
  toProxiedCovers,
  toProxiedUrl,
} from "../../src/services/coverProxy.js";

const CAA = "https://coverartarchive.org/release/c38765cc-bafe-48ff-9a78-26f6d816a46b/6695925091.jpg";
const DISCOGS = "https://i.discogs.com/abc/R-123.jpeg";
const SPOTIFY = "https://i.scdn.co/image/ab67616d0000b273";

describe("toProxiedUrl", () => {
  it("rewrites the hosts the catalog actually stores", () => {
    for (const url of [CAA, DISCOGS, SPOTIFY]) {
      const proxied = toProxiedUrl(url, 400);
      expect(proxied.startsWith("/covers/w400/")).toBe(true);
      expect(decodeProxiedCoverPath(proxied)).toEqual({ width: 400, upstreamUrl: url });
    }
  });

  it("ends in .webp — Cloudflare's default caching keys on the extension", () => {
    expect(toProxiedUrl(CAA, 200).endsWith(".webp")).toBe(true);
  });

  it("is idempotent, and re-emits an already-proxied URL at the new width", () => {
    const thumb = toProxiedUrl(CAA, 200);
    const large = toProxiedUrl(thumb, 1200);
    expect(large).toBe(toProxiedUrl(CAA, 1200));
    // Not double-wrapped: it still decodes to the original upstream URL.
    expect(decodeProxiedCoverPath(large)?.upstreamUrl).toBe(CAA);
  });

  it("round-trips URLs with query strings and unicode intact", () => {
    const odd = "https://i.discogs.com/x/R-1%20(2).jpeg?w=600&h=600#frag";
    expect(decodeProxiedCoverPath(toProxiedUrl(odd, 640))?.upstreamUrl).toBe(odd);
  });

  it("leaves alone what it must not rewrite", () => {
    // A host we do not proxy keeps working browser-direct; rewriting it would
    // produce a URL the route is obliged to reject.
    expect(toProxiedUrl("https://example.test/cover.jpg", 400)).toBe(
      "https://example.test/cover.jpg"
    );
    // Cleartext is normalized by toSecureUrl before it ever reaches here.
    expect(toProxiedUrl("http://coverartarchive.org/a.jpg", 400)).toBe(
      "http://coverartarchive.org/a.jpg"
    );
    expect(toProxiedUrl("data:image/gif;base64,R0lGOD", 400)).toBe("data:image/gif;base64,R0lGOD");
    expect(toProxiedUrl("/covers/local.webp", 400)).toBe("/covers/local.webp");
    expect(toProxiedUrl(null, 400)).toBeNull();
    expect(toProxiedUrl(undefined, 400)).toBeUndefined();
  });
});

describe("toProxiedCovers", () => {
  it("stores the thumb and the lightbox image at their own widths", () => {
    const covers = toProxiedCovers({ thumb: CAA, large: CAA });
    expect(covers.thumb).toBe(toProxiedUrl(CAA, COVER_THUMB_WIDTH));
    expect(covers.large).toBe(toProxiedUrl(CAA, COVER_LARGE_WIDTH));
    expect(covers.thumb).not.toBe(covers.large);
  });

  it("passes nulls through", () => {
    expect(toProxiedCovers({ thumb: null, large: null })).toEqual({ thumb: null, large: null });
  });
});

describe("decodeProxiedCoverPath", () => {
  it("rejects a width outside the rendered set", () => {
    // Arbitrary widths would let one crawler fill the disk with renditions.
    const encoded = toProxiedUrl(CAA, 400).split("/")[3];
    expect(decodeProxiedCoverPath(`/covers/w137/${encoded}`)).toBeNull();
    expect(decodeProxiedCoverPath(`/covers/w2000/${encoded}`)).toBeNull();
  });

  it("rejects a decoded host that is not on the allowlist", () => {
    // The SSRF attempt: a well-formed request for something internal.
    const internal = Buffer.from("http://169.254.169.254/latest/meta-data", "utf8").toString(
      "base64url"
    );
    expect(decodeProxiedCoverPath(`/covers/w400/${internal}.webp`)).toBeNull();
    const loopback = Buffer.from("https://127.0.0.1:4000/api/health", "utf8").toString("base64url");
    expect(decodeProxiedCoverPath(`/covers/w400/${loopback}.webp`)).toBeNull();
  });

  it("rejects malformed shapes", () => {
    expect(decodeProxiedCoverPath("/covers/w400/not-base64!!.webp")).toBeNull();
    expect(decodeProxiedCoverPath("/covers/w400/missing-extension")).toBeNull();
    expect(decodeProxiedCoverPath("/covers/w400")).toBeNull();
    expect(decodeProxiedCoverPath("/api/releases")).toBeNull();
  });

  it("insists on the canonical encoding, so one cover is one CDN object", () => {
    const canonical = Buffer.from(CAA, "utf8").toString("base64url");
    // Same bytes, padded — accepted by Buffer.from, rejected here on purpose.
    expect(decodeProxiedCoverPath(`/covers/w400/${canonical}=.webp`)).toBeNull();
  });
});

describe("helpers", () => {
  it("recognises its own URLs", () => {
    expect(isProxiedCoverUrl(toProxiedUrl(CAA, 96))).toBe(true);
    expect(isProxiedCoverUrl(CAA)).toBe(false);
    expect(isProxiedCoverUrl(null)).toBe(false);
  });

  it("gates hosts on https and the allowlist", () => {
    expect(isProxyableCoverHost(CAA)).toBe(true);
    expect(isProxyableCoverHost("https://COVERARTARCHIVE.ORG/a.jpg")).toBe(true);
    expect(isProxyableCoverHost("http://coverartarchive.org/a.jpg")).toBe(false);
    expect(isProxyableCoverHost("https://evil.test/coverartarchive.org/a.jpg")).toBe(false);
    expect(isProxyableCoverHost("not a url")).toBe(false);
  });

  it("parses only the rendered widths", () => {
    for (const w of COVER_WIDTHS) expect(parseCoverWidth(String(w))).toBe(w);
    expect(parseCoverWidth("0400")).toBeNull();
    expect(parseCoverWidth("")).toBeNull();
    expect(parseCoverWidth("400x")).toBeNull();
  });
});
