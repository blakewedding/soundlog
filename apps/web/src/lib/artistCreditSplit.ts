/**
 * Split a joined artist-credit string back into the individual artists.
 *
 * ## Why this exists (6.3e follow-up #9)
 *
 * `ArtistCredit` links an UNRESOLVED credit to `/search?q=<name>` — §3 permits
 * a name as a navigation affordance, and this is that affordance. It split on
 * `", "` alone, under the comment "MusicBrainz and Discogs both join multiple
 * credits with ', '", which is not true: MusicBrainz carries a per-credit
 * `joinphrase` and it is routinely " & ", " feat. " or "/".
 *
 * So `"ZZ Top & Gary Moore"` stayed one fragment and became one query no human
 * would type, which can never match, which poisoned a cache key and spent a
 * MusicBrainz slot every time anything walked the link. At catalogue scale that
 * was a self-inflicted load source — we were generating the upstream pressure
 * we then blamed upstream for.
 *
 * Fixing `creditName` server-side stopped NEW strings being fused with no
 * separator at all. It did not fix this: a correctly joined
 * `"ZZ Top & Gary Moore"` still needs splitting before it is a searchable name.
 *
 * ## What it deliberately does NOT split
 *
 * A bare `/` with no surrounding spaces. **AC/DC** is one artist, and so are
 * `Godspeed You! Black Emperor` and `Emerson, Lake & Palmer` in their own ways.
 * A false split invents an artist that does not exist and sends a person to a
 * broken search; a false JOIN leaves one over-long query that matches nothing.
 * The second is strictly less harmful, so every ambiguous case is left joined.
 *
 * `" / "` with spaces is split, because that is the separator form and no
 * single artist name contains it.
 */

/**
 * Separators, longest-first so " feat. " is tried before " ft. " and " & "
 * before "&". Anchored with spaces wherever a bare form could occur inside a
 * legitimate name.
 */
const SEPARATORS: readonly string[] = [
  " featuring ",
  " feat. ",
  " feat ",
  " ft. ",
  " ft ",
  " versus ",
  " vs. ",
  " vs ",
  " with ",
  " and ",
  " & ",
  " / ",
  " + ",
  " × ",
  " x ",
  ", ",
  ",",
];

/**
 * Longest fragment we will treat as a name rather than a sentence.
 *
 * 60 rather than something tighter because real credits are long: "Godspeed
 * You! Black Emperor" is 27, "The Brian Jonestown Massacre" 28, and orchestral
 * credits run further.
 */
const MAX_NAME = 60;

/**
 * Is this fragment worth linking to a search?
 *
 * Deliberately a WEAK test, and the two things it does not do are the honest
 * part.
 *
 * It does not require a letter or a digit. `!!!` is a real band, and since the
 * `titleExact`/`artistNameExact` keyword fallback landed, a name made entirely
 * of punctuation is genuinely findable — rejecting it here would contradict the
 * fix that made it searchable in the first place.
 *
 * It does not detect Discogs ROLE strings. "Directed For The Stage By Peter
 * Konwitschny" is 43 characters and indistinguishable from a long artist name
 * by any client-side rule that does not also reject real credits. Pretending a
 * length threshold catches them would be a guard that reports working while
 * letting them through. They are handled where §3 says markers belong — at
 * ingestion — not here.
 *
 * What is left is the guard that CAN be made honestly: nothing empty, and
 * nothing long enough to be a sentence.
 */
export function isSearchableName(fragment: string): boolean {
  const t = fragment.trim();
  return t.length > 0 && t.length <= MAX_NAME;
}

/** Split a joined credit into its parts. Always returns at least one entry. */
export function splitArtistCredit(credit: string): string[] {
  let parts = [credit.trim()];
  for (const sep of SEPARATORS) {
    parts = parts.flatMap((p) => p.split(sep));
  }
  const cleaned = parts.map((p) => p.trim()).filter(Boolean);
  return cleaned.length ? cleaned : [credit.trim()];
}
