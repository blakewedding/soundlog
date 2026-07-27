import { avatarSources, type AvatarSize } from "../../lib/avatarVariant";

interface Props {
  src?: string | null;
  /**
   * The person, for assistive tech — a display name or username, NOT a
   * sentence. The component decides how to phrase it; see `decorative`.
   */
  name: string;
  /** Which rendered size this mount is. Picks the rendition and its 2x. */
  size?: AvatarSize;
  /**
   * True when the avatar sits directly beside the person's name as text, which
   * is the common case — a review card, a comment, a follower row.
   *
   * The image is then announced as decorative (`alt=""`) rather than repeating
   * a name the screen reader is about to read anyway. §8's "two controls on one
   * page must not share an accessible name" is the same instinct one level up:
   * hearing "Blake, Blake" on every comment is noise, not information.
   *
   * Defaults to true because the standalone case — the profile header, where
   * the avatar is the only thing identifying whose page this is — is the rarer
   * one and is better opted into deliberately.
   */
  decorative?: boolean;
}

/**
 * A user's picture. Circular, with a person-shaped fallback.
 *
 * §8 asks whether `CoverImage` should have grown a prop instead, and the answer
 * recorded before implementation was no: avatars are circular where covers are
 * square, fall back to a person glyph rather than a colour tint sampled from
 * artwork, never letterbox (the backend centre-crops them square, which is
 * right for a face and wrong for a gatefold), and carry different alt-text
 * semantics. What the two DO share is the rendition helper, so neither ever
 * hand-builds a URL at a call site — see lib/imageVariant.ts.
 *
 * Nothing here does progressive tinting the way CoverImage does. An avatar is
 * small, arrives from our own origin, and has a fallback that is already the
 * right shape and colour, so there is no wait worth dressing up.
 */
export function Avatar({ src, name, size = "card", decorative = true }: Props) {
  const served = avatarSources(src, size);

  return (
    <span className={`avatar avatar-${size}`} aria-hidden={decorative && !src ? true : undefined}>
      {served.src ? (
        <img
          src={served.src}
          srcSet={served.srcSet}
          alt={decorative ? "" : `${name}'s profile picture`}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <PersonGlyph />
      )}
    </span>
  );
}

/**
 * The empty state. A glyph rather than initials: initials look like data the
 * user chose, and get progressively worse the further you go from Latin script
 * — a single-character username, an emoji, or a name whose first grapheme is a
 * combining mark all render as noise.
 */
function PersonGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle cx="12" cy="9" r="3.6" fill="currentColor" />
      <path
        d="M4.8 20.4c0-3.6 3.2-6 7.2-6s7.2 2.4 7.2 6"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
