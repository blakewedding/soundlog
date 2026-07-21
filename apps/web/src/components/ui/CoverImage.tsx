import { useEffect, useState } from "react";
import { cachedCoverColor, extractCoverColor } from "../../lib/coverColor";

interface Props {
  src?: string | null;
  alt: string;
  zoomable?: boolean;
  onClick?: () => void;
}

/**
 * Album cover with progressive load. The tile is painted with a muted tint of
 * the artwork (see lib/coverColor) and the image fades in over it — live
 * seed-on-first-access covers arrive late, and this makes the wait read as
 * loading rather than breakage.
 *
 * The tint falls back to the flat --ink-2 tile whenever a colour isn't known:
 * the first time a cover is seen, when the host refuses a cross-origin pixel
 * read, or when artwork 404s. Colour extraction is supplemental and is never
 * allowed to affect whether the real image loads.
 *
 * Non-square artwork (cassette J-card spreads, gatefold scans) letterboxes
 * inside the tile instead of being center-cropped into an unrecognizable
 * smear by object-fit: cover.
 */
export function CoverImage({ src, alt, zoomable, onClick }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [letterbox, setLetterbox] = useState(false);
  // Seeded synchronously so a known colour is present on the very first paint
  // rather than flashing --ink-2 for a frame.
  const [tint, setTint] = useState(() => cachedCoverColor(src));

  useEffect(() => {
    setTint(cachedCoverColor(src));
    if (!src) return;

    let active = true;
    extractCoverColor(src).then((color) => {
      // Guard against the src changing while extraction was in flight — a
      // recycled grid tile must never wear the previous release's colour.
      if (active && color) setTint(color);
    });
    return () => {
      active = false;
    };
  }, [src]);

  function handleLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    if (img.naturalWidth && img.naturalHeight) {
      const ratio = img.naturalWidth / img.naturalHeight;
      if (ratio > 1.3 || ratio < 0.77) setLetterbox(true);
    }
    setLoaded(true);
  }

  const image = src && (
    <img
      src={src}
      alt={onClick ? "" : alt}
      className={loaded ? undefined : "img-loading"}
      style={letterbox ? { objectFit: "contain" } : undefined}
      onLoad={handleLoad}
      loading="lazy"
    />
  );

  const background = tint ? { background: tint } : undefined;

  // A clickable cover is a control, so it is rendered as a real <button>. It
  // used to be a <div onClick>, which meant the release page's zoom-to-full-size
  // affordance existed only for a mouse — no tab stop, no Enter, no Space, and
  // nothing announced. The alt text moves to the button's label so a screen
  // reader hears one thing, not the image name followed by the button name.
  if (onClick) {
    return (
      <button
        type="button"
        className={`cover cover-button${zoomable ? " cover-zoom" : ""}`}
        onClick={onClick}
        style={background}
        aria-label={`${alt} — view full size`}
      >
        {image}
      </button>
    );
  }

  return (
    <div className={`cover${zoomable ? " cover-zoom" : ""}`} style={background}>
      {image}
    </div>
  );
}
