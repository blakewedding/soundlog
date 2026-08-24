import { redis } from "../config/redis.js";

export interface CacheOptions {
  /**
   * Skip the read and go straight upstream, re-writing the entry with a fresh
   * TTL. Without this a cache "warm" is a no-op: `cached()` returns the hit and
   * never touches the expiry, so a key selected *because* it is close to
   * expiring stays close to expiring, and dies on schedule anyway.
   *
   * That is the 6.2g bug. `needsWarming` correctly picked targets inside the
   * 26-hour window every night for six nights, `warmTarget` "warmed" them, and
   * every one of those calls was a read that extended nothing — measured as
   * 1,890 of 1,960 warmed layers sitting inside the refresh window at once,
   * with only the genuinely-expired 65 carrying healthy TTLs.
   *
   * Re-fetching is the point, and an `EXPIRE` on the existing value would NOT
   * be an acceptable shortcut: it would keep seven-day-old data alive forever
   * on the strength of having looked at it. The TTL exists for freshness, so
   * the only honest way to re-date it is to ask upstream again.
   */
  refresh?: boolean;
  /**
   * Subtract up to this many seconds (uniformly) from the TTL on write.
   *
   * A bulk warm run writes hundreds of keys within a few minutes, all with the
   * same TTL, so they expire within a few minutes of each other a week later —
   * and because every subsequent warm rewrites them together too, the fleet can
   * never drift apart on its own. The first production run wrote 490 targets in
   * one 4-hour pass on 2026-07-30; six days later 97% of their keys expired
   * inside a single 12-hour window.
   *
   * Jitter is what makes that unrepeatable. It is subtracted, never added, so a
   * TTL is always a bound on staleness rather than an approximation of one.
   */
  jitterSeconds?: number;
}

/**
 * Encode one variable part of a cache key so it cannot run into the next one.
 *
 * ## Why this is not paranoia (6.3e)
 *
 * Several keys are built as `prefix:${artist}:${title}` with both values
 * interpolated raw. Colons are the delimiter, and catalog names contain them —
 * `Songs: Ohia` is in the catalog today. So:
 *
 *   artist "Songs: Ohia", title "Didn't It Rain"   -> ...:songs: ohia:didn't it rain
 *   artist "Songs",       title "Ohia:Didn't It Rain" -> ...:songs: ohia:didn't it rain
 *
 * One key, two different records. For `discogs:covermatch` that key holds an
 * ARTWORK URL, so a collision serves one album's sleeve for another — the class
 * of wrong-cover bug §3 exists to prevent, arriving through the cache rather
 * than through identity resolution.
 *
 * These keys stay name-derived on purpose: they cache the answer to "what does
 * this SEARCH return", and the search terms are the question. What changes is
 * only that each part is now unambiguously delimited. Where an MBID is
 * available, the key should be MBID-keyed instead (`caa:rg:urls:<mbid>` already
 * is) — a name belongs in a key only when the lookup itself is by name.
 */
export function keyPart(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

/**
 * Read-through Redis cache. `null` results are cached too (stored as the JSON
 * literal `null`) so a known "no match" doesn't trigger a repeat upstream call —
 * `redis.get` returns the string "null", distinct from a genuine cache miss.
 */
/**
 * How long to keep a value.
 *
 * A plain number is the usual case. The object form splits the TTL by how much
 * the ANSWER is worth trusting: `full` for a real result, `thin` for one that
 * upstream reported successfully but which carries nothing — see {@link cached}
 * for why those must differ, and why `refresh` overrides the split.
 */
export type CacheTtl<T> =
  | number
  | { full: number; thin: number; isThin: (value: T) => boolean };

export async function cached<T>(
  key: string,
  ttlSeconds: CacheTtl<T>,
  fn: () => Promise<T>,
  opts: CacheOptions = {}
): Promise<T> {
  if (!opts.refresh) {
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
  }
  const value = await fn();
  // NB: if fn() throws, we never reach this write — which is what keeps a
  // partial/failed assembly out of the cache (Phase 5.6/5.7 semantics). That
  // holds identically under `refresh`: a refresh that cannot reach upstream
  // leaves the existing entry alone rather than replacing it with a degraded
  // one, so §1/§2 are unchanged by this option.
  // The TTL may depend on what came back, and on who is asking.
  //
  // ## Why this exists (6.3e)
  //
  // A fixed TTL forces one policy onto two very different answers. MusicBrainz
  // serves search from a Solr index that is SEPARATE from its main database and
  // fails independently — and when it is degraded it does not error, it returns
  // **HTTP 200 with zero results**. `searchMusicBrainzArtists` cached that under
  // a seven-day TTL, so one bad minute at MusicBrainz made an artist read as
  // "does not exist" for a week, on every surface, for everyone.
  //
  // Throwing is still what keeps a KNOWN failure out of the cache (§1/§2, note
  // above). This covers the case that cannot throw, because upstream reported
  // success: a thin answer is cacheable, but not for as long as a real one.
  //
  // ## Why `refresh` keeps the full TTL even for a thin answer
  //
  // `refresh` marks a caller that RE-ASKS on a schedule and therefore owns the
  // freshness contract itself — in practice the nightly warm sweep. Two reasons
  // it must not take the short TTL:
  //
  //  - A degraded answer it writes is replaced on the next sweep, so the
  //    exposure is one night rather than the full week. The short TTL is not
  //    buying anything a sweep is not already buying.
  //  - `needsWarming` decides a target is due from its layers' TTLs. Letting
  //    the two search layers expire in minutes would make EVERY target look
  //    permanently due, turning a selective sweep into a nightly full re-fetch
  //    of the whole fleet — the 6.2g failure mode arrived at from the other
  //    direction.
  const ttl =
    typeof ttlSeconds === "number"
      ? ttlSeconds
      : opts.refresh || !ttlSeconds.isThin(value)
        ? ttlSeconds.full
        : ttlSeconds.thin;
  await redis.set(key, JSON.stringify(value), "EX", jitteredTtl(ttl, opts.jitterSeconds));
  return value;
}

/**
 * `ttlSeconds` less a uniform random slice of `jitterSeconds`, floored at one
 * second so a large jitter can never write a non-positive EX (which Redis
 * rejects, turning a cache write into a thrown error).
 */
export function jitteredTtl(ttlSeconds: number, jitterSeconds = 0): number {
  if (jitterSeconds <= 0) return ttlSeconds;
  const spread = Math.min(jitterSeconds, ttlSeconds - 1);
  return Math.max(1, ttlSeconds - Math.floor(Math.random() * spread));
}

/** Drop a cached entry so the next read re-fetches upstream. */
export async function invalidateCached(key: string): Promise<void> {
  await redis.del(key);
}

/**
 * Read a cached entry WITHOUT falling through to an upstream fetch. Returns
 * `undefined` on a miss (distinct from a cached `null`). Used when the caller
 * needs to know whether work is already done before deciding to start it.
 */
export async function peekCached<T>(key: string): Promise<T | undefined> {
  const hit = await redis.get(key);
  return hit === null ? undefined : (JSON.parse(hit) as T);
}

/**
 * Seconds until `key` expires, or `null` if it is absent (or somehow has no
 * expiry). Distinct from `peekCached` because the pre-warmer cares about how
 * much LIFE a cached answer has left, not what it says: a discography that is
 * correct but expires in an hour is work that needs doing tonight.
 *
 * Redis returns -2 for "no such key" and -1 for "exists, no TTL"; both collapse
 * to `null` here, because both mean "cannot be relied on to still be there".
 */
export async function ttlOf(key: string): Promise<number | null> {
  const ttl = await redis.ttl(key);
  return ttl < 0 ? null : ttl;
}
