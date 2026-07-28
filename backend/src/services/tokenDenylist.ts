// Access-token denylist — closing the window between deleting an account and
// its last access token expiring.
//
// ## The problem
//
// `requireAuth` verifies a JWT signature and nothing else. That is the right
// design for a stateless token and it is why the hot path costs no I/O — but it
// means a token minted before a deletion keeps verifying until it expires. With
// JWT_ACCESS_TTL at 15m, a deleted account keeps working for up to fifteen
// minutes. Most writes would then fail on foreign keys, which makes it worse
// rather than better: the account is half-alive, and "I deleted my account and
// it still worked" is not a thing that should be demonstrable.
//
// Step 3 already settled the principle for the other direction — a password
// change that leaves other sessions minting tokens is theatre. A deletion that
// keeps working is the same claim with more at stake.
//
// ## Why Redis rather than a row lookup
//
// A `SELECT` in `requireAuth` would put a database round-trip on every
// authenticated request forever, to close a fifteen-minute window that opens a
// handful of times in the product's life. Redis is already load-bearing
// infrastructure (§7a) and already on the same host, so this adds no topology —
// and the key expires itself, so there is nothing to clean up and no table that
// grows without bound.
//
// ## This FAILS OPEN, deliberately, and that is a real limitation
//
// If Redis is unreachable, `isUserDenied` returns false and the request
// proceeds. Failing closed would mean a Redis blip signs out every user of the
// site — trading a bounded fifteen-minute window for a total outage.
//
// So this is best-effort, bounded by Redis availability, and that is stated
// here rather than implied: during a Redis outage the window reopens. It is
// strictly better than not having it, and it is not a security boundary that
// anything else may lean on. The durable facts remain that the row is gone and
// every refresh token is revoked, so the session cannot be renewed past the
// access token's own expiry either way.
import { redis } from "../config/redis.js";
import { accessTokenLifetimeSeconds } from "./tokenService.js";

const KEY_PREFIX = "denied_user:";

/**
 * Extra seconds on top of the access-token lifetime.
 *
 * Covers clock skew between the process that signed a token and the one
 * checking it, and the gap between a token being signed and the deletion
 * landing. Cheap insurance: the cost of an over-long entry is a few bytes for a
 * user who no longer exists.
 */
const SKEW_MARGIN_SECONDS = 60;

function key(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/**
 * Block every access token belonging to `userId` until they have all expired.
 *
 * The TTL derives from the signing path (`accessTokenLifetimeSeconds`), so
 * changing JWT_ACCESS_TTL cannot silently leave this too short.
 *
 * Throws if Redis is unwritable — the CALLER decides what that means. For
 * account deletion it is residue worth reporting, not a reason to leave the
 * account in place.
 */
export async function denyUserTokens(userId: string): Promise<void> {
  await redis.set(key(userId), "1", "EX", accessTokenLifetimeSeconds() + SKEW_MARGIN_SECONDS);
}

/**
 * Whether this user's tokens are denied.
 *
 * Fails OPEN — see the header. A Redis failure is logged once per occurrence
 * and treated as "not denied", because the alternative is signing out the
 * entire site when the cache has a bad minute.
 */
export async function isUserDenied(userId: string): Promise<boolean> {
  try {
    return (await redis.exists(key(userId))) === 1;
  } catch (err) {
    console.error("[denylist] check failed, failing open:", (err as Error).message);
    return false;
  }
}

/** Test seam: drop an entry so a suite can reuse an id. */
export async function __clearDenial(userId: string): Promise<void> {
  await redis.del(key(userId)).catch(() => {});
}
