import { redis } from "../config/redis.js";

/**
 * Read-through Redis cache. `null` results are cached too (stored as the JSON
 * literal `null`) so a known "no match" doesn't trigger a repeat upstream call —
 * `redis.get` returns the string "null", distinct from a genuine cache miss.
 */
export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const hit = await redis.get(key);
  if (hit !== null) return JSON.parse(hit) as T;
  const value = await fn();
  // NB: if fn() throws, we never reach this write — which is what keeps a
  // partial/failed assembly out of the cache (Phase 5.6/5.7 semantics).
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  return value;
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
