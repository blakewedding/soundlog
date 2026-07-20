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
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  return value;
}
