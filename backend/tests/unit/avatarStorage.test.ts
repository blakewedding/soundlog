// The avatar URL shape and on-disk layout. Three properties carry the design
// and are worth pinning:
//
//   * it round-trips — the URL a user's row holds parses back to the parts that
//     locate the file, with no lookup;
//   * it refuses anything it would not itself have produced, because the file
//     name is the only caller-influenced part of a filesystem read;
//   * renditions shard on the HASH, not the user id — cuid ids all start with
//     `c`, so id-sharding silently produces one directory holding everything.
import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  AVATAR_HASH_LENGTH,
  AVATAR_MASTER_SIZE,
  AVATAR_STORED_WIDTH,
  AVATAR_WIDTHS,
  avatarDir,
  avatarUrlFor,
  isAvatarUrl,
  masterPath,
  parseAvatarPath,
  parseAvatarWidth,
  variantPath,
} from "../../src/services/avatarStorage.js";

const USER = "clx7k2p9q0000abcd1234efgh";
const HASH = "a3f19c4e7b2d8016";

describe("avatarUrlFor / parseAvatarPath", () => {
  it("round-trips the stored URL back to its parts", () => {
    const url = avatarUrlFor(USER, HASH);
    expect(url).toBe(`/avatars/w${AVATAR_STORED_WIDTH}/${USER}-${HASH}.webp`);
    expect(parseAvatarPath(url)).toEqual({
      width: AVATAR_STORED_WIDTH,
      userId: USER,
      hash: HASH,
    });
  });

  it("stores the LARGEST rendition, so every surface can only ask downward", () => {
    expect(AVATAR_STORED_WIDTH).toBe(Math.max(...AVATAR_WIDTHS));
  });

  it("keeps the master above every rendition, so 384 is a downscale not an upscale", () => {
    expect(AVATAR_MASTER_SIZE).toBeGreaterThan(Math.max(...AVATAR_WIDTHS));
  });

  it("parses every width we render, and nothing else", () => {
    for (const w of AVATAR_WIDTHS) {
      expect(parseAvatarPath(`/avatars/w${w}/${USER}-${HASH}.webp`)?.width).toBe(w);
    }
    // A width we do not render is a 404, not a resize-on-demand: `?w=1..2000`
    // is how one crawler fills a disk with renditions nobody asked for.
    expect(parseAvatarPath(`/avatars/w97/${USER}-${HASH}.webp`)).toBeNull();
    expect(parseAvatarPath(`/avatars/w2000/${USER}-${HASH}.webp`)).toBeNull();
  });

  it("refuses a leading-zero width, so one rendition has exactly one URL", () => {
    expect(parseAvatarWidth("048")).toBeNull();
    expect(parseAvatarWidth("48")).toBe(48);
  });

  it("ends in .webp — Cloudflare's default caching keys on the extension", () => {
    expect(avatarUrlFor(USER, HASH).endsWith(".webp")).toBe(true);
    expect(parseAvatarPath(`/avatars/w96/${USER}-${HASH}`)).toBeNull();
  });
});

describe("parseAvatarPath — what it must refuse", () => {
  // The file name is the only caller-influenced input to a filesystem read, so
  // these are the cases that matter. Traversal is rejected positively (the id
  // must be lowercase alphanumeric) rather than by blacklisting `..`.
  const bad = [
    ["path traversal in the id", `/avatars/w96/../../etc/passwd-${HASH}.webp`],
    ["a dot in the id", `/avatars/w96/../${HASH}.webp`],
    ["an encoded separator", `/avatars/w96/foo%2Fbar-${HASH}.webp`],
    ["an uppercase id", `/avatars/w96/CLX7K2P9Q0000ABCD1234EFGH-${HASH}.webp`],
    ["a short hash", `/avatars/w96/${USER}-a3f19c4e.webp`],
    ["a non-hex hash", `/avatars/w96/${USER}-zzzzzzzzzzzzzzzz.webp`],
    ["no hash separator", `/avatars/w96/${USER}${HASH}.webp`],
    ["an empty id", `/avatars/w96/-${HASH}.webp`],
    ["the wrong prefix", `/covers/w96/${USER}-${HASH}.webp`],
    ["no width segment", `/avatars/${USER}-${HASH}.webp`],
  ] as const;

  for (const [why, input] of bad) {
    it(`refuses ${why}`, () => {
      expect(parseAvatarPath(input)).toBeNull();
    });
  }

  it("refuses a traversal even when it would otherwise be well-formed", () => {
    // The dangerous shape: valid width, valid hash, and an id that would climb
    // out of the storage root if it were ever joined onto a path.
    const parsed = parseAvatarPath(`/avatars/w96/..-${HASH}.webp`);
    expect(parsed).toBeNull();
  });
});

describe("on-disk layout", () => {
  it("shards on the hash, NOT the user id", () => {
    // cuid ids all begin with `c`, so id-sharding is one directory wearing the
    // costume of a sharded one. Two users, same shard iff same hash prefix.
    const a = variantPath("clx7k2p9q0000abcd1234efgh", "a3f19c4e7b2d8016", 96);
    const b = variantPath("clx9zzzzz0000wxyz9876mnop", "a3f19c4e7b2d8016", 96);
    const c = variantPath("clx7k2p9q0000abcd1234efgh", "ff019c4e7b2d8016", 96);

    expect(path.dirname(a)).toBe(path.dirname(b)); // same hash prefix → same shard
    expect(path.dirname(a)).not.toBe(path.dirname(c)); // different prefix → different
    expect(path.dirname(a).endsWith(path.join("w96", "a3"))).toBe(true);
  });

  it("keeps the master and the renditions in separate trees", () => {
    // The backup archives master/ only; a rendition landing inside it would be
    // silently backed up forever, and a master landing outside it would not be
    // backed up at all. The second is the one that loses data.
    const master = masterPath(USER, HASH);
    const variant = variantPath(USER, HASH, 96);
    expect(master.startsWith(path.join(avatarDir(), "master"))).toBe(true);
    expect(variant.startsWith(path.join(avatarDir(), "master"))).toBe(false);
    expect(master).not.toBe(variant);
  });

  it("puts every file under the storage root", () => {
    for (const w of AVATAR_WIDTHS) {
      expect(variantPath(USER, HASH, w).startsWith(avatarDir() + path.sep)).toBe(true);
    }
    expect(masterPath(USER, HASH).startsWith(avatarDir() + path.sep)).toBe(true);
  });

  it("gives one user's two different pictures two different paths", () => {
    // This is what makes `immutable` honest: new bytes, new URL, new file.
    expect(masterPath(USER, HASH)).not.toBe(masterPath(USER, "0000000000000000"));
    expect(avatarUrlFor(USER, HASH)).not.toBe(avatarUrlFor(USER, "0000000000000000"));
  });
});

describe("isAvatarUrl", () => {
  it("recognises ours and nothing else", () => {
    expect(isAvatarUrl(avatarUrlFor(USER, HASH))).toBe(true);
    expect(isAvatarUrl("/covers/w400/abc.webp")).toBe(false);
    expect(isAvatarUrl("https://example.com/me.png")).toBe(false);
    expect(isAvatarUrl(null)).toBe(false);
    expect(isAvatarUrl(undefined)).toBe(false);
  });
});

describe("the hash", () => {
  it("is 16 hex characters", () => {
    expect(AVATAR_HASH_LENGTH).toBe(16);
    expect(HASH).toHaveLength(AVATAR_HASH_LENGTH);
  });
});
