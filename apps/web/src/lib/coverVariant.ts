// Ask the cover proxy for the size actually being rendered.
//
// Stored cover URLs are proxied paths — `/covers/w400/<encoded>.webp` — where the
// width is a segment rather than a query parameter (a query string is one more
// thing a CDN can be configured to strip from its cache key). Rewriting that
// segment is the whole client side of size selection: no new API field, no
// second request, and the same URL for everyone so the edge object is shared.
//
// A 500px original in a 40px diary thumbnail was most of what made covers feel
// slow — the stored URL before 6.1 was the untouched upstream original, measured
// at 2,254,558 bytes for a 140px grid tile.
//
// Anything that is not a proxied URL passes through untouched: a legacy row that
// has not been healed yet, an upstream host we do not proxy, or a test fixture.
// Those keep working exactly as before rather than becoming broken images.

/** Widths the backend renders. Anything else 404s — see services/coverProxy.ts. */
export const COVER_WIDTHS = [96, 200, 400, 640, 1200] as const;
export type CoverWidth = (typeof COVER_WIDTHS)[number];

/**
 * Rendered sizes, as CSS pixels, per surface — each mapped to the rendition that
 * covers it at 1x and at 2x. Keep these honest against theme.css:
 *
 *   row   40–56px   diary and chart thumbnails, list rows
 *   grid  132–200px `.release-grid` is minmax(140px, 1fr), 132px below 560px
 *   hero  240px     the fixed release-header column
 */
export const COVER_SIZES = {
  row: [96, 200],
  grid: [200, 400],
  hero: [400, 640],
} as const satisfies Record<string, readonly [CoverWidth, CoverWidth]>;

export type CoverSize = keyof typeof COVER_SIZES;

const PROXY_PATH = /^\/covers\/w\d{1,4}\//;

/**
 * Build a proxied URL for an upstream cover the client knows about but the
 * catalog does not — today that is only the discography's un-seeded entries,
 * whose artwork is addressable straight off a release-group MBID.
 *
 * Must stay byte-identical to the backend's encoding (`toProxiedUrl` in
 * `backend/src/services/coverProxy.ts`): base64url of the UTF-8 URL, no padding.
 * The backend re-validates the host, so a URL built here that isn't on its
 * allowlist is a 404 rather than a proxy someone can point anywhere.
 */
export function proxiedUpstream(upstreamUrl: string, width: CoverWidth): string {
  const bytes = new TextEncoder().encode(upstreamUrl);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64url = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `/covers/w${width}/${base64url}.webp`;
}

/** Is this one of our proxied cover URLs (and therefore resizable)? */
export function isProxiedCover(src: string | null | undefined): boolean {
  return typeof src === "string" && PROXY_PATH.test(src);
}

/** The same cover at `width`, or `src` unchanged when it isn't ours to resize. */
export function coverAt(src: string | null | undefined, width: CoverWidth): string | null {
  if (!src) return null;
  if (!isProxiedCover(src)) return src;
  return src.replace(PROXY_PATH, `/covers/w${width}/`);
}

/**
 * `src` plus the `srcSet` for a surface, ready to spread onto an `<img>`.
 *
 * DPR descriptors (`1x`/`2x`) rather than `w` + `sizes`, because these tiles have
 * fixed CSS sizes: the browser needs to know the device pixel ratio, not to work
 * out a layout width. A retina phone gets the 2x rendition and nothing else is
 * downloaded.
 *
 * For an unproxied src, `srcSet` is undefined — offering the same URL as both 1x
 * and 2x would tell the browser a lie about what it is getting.
 */
export function coverSources(
  src: string | null | undefined,
  size: CoverSize
): { src: string | undefined; srcSet: string | undefined } {
  if (!src) return { src: undefined, srcSet: undefined };
  if (!isProxiedCover(src)) return { src, srcSet: undefined };

  const [oneX, twoX] = COVER_SIZES[size];
  return {
    src: coverAt(src, oneX) ?? undefined,
    srcSet: `${coverAt(src, oneX)} 1x, ${coverAt(src, twoX)} 2x`,
  };
}
