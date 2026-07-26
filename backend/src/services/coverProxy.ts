/**
 * The URL shape of the cover proxy: `/covers/w<width>/<encoded>.webp`.
 *
 * Covers used to be loaded browser-direct from the Cover Art Archive and
 * i.discogs.com — the one deliberate exception to §7. Three measured costs
 * closed it:
 *
 *  - **We were shipping originals into thumbnails.** The stored `coverUrl` for
 *    *Lost in the Dream* was 2,254,558 bytes, painted into a 140px grid tile.
 *  - **Two redirects and a 1.8–2.4s TTFB**, because coverartarchive.org hands
 *    off to an Internet Archive node (`dn7109xx.ca.archive.org`).
 *  - **Cloudflare cannot cache a hostname that isn't ours**, so every visitor
 *    paid the full cost again. Cloudflare Web Analytics flagged release pages
 *    yellow on LCP, and the cover is the largest element on them.
 *
 * ## Why the upstream URL is encoded into the path
 *
 * The alternative was a short opaque id with the mapping held somewhere. Every
 * version of that has a failure mode where the mapping is lost (a flushed
 * Redis, a dropped table) and the catalog's artwork becomes unrecoverable
 * 404s. Encoding the upstream URL makes the proxied URL **self-describing and
 * reversible**: the heal is a pure string transform in both directions (see
 * `scripts/heal-cover-proxy.ts --revert`), no network call and no lookup, which
 * is the same discipline `coverUrl.ts` follows and for the same §1 reason.
 *
 * Reversibility is also the rollback plan. If this proxy has to be backed out,
 * the rows decode straight back to the upstream URLs they came from.
 *
 * ## Why an allowlist, not a signature
 *
 * A proxy that fetches an arbitrary caller-supplied URL is an SSRF hole and an
 * open image CDN for anyone who finds it. The host allowlist below closes both
 * without needing a shared secret in the URL: only artwork hosts we already
 * take covers from can be requested at all. Widths are likewise a fixed set —
 * `?w=1..2000` would let one crawler fill the disk with 2,000 renditions of
 * every cover.
 *
 * A host we do NOT recognise is left alone rather than rewritten. An unknown
 * artwork host keeps loading browser-direct, which is how it works today;
 * rewriting it would produce a URL this proxy is obliged to reject.
 */

/** Widths we will render. Anything else is a 404, by design (see above). */
export const COVER_WIDTHS = [96, 200, 400, 640, 1200] as const;
export type CoverWidth = (typeof COVER_WIDTHS)[number];

/**
 * Default stored widths. `coverUrl` is the one every surface falls back to, so
 * it is the largest size any *tile* renders (the 240px release hero at 2x);
 * `coverUrlLarge` feeds the lightbox. Clients ask for narrower renditions by
 * rewriting the width segment — see `apps/web/src/lib/coverVariant.ts`.
 */
export const COVER_THUMB_WIDTH: CoverWidth = 400;
export const COVER_LARGE_WIDTH: CoverWidth = 1200;

/**
 * Artwork hosts we proxy. Every host in the production catalog is here
 * (coverartarchive.org, i.discogs.com); i.scdn.co is Spotify's image CDN, which
 * the supplemental Spotify match can supply.
 *
 * These hosts redirect (CAA → archive.org nodes, i.scdn.co → its own edge) and
 * `fetch` follows redirects, so the allowlist is a statement of trust in the
 * host, not only in the literal URL.
 */
const ALLOWED_HOSTS = new Set(["coverartarchive.org", "i.discogs.com", "i.scdn.co"]);

const PREFIX = "/covers/";

/** Does this host's artwork go through the proxy? */
export function isProxyableCoverHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Is this cover request DISCOVERY rather than a lookup?
 *
 * The Cover Art Archive's `release-group/<mbid>/front-<size>` endpoint is a
 * redirect that answers "whatever the front cover for this group is, if there is
 * one". The web client builds those speculatively for **un-seeded discography
 * entries** — a grid of forty tiles for releases nobody has seeded, most of
 * which we will never hold. A stored `coverUrl` is the opposite: a specific
 * image for a release we already have.
 *
 * §7 draws exactly this line for metadata and it applies unchanged to bytes:
 * discovery gets one attempt and degrades, lookups retry. Retrying discovery
 * burns the very upstream budget whose exhaustion causes first-access failures —
 * which stopped being theoretical in 6.1.1, when a verification burst earned us
 * `HTTP 429` from the archive and each 429 was then retried three times, forty
 * tiles at a time.
 */
export function isDiscoveryCoverUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.toLowerCase() === "coverartarchive.org" &&
      /^\/release-group\/[^/]+\/front(-\d+)?$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

/** A `/covers/...` path produced by this module. */
export function isProxiedCoverUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith(PREFIX);
}

/**
 * Rewrite an upstream artwork URL into its proxied form at `width`.
 *
 * Idempotent and width-normalizing: handed a URL that is already proxied, it
 * re-emits it at the requested width rather than wrapping it twice. That is
 * what lets this be called at every persist point (and by the heal script)
 * without having to know whether the value has been through here before.
 *
 * Returns the input untouched for anything it cannot or should not proxy:
 * null/undefined, a data: URI, a relative path, or a host not on the allowlist.
 */
export function toProxiedUrl<T extends string | null | undefined>(url: T, width: CoverWidth): T {
  if (typeof url !== "string") return url;

  const decoded = decodeProxiedCoverPath(url);
  if (decoded) return encodeProxiedUrl(decoded.upstreamUrl, width) as T;
  if (isProxiedCoverUrl(url)) return url; // ours in shape but not decodable — leave it be
  if (!isProxyableCoverHost(url)) return url;

  return encodeProxiedUrl(url, width) as T;
}

/** Apply {@link toProxiedUrl} to the thumb/large pair covers are resolved as. */
export function toProxiedCovers<T extends { thumb: string | null; large: string | null }>(
  covers: T
): T {
  return {
    ...covers,
    thumb: toProxiedUrl(covers.thumb, COVER_THUMB_WIDTH),
    large: toProxiedUrl(covers.large, COVER_LARGE_WIDTH),
  };
}

function encodeProxiedUrl(upstreamUrl: string, width: CoverWidth): string {
  // base64url: no `+`, `/` or `=`, so the whole thing is one clean path segment.
  const encoded = Buffer.from(upstreamUrl, "utf8").toString("base64url");
  // The `.webp` suffix is load-bearing, not decoration: Cloudflare's default
  // cache behaviour keys on the extension in the path, so an extensionless
  // image URL would be served by the origin on every request even with an
  // immutable Cache-Control.
  return `${PREFIX}w${width}/${encoded}.webp`;
}

/**
 * Decode a proxied cover path back to `{ width, upstreamUrl }`, or null if it
 * is not one — an unknown width, a corrupt segment, a URL that doesn't parse,
 * or a host not on the allowlist. The route treats null as 404: a request this
 * module would never have produced is not a request we serve.
 */
export function decodeProxiedCoverPath(
  path: string
): { width: CoverWidth; upstreamUrl: string } | null {
  if (!path.startsWith(PREFIX)) return null;
  const rest = path.slice(PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;

  const width = parseCoverWidth(rest.slice(0, slash).replace(/^w/, ""));
  if (width === null) return null;

  const file = rest.slice(slash + 1);
  if (!file.endsWith(".webp")) return null;

  const upstreamUrl = decodeUpstream(file.slice(0, -".webp".length));
  return upstreamUrl ? { width, upstreamUrl } : null;
}

/** Parse a width segment against the allowlist. Returns null when it isn't one. */
export function parseCoverWidth(raw: string): CoverWidth | null {
  // No leading zeros: `w0400` and `w400` would otherwise be two URLs for one
  // rendition, which is two CDN objects and two disk entries for one image.
  if (!/^[1-9]\d{0,3}$/.test(raw)) return null;
  const n = Number(raw);
  return (COVER_WIDTHS as readonly number[]).includes(n) ? (n as CoverWidth) : null;
}

/**
 * Decode the encoded segment, then re-validate the host. The allowlist is
 * enforced on the way OUT as well as on the way in, because the way out is the
 * side an attacker controls.
 */
export function decodeUpstream(encoded: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;

  let candidate: string;
  try {
    candidate = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  // Buffer.from is lenient — confirm the segment round-trips exactly, so one
  // upstream URL has exactly one cache key and one CDN object.
  if (Buffer.from(candidate, "utf8").toString("base64url") !== encoded) return null;

  return isProxyableCoverHost(candidate) ? candidate : null;
}
