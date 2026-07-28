// Cloudflare cache purge — evicting avatar renditions from the edge.
//
// ## Why this file exists at all
//
// Avatars are served from our own origin with `public, max-age=31536000,
// immutable` (§7, routes/avatars.ts), and Cloudflare caches `.webp` by default.
// That combination is correct and deliberate — a content-hashed URL makes a
// year-long lifetime honest — but it has one consequence nobody had measured
// until 6.2b step 6:
//
//     $ curl -I https://soundlog.app/avatars/w384/<id>-<hash>.webp
//     cf-cache-status: HIT
//     age: 59345
//
// 16.5 hours old, under a one-year lifetime, in the ORD colo. Deleting the
// database row and unlinking the bytes on disk does NOT stop that copy being
// served. For a photograph of a person, that is the whole difference between
// honouring a deletion request and appearing to.
//
// So this is not a cache optimisation. It is the last layer of a delete.
//
// ## §1, and why this file's error shape differs
//
// §1's three outcomes are data / `null` (genuinely absent, cacheable) / throw
// (we could not tell). The middle outcome does not exist here: a purge either
// happened or it did not, and there is no third answer to confuse it with.
// So this file throws for every failure and returns for success — a two-outcome
// shape that is complete rather than a collapsed three.
//
// What §1 still governs, and what `retryable` carries, is the distinction
// between "Cloudflare was busy" and "our token is wrong". Both mean residue
// remains and neither may be reported as a successful deletion, but they need
// different humans to fix them, so the error says which it is instead of
// flattening both into "purge failed".
//
// ## §7
//
// The token travels in an Authorization header, never a URL parameter, and
// lives only in .env.production on the server. It is scoped to Zone → Cache
// Purge on soundlog.app alone, so the worst a leak buys an attacker is a cold
// cache.
import { env, appOrigin } from "../config/env.js";
import { AVATAR_WIDTHS } from "./avatarStorage.js";

const CF_API = "https://api.cloudflare.com/client/v4";
const TIMEOUT_MS = 10_000;

// Cloudflare's own list of "ask again" statuses, matching the MusicBrainz and
// Resend clients rather than inventing a third opinion.
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * A purge did not happen.
 *
 * `retryable` distinguishes an upstream having a bad minute from a credential
 * that will never work. Callers do not branch on it — residue is residue — but
 * the operator reading the log needs to know whether to retry or to go and look
 * at the token.
 */
export class CloudflarePurgeError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "CloudflarePurgeError";
  }
}

/**
 * Whether edge purging is configured.
 *
 * Exported so callers can say "skipped, not configured" out loud rather than
 * letting an unconfigured stack look like a successful purge. A local stack and
 * CI legitimately have no token; production legitimately must.
 */
export function cloudflarePurgeConfigured(): boolean {
  return Boolean(env.CLOUDFLARE_ZONE_ID && env.CLOUDFLARE_PURGE_TOKEN);
}

async function cfFetch(path: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${CF_API}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        // §7: the credential is a header, never a query parameter.
        Authorization: `Bearer ${env.CLOUDFLARE_PURGE_TOKEN}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch (err) {
    // Timeout, DNS, dropped socket — we could not tell whether it worked.
    const reason = err instanceof Error ? err.message : String(err);
    throw new CloudflarePurgeError(`Cloudflare unreachable: ${reason}`, true);
  } finally {
    clearTimeout(timer);
  }

  const body = (await res.json().catch(() => null)) as
    | { success?: boolean; errors?: { code?: number; message?: string }[] }
    | null;

  if (!res.ok) {
    const detail = body?.errors?.map((e) => e.message).filter(Boolean).join("; ");
    throw new CloudflarePurgeError(
      `Cloudflare responded ${res.status}${detail ? `: ${detail}` : ""}`,
      RETRYABLE_STATUS.has(res.status)
    );
  }
  // A 200 with `success: false` is Cloudflare's normal way of refusing —
  // treating a 200 as proof would be exactly the lie this module exists to
  // prevent.
  if (!body?.success) {
    const detail = body?.errors?.map((e) => e.message).filter(Boolean).join("; ");
    throw new CloudflarePurgeError(
      `Cloudflare refused the request${detail ? `: ${detail}` : ""}`,
      false
    );
  }
  return body;
}

/**
 * Check the token works, WITHOUT changing anything.
 *
 * This is what lets the irreversible step stay last. Account deletion runs this
 * before it touches Postgres, so a missing, expired or wrongly-scoped token
 * fails while the account still exists and the user can simply try again — a
 * retryable condition kept retryable, which is §1 applied to an ordering
 * problem rather than to a status code.
 *
 * @throws CloudflarePurgeError when the credential cannot be confirmed.
 */
export async function verifyPurgeCredentials(): Promise<void> {
  if (!cloudflarePurgeConfigured()) {
    throw new CloudflarePurgeError("Cloudflare purge is not configured", false);
  }
  await cfFetch("/user/tokens/verify", { method: "GET" });
}

/**
 * Purge specific URLs from the edge.
 *
 * Absolute URLs on our own origin — Cloudflare's purge-by-URL matches on the
 * full URL, so a path alone silently purges nothing.
 *
 * @throws CloudflarePurgeError when the purge did not happen.
 */
export async function purgeUrls(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  if (!cloudflarePurgeConfigured()) {
    throw new CloudflarePurgeError("Cloudflare purge is not configured", false);
  }
  await cfFetch(`/zones/${env.CLOUDFLARE_ZONE_ID}/purge_cache`, {
    method: "POST",
    body: JSON.stringify({ files: urls }),
  });
}

/**
 * Absolute URLs for every rendition of one avatar hash.
 *
 * EVERY width, not the ones the UI happens to request. The renditions are
 * generated on demand from the master, so any width in AVATAR_WIDTHS is
 * pullable by anyone who constructs the URL — proven while measuring this:
 * w192/w384 were already cached from a real phone session, and w48/w96 became
 * cached the moment a probe asked for them. Purging only what the UI uses would
 * leave the others behind.
 */
export function avatarPurgeUrls(userId: string, hash: string, widths: readonly number[]): string[] {
  return widths.map((w) => new URL(`/avatars/w${w}/${userId}-${hash}.webp`, appOrigin).toString());
}

export type PurgeOutcome =
  | { status: "purged" }
  | { status: "skipped-unconfigured" }
  | { status: "failed"; detail: string };

/**
 * Purge one avatar hash from the edge, reporting rather than throwing.
 *
 * The single path used by all three call sites that make an avatar stop
 * existing — replace, remove, and account deletion — so the class is fixed
 * once. Before this, `deleteAvatarFiles` was called by two of them and the edge
 * by none, which meant a member who changed their picture twice left two prior
 * faces at Cloudflare for a year each.
 *
 * `skipped-unconfigured` is a real outcome and is never collapsed into
 * `purged`: a dev stack with no token has not purged anything, and the one
 * thing this must not do is let an absent credential read as a completed erase.
 */
export async function purgeAvatar(
  userId: string,
  hash: string,
  widths: readonly number[] = AVATAR_WIDTHS
): Promise<PurgeOutcome> {
  if (!cloudflarePurgeConfigured()) return { status: "skipped-unconfigured" };
  try {
    await purgeUrls(avatarPurgeUrls(userId, hash, widths));
    return { status: "purged" };
  } catch (err) {
    const detail = (err as Error).message;
    console.error(`[purge] avatar ${userId}-${hash} not purged from the edge: ${detail}`);
    return { status: "failed", detail };
  }
}
