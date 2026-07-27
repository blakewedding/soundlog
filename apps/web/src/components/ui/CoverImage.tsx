import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cachedCoverColor, extractCoverColor, mutedTint } from "../../lib/coverColor";
import { coverSources, type CoverSize } from "../../lib/coverVariant";

interface Props {
  src?: string | null;
  alt: string;
  /**
   * Which rendered size this mount is. Picks the proxied rendition (and its 2x)
   * rather than downloading a 400px image for a 40px thumbnail — see
   * lib/coverVariant.ts. Defaults to the grid tile, the most common surface.
   */
  size?: CoverSize;
  /**
   * The artwork's dominant colour as `#rrggbb`, from `release.coverColor`. When
   * present the tile is tinted on its FIRST paint, with no canvas read and no
   * localStorage round-trip.
   */
  color?: string | null;
  /**
   * True when the artwork is still being fetched server-side. Draws the tile as
   * loading rather than as a release that simply has no cover — the two were
   * indistinguishable, which is the whole of the 6.1.1 defect in one tile.
   */
  pending?: boolean;
  zoomable?: boolean;
  onClick?: () => void;
}

/**
 * Album cover with progressive load. The tile is painted with a muted tint of
 * the artwork (see lib/coverColor) and the image fades in over it — live
 * seed-on-first-access covers arrive late, and this makes the wait read as
 * loading rather than breakage.
 *
 * Two sources of that tint, in order of preference:
 *
 *  1. `color`, sampled server-side and delivered with the release. Available on
 *     the first paint of a cover nobody has ever seen, which is the view that
 *     needs it most.
 *  2. Browser-side extraction, the 5.5 path, for rows the server has not sampled
 *     (seeded before 6.1, or artwork it could not read).
 *
 * When (1) is present, (2) is not run at all: two algorithms sampling the same
 * artwork would disagree slightly, and the tile would visibly change colour
 * mid-load for no reason a viewer could interpret.
 *
 * The tint falls back to the flat --ink-2 tile whenever no colour is known.
 * Colour is supplemental and is never allowed to affect whether the real image
 * loads.
 *
 * Non-square artwork (cassette J-card spreads, gatefold scans) letterboxes
 * inside the tile instead of being center-cropped into an unrecognizable
 * smear by object-fit: cover.
 */
export function CoverImage({ src, alt, size = "grid", color, pending, zoomable, onClick }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [letterbox, setLetterbox] = useState(false);
  // Seeded synchronously so a known colour is present on the very first paint
  // rather than flashing --ink-2 for a frame.
  const [tint, setTint] = useState(() => mutedTint(color) ?? cachedCoverColor(src));
  const imgRef = useRef<HTMLImageElement>(null);

  const served = coverSources(src, size);

  useEffect(() => {
    const fromServer = mutedTint(color);
    if (fromServer) {
      setTint(fromServer);
      return;
    }

    setTint(cachedCoverColor(src));
    if (!src) return;

    let active = true;
    // Extraction reads the rendition the browser is already fetching, so it
    // costs no extra request — and being same-origin now, the canvas read no
    // longer depends on a third party sending CORS headers.
    extractCoverColor(served.src ?? src).then((extracted) => {
      // Guard against the src changing while extraction was in flight — a
      // recycled grid tile must never wear the previous release's colour.
      if (active && extracted) setTint(extracted);
    });
    return () => {
      active = false;
    };
  }, [src, color, served.src]);

  // Everything that must happen once the pixels are known, from whichever path
  // got us there. It has to be callable without an event, because on the cached
  // path there is no event to be called from.
  const settle = useCallback((img: HTMLImageElement) => {
    if (img.naturalWidth && img.naturalHeight) {
      const ratio = img.naturalWidth / img.naturalHeight;
      if (ratio > 1.3 || ratio < 0.77) setLetterbox(true);
    }
    setLoaded(true);
  }, []);

  function handleLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    settle(e.currentTarget);
  }

  // An image can finish decoding BEFORE React attaches its onLoad handler — a
  // warm HTTP cache, a /covers/ rendition already on disk, a bfcache restore.
  // That load event fires against the element but is never delivered to us, so
  // waiting for it leaves `.img-loading` in place and the artwork sits at
  // opacity 0 forever: decoded, correctly sized, and completely invisible.
  //
  // So ask the element what has already happened rather than waiting to be
  // told. Layout effect, not a passive one, so the class is gone before the
  // browser paints — clearing it after paint is a visible flash of nothing.
  //
  // `complete` is also true for an errored or empty src, which is why
  // naturalWidth is the real predicate: it is non-zero only if pixels exist.
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth) settle(img);
  }, [served.src, settle]);

  const image = src && (
    <img
      ref={imgRef}
      src={served.src}
      srcSet={served.srcSet}
      alt={onClick ? "" : alt}
      className={loaded ? undefined : "img-loading"}
      style={letterbox ? { objectFit: "contain" } : undefined}
      onLoad={handleLoad}
      loading="lazy"
    />
  );

  const background = tint ? { background: tint } : undefined;
  const state = pending ? " cover-pending" : "";

  // A clickable cover is a control, so it is rendered as a real <button>. It
  // used to be a <div onClick>, which meant the release page's zoom-to-full-size
  // affordance existed only for a mouse — no tab stop, no Enter, no Space, and
  // nothing announced. The alt text moves to the button's label so a screen
  // reader hears one thing, not the image name followed by the button name.
  if (onClick) {
    return (
      <button
        type="button"
        className={`cover cover-button${zoomable ? " cover-zoom" : ""}${state}`}
        onClick={onClick}
        style={background}
        aria-label={`${alt} — view full size`}
      >
        {image}
      </button>
    );
  }

  return (
    <div className={`cover${zoomable ? " cover-zoom" : ""}${state}`} style={background}>
      {image}
    </div>
  );
}
