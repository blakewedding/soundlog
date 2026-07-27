// The one implementation of "ask our origin for the size actually being
// rendered", shared by covers and avatars.
//
// Both are served from paths of the form `/<prefix>/w<width>/<name>`, where the
// width is a path SEGMENT rather than a query parameter — a query string is one
// more thing a CDN can be configured to strip from its cache key. Rewriting that
// segment is the whole of client-side size selection: no new API field, no
// second request, and the same URL for every visitor so the edge object is
// shared.
//
// Extracted in 6.2. `coverVariant.ts` and `avatarVariant.ts` are now both thin
// layers over this, which is what keeps CLAUDE.md §8's "never hand-build a
// proxied URL at a call site" true for two concepts instead of one — and means
// a change to how renditions are addressed happens in exactly one place.
//
// Anything that is not one of our proxied paths passes through untouched: a
// legacy row that has not been healed, an upstream host we do not proxy, or a
// test fixture. Those keep working exactly as before rather than becoming
// broken images.

/** Matches `/<prefix>/w<digits>/`, the rewritable part of one of our URLs. */
function pathPattern(prefix: string): RegExp {
  return new RegExp(`^/${prefix}/w\\d{1,4}/`);
}

/** Is `src` one of our proxied URLs under `prefix` (and therefore resizable)? */
export function isProxiedPath(src: string | null | undefined, prefix: string): boolean {
  return typeof src === "string" && pathPattern(prefix).test(src);
}

/** The same image at `width`, or `src` unchanged when it isn't ours to resize. */
export function variantAt(
  src: string | null | undefined,
  prefix: string,
  width: number
): string | null {
  if (!src) return null;
  if (!isProxiedPath(src, prefix)) return src;
  return src.replace(pathPattern(prefix), `/${prefix}/w${width}/`);
}

/**
 * `src` plus the `srcSet` for a surface, ready to spread onto an `<img>`.
 *
 * DPR descriptors (`1x`/`2x`) rather than `w` + `sizes`, because these tiles
 * have fixed CSS sizes: the browser needs to know the device pixel ratio, not
 * to work out a layout width. A retina phone gets the 2x rendition and nothing
 * else is downloaded.
 *
 * For an unproxied src, `srcSet` is undefined — offering the same URL as both
 * 1x and 2x would tell the browser a lie about what it is getting.
 */
export function variantSources(
  src: string | null | undefined,
  prefix: string,
  [oneX, twoX]: readonly [number, number]
): { src: string | undefined; srcSet: string | undefined } {
  if (!src) return { src: undefined, srcSet: undefined };
  if (!isProxiedPath(src, prefix)) return { src, srcSet: undefined };

  return {
    src: variantAt(src, prefix, oneX) ?? undefined,
    srcSet: `${variantAt(src, prefix, oneX)} 1x, ${variantAt(src, prefix, twoX)} 2x`,
  };
}
