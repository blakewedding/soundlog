// Avatar rendition selection, and the property that makes the shared helper
// safe to share: covers and avatars must never rewrite each other's URLs.
import { describe, it, expect } from "vitest";
import { AVATAR_SIZES, AVATAR_WIDTHS, avatarAt, avatarSources, isAvatarUrl } from "./avatarVariant";
import { coverAt, isProxiedCover } from "./coverVariant";

const USER = "clx7k2p9q0000abcd1234efgh";
const HASH = "a3f19c4e7b2d8016";
const STORED = `/avatars/w384/${USER}-${HASH}.webp`;
const COVER = "/covers/w400/aHR0cHM6Ly9leGFtcGxlLmNvbS9hLmpwZw.webp";

describe("avatarAt", () => {
  it("rewrites only the width segment", () => {
    expect(avatarAt(STORED, 96)).toBe(`/avatars/w96/${USER}-${HASH}.webp`);
  });

  it("round-trips through every width we render", () => {
    for (const w of AVATAR_WIDTHS) {
      expect(avatarAt(STORED, w)).toBe(`/avatars/w${w}/${USER}-${HASH}.webp`);
    }
  });

  it("leaves anything that is not ours untouched", () => {
    expect(avatarAt("https://example.com/me.png", 96)).toBe("https://example.com/me.png");
    expect(avatarAt(null, 96)).toBeNull();
    expect(avatarAt(undefined, 96)).toBeNull();
  });
});

describe("avatarSources", () => {
  it("offers a 1x and a 2x for each surface", () => {
    for (const [size, [oneX, twoX]] of Object.entries(AVATAR_SIZES)) {
      const out = avatarSources(STORED, size as keyof typeof AVATAR_SIZES);
      expect(out.src).toContain(`/w${oneX}/`);
      expect(out.srcSet).toBe(
        `/avatars/w${oneX}/${USER}-${HASH}.webp 1x, /avatars/w${twoX}/${USER}-${HASH}.webp 2x`
      );
    }
  });

  it("omits srcSet for an unproxied src, rather than lying about the 2x", () => {
    const out = avatarSources("https://example.com/me.png", "card");
    expect(out.src).toBe("https://example.com/me.png");
    expect(out.srcSet).toBeUndefined();
  });

  it("returns nothing at all for no src", () => {
    expect(avatarSources(null, "card")).toEqual({ src: undefined, srcSet: undefined });
  });

  it("never asks for a width the backend does not render", () => {
    // The ladder here must stay in step with AVATAR_WIDTHS in
    // backend/src/services/avatarStorage.ts, or the client requests a 404.
    for (const [oneX, twoX] of Object.values(AVATAR_SIZES)) {
      expect(AVATAR_WIDTHS).toContain(oneX);
      expect(AVATAR_WIDTHS).toContain(twoX);
    }
  });
});

describe("the two prefixes stay separate", () => {
  // Both concepts now share lib/imageVariant.ts. The thing that could go wrong
  // with sharing is one rewriting the other's URLs.
  it("does not treat a cover as an avatar", () => {
    expect(isAvatarUrl(COVER)).toBe(false);
    expect(avatarAt(COVER, 96)).toBe(COVER);
  });

  it("does not treat an avatar as a cover", () => {
    expect(isProxiedCover(STORED)).toBe(false);
    expect(coverAt(STORED, 200)).toBe(STORED);
  });

  it("recognises its own", () => {
    expect(isAvatarUrl(STORED)).toBe(true);
    expect(isProxiedCover(COVER)).toBe(true);
  });
});
