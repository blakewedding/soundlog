/**
 * The genre vocabulary — Phase 6.3.
 *
 * ## Why an allowlist at all
 *
 * Last.fm tags are folksonomy, and the junk in them is unbounded: opinion
 * (`these tags suck`), lists (`1001 albums you must hear before you die`),
 * labels (`4ad`), producers (`albini`), places (`savonlinna`), formats
 * (`live album`), and other languages (`albuns de 2018 que ouvi`). No denylist
 * closes that set — you can only enumerate what a genre IS.
 *
 * ## Why the popularity weight could not do this job
 *
 * Last.fm's `count` is RELATIVE, normalised 0-100 against the top tag for that
 * album. Three people tagging an obscure record produce 100/100/66/66/33/33 —
 * numerically identical to an album tagged by thirty thousand. Measured across
 * 244 cached payloads in production: 106 (43%) carried no weights at all, and
 * 28 more (11%) had a degenerate spread. The weight floor was inoperative for
 * 55% of albums, which is why *Transaction de Novo* shipped five junk chips
 * with a floor of 5 and every tag scoring 33 or better.
 *
 * ## Why a bundled snapshot, and not a live fetch alone
 *
 * The filter must never fail open — failing open is the bug. If the vocabulary
 * were fetched lazily and MusicBrainz were down, every enrichment during the
 * outage would silently revert to folksonomy. So the snapshot is the FLOOR and
 * ships in the image; the live fetch only ever ADDS to it, and rides the shared
 * gate at `background` tier like everything else (§7).
 *
 * The refresh is fire-and-forget for the same reason: `/genre/all` is 22 paged
 * requests, and no reader should wait ~24s of gate time to find out what a genre
 * is. `peekCached` tells us whether the answer is already there without falling
 * through to the fetch — the exact case that primitive exists for.
 */
import { peekCached, cached } from "./cache.js";
import { fetchGenreVocabulary } from "./musicbrainzService.js";
import { MB_GENRE_SNAPSHOT } from "./genre/mbGenreSnapshot.js";
import { GENRE_SUPPLEMENT, GENRE_ALIASES, DECADE_TAG } from "./genre/genreSupplement.js";

export const GENRE_VOCAB_KEY = "mb:genre:vocabulary";
/** Genres change on the order of years; a month is already generous. */
const VOCAB_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Collapse everything that is not a letter or a digit, so `synth-pop`,
 * `synth pop` and `synthpop` are one genre, and `r&b` matches `r and b`.
 *
 * Separator-insensitivity is not cosmetic: MusicBrainz spells things
 * `post-rock` and `dark wave` where taggers write `post rock` and `darkwave`.
 */
export function normalizeGenre(raw: string): string {
  return raw.trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
}

const ALIAS_BY_NORM = new Map(
  Object.entries(GENRE_ALIASES).map(([variant, canonical]) => [normalizeGenre(variant), canonical])
);

function buildAllowSet(names: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const n of names) set.add(normalizeGenre(n));
  for (const n of GENRE_SUPPLEMENT) set.add(normalizeGenre(n));
  // An alias's TARGET must be allowed even if the variant is what we saw.
  for (const canonical of Object.values(GENRE_ALIASES)) set.add(normalizeGenre(canonical));
  return set;
}

/** The floor: always available, never depends on an upstream being reachable. */
const SNAPSHOT_ALLOW = buildAllowSet(MB_GENRE_SNAPSHOT);

/**
 * Populate the live vocabulary. EXPLICIT, never a side effect of reading.
 *
 * An earlier draft kicked this from `genreAllowSet()` on a cache miss, which
 * meant enriching one release could silently start a 22-page walk. Two tests
 * caught it by asserting exactly one outgoing `fetch`, and they were right to:
 * a read that quietly becomes twenty-two upstream requests is the kind of thing
 * that only shows up as unexplained gate pressure in production.
 *
 * Called at boot (`server.ts`) and by operator scripts. Safe to call repeatedly:
 * `cached()` makes it a no-op for 30 days after it succeeds, and a throw writes
 * nothing (§2), so a bad MusicBrainz night simply leaves the snapshot serving.
 */
export async function primeGenreVocabulary(): Promise<void> {
  try {
    const names = await cached(GENRE_VOCAB_KEY, VOCAB_TTL_SECONDS, () => fetchGenreVocabulary());
    console.log(`[genre] vocabulary ready — ${names.length} live entries`);
  } catch (err) {
    console.warn(
      `[genre] vocabulary refresh failed, using the ${MB_GENRE_SNAPSHOT.length}-entry ` +
        `snapshot: ${(err as Error).message}`
    );
  }
}

/**
 * The set of allowed genre forms, normalized. A PURE READ — from Redis if the
 * live list is cached, from the bundled snapshot otherwise. It never fetches,
 * so it can be called from any hot path without surprising anyone.
 */
export async function genreAllowSet(): Promise<Set<string>> {
  let live: string[] | undefined;
  try {
    live = await peekCached<string[]>(GENRE_VOCAB_KEY);
  } catch {
    live = undefined; // Redis unavailable — the snapshot still works.
  }
  if (live === undefined) return SNAPSHOT_ALLOW;
  // Union, never replacement: a live list that came back short must not shrink
  // the vocabulary below what shipped.
  return buildAllowSet([...MB_GENRE_SNAPSHOT, ...live]);
}

/**
 * Resolve one raw tag to a canonical genre, or `null` if it is not one.
 *
 * Order matters: decades are rejected before aliasing, and aliasing happens
 * before the allow check so a variant spelling is judged by its target.
 */
export function canonicalGenre(raw: string, allow: Set<string>): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (DECADE_TAG.test(trimmed.toLowerCase())) return null;

  const norm = normalizeGenre(trimmed);
  if (!norm) return null;

  const aliased = ALIAS_BY_NORM.get(norm);
  if (aliased) return aliased;

  return allow.has(norm) ? trimmed.toLowerCase() : null;
}

/** Filter and canonicalize a list of raw tags, preserving order, de-duped. */
export function canonicalGenres(raw: readonly string[], allow: Set<string>): string[] {
  const out: string[] = [];
  for (const tag of raw) {
    const g = canonicalGenre(tag, allow);
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}
