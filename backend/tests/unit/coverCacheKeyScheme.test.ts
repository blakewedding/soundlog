/**
 * 6.3e — the warm sweep and the serving route must agree on a cover's identity.
 *
 * The disk cache keys renditions on `sha256(upstreamUrl)`, so the URL string IS
 * the identity. That makes scheme normalisation load-bearing rather than
 * cosmetic: the Cover Art Archive serves `image` as CLEARTEXT `http://` on older
 * records (`Neu! ’75` is one), every persist path runs it through `toSecureUrl`
 * first, and the warm sweep did not — so it warmed `sha256("http://…")` while
 * the route read `sha256("https://…")`.
 *
 * Nothing failed. The sweep reported success, the renditions existed, and the
 * visitor still paid full cold cost on exactly the covers we had "warmed" —
 * while the cache carried both copies against its LRU bound.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { toSecureUrl } from "../../src/services/coverUrl.js";
import {
  toProxiedUrl,
  decodeProxiedCoverPath,
  COVER_THUMB_WIDTH,
} from "../../src/services/coverProxy.js";

/** What `coverCache.variantPath` keys on. */
const cacheKey = (url: string) => createHash("sha256").update(url).digest("hex");

/** A real cleartext URL, as the archive returns it for Neu! ’75. */
const CLEARTEXT =
  "http://coverartarchive.org/release/b7a1fc28-99b3-424d-9e1c-c3fe7ae9efa5/31941119910-500.jpg";

describe("cover cache identity is scheme-normalised", () => {
  it("the warm path and the serving path derive the SAME key from a cleartext CAA url", () => {
    // What the serving route ends up fetching: the stored `coverUrl` is the
    // proxied form, and the route decodes it back to the upstream URL.
    const stored = toProxiedUrl(toSecureUrl(CLEARTEXT), COVER_THUMB_WIDTH);
    const decoded = decodeProxiedCoverPath(stored as string);
    expect(decoded).not.toBeNull();

    // What the warm sweep hands to `ensureVariant`.
    const warmed = toSecureUrl(CLEARTEXT);

    expect(warmed).toBe(decoded!.upstreamUrl);
    expect(cacheKey(warmed)).toBe(cacheKey(decoded!.upstreamUrl));
  });

  it("without normalisation the two keys diverge — the bug, pinned", () => {
    const stored = toProxiedUrl(toSecureUrl(CLEARTEXT), COVER_THUMB_WIDTH);
    const decoded = decodeProxiedCoverPath(stored as string)!;

    // Passing the raw cleartext URL straight through, as the sweep used to.
    expect(cacheKey(CLEARTEXT)).not.toBe(cacheKey(decoded.upstreamUrl));
  });

  it("a cleartext upstream can never be stored proxied — the allowlist is https-only", () => {
    // Belt and braces: even if a caller forgot `toSecureUrl`, the proxy refuses
    // to wrap a cleartext host, so the value would stay a raw third-party URL
    // and be visible as such rather than silently becoming a second cache entry.
    expect(toProxiedUrl(CLEARTEXT, COVER_THUMB_WIDTH)).toBe(CLEARTEXT);
  });
});
