/**
 * The EDITORIAL half of the genre vocabulary — Phase 6.3.
 *
 * `mbGenreSnapshot.json` is the canonical spine: MusicBrainz's own published
 * genre list (§3 — MusicBrainz identity is canonical). This file is everything a
 * human had to decide, kept separate and small for the same reason the warming
 * list is data rather than code: someone should be able to read it, disagree
 * with a line, and change that line without reading a service.
 *
 * Blake vouched for these terms as editorial. Adding to SUPPLEMENT is a
 * judgement call about what counts as a genre; adding to ALIASES is not.
 */

/**
 * Genres MusicBrainz genuinely does not carry.
 *
 * MusicBrainz is deliberately specific: it lists `alternative rock` and
 * `indie rock` but not the bare umbrella terms people actually tag with. Those
 * two alone are our most-used chips — 147 uses each, 294 of 2,018 occurrences —
 * so an allowlist without this file would have deleted the single most common
 * thing on a release page and been a worse bug than the one it fixed.
 *
 * Verified absent from the 2,184-entry snapshot at the time of writing; each is
 * a term a reader would recognise as a genre.
 */
export const GENRE_SUPPLEMENT: readonly string[] = [
  "alternative", // 147 uses. MB has `alternative rock` etc., not the umbrella.
  "indie", // 147 uses. Same shape as `alternative`.
  "acoustic", // MB has `acoustic blues`/`acoustic rock`, not the bare term.
  "sadcore", // A real (if small) genre; MB carries `slowcore` but not this.
  "rap", // MB has 30+ `* rap` entries but not `rap` itself.
  "soundtrack", // MB has no `soundtrack`; see ALIASES for ost/score.
  "fusion", // MB has `jazz fusion`/`world fusion`, not the bare term.
  "minimal", // MB has `minimal techno`/`minimalism`, not `minimal`.
  "hardcore", // MB has `hardcore punk`/`hardcore techno`, not the bare term.
];

/**
 * Variant spellings of terms MusicBrainz DOES carry.
 *
 * Mechanical, not editorial: each maps to a verified snapshot entry, so these
 * are spelling normalisation rather than a claim about what a genre is. Kept
 * separate from SUPPLEMENT precisely so the editorial list stays short enough to
 * actually review.
 *
 * Matching is already separator-insensitive (`synthpop` == `synth-pop`), so only
 * genuinely different spellings need to appear here.
 */
export const GENRE_ALIASES: Readonly<Record<string, string>> = {
  "alt-country": "alternative country",
  "prog rock": "progressive rock",
  // MusicBrainz spells these with an ampersand; taggers rarely do.
  rnb: "r&b",
  "rhythm and blues": "r&b",
  "contemporary rnb": "contemporary r&b",
  "alternative rnb": "alternative r&b",
  // A score IS a soundtrack for our purposes; collapsing them avoids three
  // chips that mean one thing.
  ost: "soundtrack",
  "film score": "soundtrack",
  score: "soundtrack",
  // Both are the common names for what MusicBrainz files as `dark jazz`.
  "doom jazz": "dark jazz",
  "noir jazz": "dark jazz",
  "jazz noir": "dark jazz",
};

/**
 * Decades and release-year tags are NOT genres, and Blake ruled them out
 * explicitly: the field is `genres`, and era browsing should come from release
 * dates we already store, not from a folksonomy string that happens to look like
 * one. Covers `80s`, `1980s`, `2020s`, `00s` and `2017 releases`.
 *
 * 54 occurrences in the catalog at the time of writing.
 */
export const DECADE_TAG = /^(?:(?:19|20)?\d0s|\d{4} releases)$/;
