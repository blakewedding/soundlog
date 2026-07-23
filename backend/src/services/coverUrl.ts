/**
 * Cover art URLs are stored HTTPS-only.
 *
 * Two things break on cleartext image URLs, and neither is hypothetical:
 *
 *  - **Mixed content.** Once the web app is served over TLS (Phase 6), a
 *    browser refuses to load an `http://` image inside an `https://` page. 77%
 *    of the catalog's stored covers were cleartext, so the release grid would
 *    have gone blank the day the site got a certificate.
 *  - **iOS App Transport Security.** A release build blocks arbitrary cleartext
 *    loads, while Expo Go permits them — so native covers would work all the
 *    way through development and fail only in the shipped app.
 *
 * Every upstream we take artwork from (Cover Art Archive, Discogs, Spotify)
 * serves the identical bytes over HTTPS, so this is a scheme rewrite and not a
 * different image.
 *
 * Deliberately a *rewrite*, never a check. The Cover Art Archive and its
 * archive.org backend return intermittent 500s — one stored URL was observed
 * returning 500 four times in a row and 200 on the fifth. Verifying each URL
 * and discarding the failures would delete good artwork on a transient error:
 * the retryable-treated-as-permanent bug CLAUDE.md §1 exists to prevent. No
 * network call happens here.
 */

/**
 * Upgrade an `http://` URL to `https://`. Returns other values untouched:
 * already-secure URLs, data: URIs, and null/undefined all pass through.
 *
 * Loopback and private hosts are left alone — a dev-only `http://localhost`
 * asset has no TLS to upgrade to, and rewriting it would turn a working URL
 * into a broken one.
 */
export function toSecureUrl<T extends string | null | undefined>(url: T): T {
  if (typeof url !== "string") return url;

  const trimmed = url.trim();
  if (!trimmed.toLowerCase().startsWith("http://")) return url;

  const host = trimmed.slice("http://".length).split(/[/?#]/)[0].split("@").pop() ?? "";
  const hostname = (host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0])
    .replace(/^\[|\]$/g, "")
    .toLowerCase();

  if (isLocalHostname(hostname)) return url;

  return (`https://${trimmed.slice("http://".length)}`) as T;
}

/** Hosts with no public TLS: loopback, link-local, and RFC1918 ranges. */
function isLocalHostname(hostname: string): boolean {
  if (!hostname) return true;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname === "::1" || hostname === "0.0.0.0") return true;
  if (/^127\./.test(hostname)) return true;
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (/^169\.254\./.test(hostname)) return true;
  return false;
}

/** Apply {@link toSecureUrl} to the thumb/large pair covers are resolved as. */
export function toSecureCovers<T extends { thumb: string | null; large: string | null }>(
  covers: T
): T {
  return { ...covers, thumb: toSecureUrl(covers.thumb), large: toSecureUrl(covers.large) };
}
