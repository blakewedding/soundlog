/**
 * 6.3c — a genre slug must resolve to the tag we actually store.
 *
 * `slugToTag` turned every hyphen into a space, which round-trips only for
 * genres containing no hyphen of their own: `detroit techno` → `detroit-techno`
 * → `detroit techno` works, `post-rock` → `post-rock` → `post rock` does not.
 * Every hyphenated genre therefore had a dead page.
 *
 * It stayed invisible while the catalog held BOTH spellings — the space-form
 * absorbed the traffic. Canonicalizing onto MusicBrainz's spelling moved 109
 * releases behind the broken half and turned `/genre/post-rock`, our most common
 * genre, into an empty page. Found by checking the live URL after the heal
 * rather than by trusting the counts.
 */
import { describe, it, expect } from "vitest";
import { resolveGenreSlug, slugToTag } from "../../src/services/chartService.js";

describe("genre slug resolution", () => {
  it("resolves a hyphenated genre to its stored form", async () => {
    // The regression that prompted this. The old rule yields `post rock`, which
    // matches no row.
    expect(await resolveGenreSlug("post-rock")).toBe("post-rock");
    expect(slugToTag("post-rock")).toBe("post rock"); // the old behaviour, pinned
  });

  it("still resolves a multi-word genre whose slug uses hyphens as spaces", async () => {
    // The case the old rule existed for — it must not regress.
    expect(await resolveGenreSlug("detroit-techno")).toBe("detroit techno");
    expect(await resolveGenreSlug("indie-rock")).toBe("indie rock");
  });

  it("handles the genres that were split across two spellings", async () => {
    for (const [slug, stored] of [
      ["singer-songwriter", "singer-songwriter"],
      ["post-hardcore", "post-hardcore"],
      ["synth-pop", "synth-pop"],
      ["hip-hop", "hip hop"],
      ["trip-hop", "trip hop"],
      ["neo-soul", "neo soul"],
    ] as const) {
      expect(await resolveGenreSlug(slug), slug).toBe(stored);
    }
  });

  it("falls back to the old rule outside the vocabulary rather than failing", async () => {
    expect(await resolveGenreSlug("not-a-real-genre")).toBe("not a real genre");
    expect(await resolveGenreSlug("")).toBe("");
  });
});
