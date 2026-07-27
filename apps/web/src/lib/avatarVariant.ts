// Avatar rendition selection. The segment rewrite is shared with covers via
// lib/imageVariant.ts; what lives here is everything avatar-SPECIFIC.
//
// Fewer widths than covers, because an avatar is never a hero image and every
// width is a directory the backend has to regenerate after a restore. See
// backend/src/services/avatarStorage.ts — this ladder must stay in step with
// AVATAR_WIDTHS there, or the client asks for a width the route 404s.
import { isProxiedPath, variantAt, variantSources } from "./imageVariant";

const PREFIX = "avatars";

/** Widths the backend renders. Anything else 404s, by design. */
export const AVATAR_WIDTHS = [48, 96, 192, 384] as const;
export type AvatarWidth = (typeof AVATAR_WIDTHS)[number];

/**
 * Rendered sizes, as CSS pixels, per surface — each mapped to the rendition
 * that covers it at 1x and at 2x:
 *
 *   row    24–32px   comment threads, compact lists
 *   card   40–56px   review cards, follower rows, nav
 *   hero   96px      the profile header
 */
export const AVATAR_SIZES = {
  row: [48, 96],
  card: [96, 192],
  hero: [192, 384],
} as const satisfies Record<string, readonly [AvatarWidth, AvatarWidth]>;

export type AvatarSize = keyof typeof AVATAR_SIZES;

/** Is this one of our avatar URLs (and therefore resizable)? */
export function isAvatarUrl(src: string | null | undefined): boolean {
  return isProxiedPath(src, PREFIX);
}

/** The same avatar at `width`, or `src` unchanged when it isn't ours. */
export function avatarAt(src: string | null | undefined, width: AvatarWidth): string | null {
  return variantAt(src, PREFIX, width);
}

/** `src` + `srcSet` for a surface, ready to spread onto an `<img>`. */
export function avatarSources(
  src: string | null | undefined,
  size: AvatarSize
): { src: string | undefined; srcSet: string | undefined } {
  return variantSources(src, PREFIX, AVATAR_SIZES[size]);
}
