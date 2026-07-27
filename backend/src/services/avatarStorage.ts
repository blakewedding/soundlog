/**
 * The URL shape and on-disk layout of user avatars: `/avatars/w<width>/<userId>-<hash>.webp`.
 *
 * Pure path and URL logic — no I/O, no sharp. The same split `coverProxy.ts`
 * and `coverCache.ts` make, and for the same reason: the shape of a URL is
 * worth being able to test without a filesystem or a network.
 *
 * ## How this deliberately DIFFERS from the cover proxy
 *
 * The two look alike and are governed by opposite rules, so the differences are
 * worth stating rather than leaving to be inferred:
 *
 *  - **No encoded upstream URL.** A proxied cover path encodes the upstream URL
 *    it came from, which is what makes the heal and the rollback pure string
 *    transforms. An avatar has no upstream, so there is nothing to be reversible
 *    about and nothing to decode.
 *  - **No host allowlist.** The cover proxy fetches a caller-influenced URL, so
 *    an allowlist is what stops it being an SSRF hole and an open image CDN.
 *    This route fetches nothing at all: it serves bytes a signed-in user already
 *    uploaded through the validation gauntlet. There is no request to forge.
 *  - **No eviction, ever.** A cover rendition dropped by the LRU sweeper is
 *    re-fetchable. An avatar is the only copy.
 *
 * ## Why the content hash is in the URL
 *
 * The alternative, `/avatars/w96/<userId>.webp`, is stable per user and looks
 * tidier. It is also unservable with a long cache lifetime: a user who changes
 * their picture would keep being served the old one — by their browser, by
 * Cloudflare, and by Varnish — for as long as the TTL says, and the TTL is what
 * makes this cheap. Naming the file after the bytes restores the property that
 * makes `immutable` honest rather than a bet: a given URL can only ever mean one
 * rendition of one image, so a new upload is a new URL by construction. It is
 * the same reasoning the cover proxy relies on, reached by a different route.
 *
 * The hash is of the ORIGINAL uploaded bytes, not the re-encoded output, so
 * re-uploading the same file is idempotent — same URL, no cache churn, no new
 * master on disk.
 */
import path from "node:path";
import { env } from "../config/env.js";

/**
 * Rendition widths, in CSS pixels. Far fewer than the covers' five: an avatar
 * is never a hero image, and every width is a directory that has to be
 * regenerated after a restore.
 */
export const AVATAR_WIDTHS = [48, 96, 192, 384] as const;
export type AvatarWidth = (typeof AVATAR_WIDTHS)[number];

/**
 * The master's dimension. Larger than the largest rendition so that `384` is a
 * real downscale rather than an upscale of something smaller, and large enough
 * that adding a fifth width later is a code change rather than a mass
 * re-upload request. This is the durable, backed-up artefact; every `w<n>`
 * rendition is derived from it and is safe to delete.
 */
export const AVATAR_MASTER_SIZE = 512;

/**
 * The width written into `User.avatarUrl`. The largest rendition, so that every
 * surface can rewrite the segment DOWNWARD to what it actually paints — a
 * client can always ask for less, never for more than we rendered.
 */
export const AVATAR_STORED_WIDTH: AvatarWidth = 384;

const PREFIX = "/avatars/";

/** sha256 of the uploaded bytes, truncated. 16 hex is 64 bits. */
export const AVATAR_HASH_LENGTH = 16;

/**
 * The storage root, read through a function rather than captured at import —
 * the same test seam `coverCacheDir()` exists for. `env` is parsed once at
 * module load, so a test that wants its own directory cannot get one by setting
 * an environment variable.
 */
let storageRoot = env.AVATAR_DIR;
export function avatarDir(): string {
  return storageRoot;
}

/**
 * Shard on the first two characters of the HASH, never the user id.
 *
 * cuid() ids all begin with the literal character `c`, so sharding on the id
 * would produce exactly one directory holding every avatar in the system —
 * a flat directory wearing the costume of a sharded one. A sha256 prefix is
 * uniformly distributed, which is the property being bought.
 */
function shard(hash: string): string {
  return hash.slice(0, 2);
}

/** The durable original. This is the file that must survive; see backup-db.sh. */
export function masterPath(userId: string, hash: string): string {
  return path.join(avatarDir(), "master", shard(hash), `${userId}-${hash}.webp`);
}

/** A derived rendition. Regenerable from the master, so it is not backed up. */
export function variantPath(userId: string, hash: string, width: AvatarWidth): string {
  return path.join(avatarDir(), `w${width}`, shard(hash), `${userId}-${hash}.webp`);
}

/** The value stored in `User.avatarUrl`. */
export function avatarUrlFor(userId: string, hash: string): string {
  return `${PREFIX}w${AVATAR_STORED_WIDTH}/${userId}-${hash}.webp`;
}

/** Is this one of ours? Used by the web client to decide it may resize. */
export function isAvatarUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith(PREFIX);
}

/**
 * A user id as it may appear in a path segment.
 *
 * The real constraint is not "is this a cuid" but "can this escape the
 * directory" — no slash, no dot, no percent, nothing that `path.join` would
 * interpret. Lowercase alphanumeric with a bounded length says that
 * positively, which is stronger than blacklisting `..`. The route additionally
 * only ever serves a path it can match against a hash we hold, so a
 * well-formed id for a user who does not exist is a 404 rather than a read.
 */
const USER_ID = /^[a-z0-9]{8,64}$/;
const HASH = new RegExp(`^[0-9a-f]{${AVATAR_HASH_LENGTH}}$`);

/**
 * Decode `/avatars/w<width>/<userId>-<hash>.webp` into its parts, or null if it
 * is not a path this module would have produced — an unknown width, a malformed
 * id, a short hash, a missing extension. The route treats null as a 404: a
 * request we would never have emitted is not a request we serve.
 */
export function parseAvatarPath(
  urlPath: string
): { width: AvatarWidth; userId: string; hash: string } | null {
  if (!urlPath.startsWith(PREFIX)) return null;
  const rest = urlPath.slice(PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;

  const width = parseAvatarWidth(rest.slice(0, slash).replace(/^w/, ""));
  if (width === null) return null;

  const file = rest.slice(slash + 1);
  if (!file.endsWith(".webp")) return null;
  const stem = file.slice(0, -".webp".length);

  // The id is lowercase base36 and cannot contain a hyphen, so the LAST hyphen
  // is unambiguously the separator.
  const cut = stem.lastIndexOf("-");
  if (cut < 0) return null;

  const userId = stem.slice(0, cut);
  const hash = stem.slice(cut + 1);
  if (!USER_ID.test(userId) || !HASH.test(hash)) return null;

  return { width, userId, hash };
}

/** Parse a width segment against the allowlist. Returns null when it isn't one. */
export function parseAvatarWidth(raw: string): AvatarWidth | null {
  // No leading zeros: `w048` and `w48` would otherwise be two URLs for one
  // rendition — two CDN objects and two disk entries for one image.
  if (!/^[1-9]\d{0,3}$/.test(raw)) return null;
  const n = Number(raw);
  return (AVATAR_WIDTHS as readonly number[]).includes(n) ? (n as AvatarWidth) : null;
}

/** Test seam: point the module at a scratch directory. */
export function __setAvatarDir(dir: string): void {
  storageRoot = dir;
}
