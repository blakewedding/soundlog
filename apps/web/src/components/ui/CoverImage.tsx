import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cachedCoverColor, extractCoverColor, mutedTint } from "../../lib/coverColor";
import { coverSources, type CoverSize } from "../../lib/coverVariant";
import { useInViewport } from "../../hooks/useInViewport";
import { acquireCoverSlot } from "../../lib/coverLoadQueue";

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
  /**
   * Hold the request until the tile is actually near the viewport.
   *
   * Opt-in, and deliberately not the default: the hero cover on a release page
   * and the row thumbnails in a short list are above the fold by construction,
   * and deferring those would add an observer round-trip to the one image that
   * should start first.
   *
   * Turn it on for LONG grids, where native `loading="lazy"` is too generous —
   * see useInViewport for the measurement that motivated it.
   */
  defer?: boolean;
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
/**
 * The "no artwork" mark.
 *
 * Deliberately NOT the Soundlog mark: the brand guardrail in Wordmark.tsx is
 * that the mark is never recoloured and never redrawn, and a muted placeholder
 * would be both. This is a generic record — a disc and a spindle hole — drawn
 * in `currentColor` so the tile controls it, and marked aria-hidden because the
 * tile's alt text already says which release has no cover.
 *
 * Its job is to look INTENDED. A viewer cannot tell a missing image from a
 * broken site, so the absence has to be stated rather than left as a gap.
 */
function AbsentMark() {
  return (
    <svg className="cover-absent-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="24" cy="24" r="3.25" fill="currentColor" />
    </svg>
  );
}

export function CoverImage({
  src,
  alt,
  size = "grid",
  color,
  pending,
  zoomable,
  onClick,
  defer,
}: Props) {
  const [loaded, setLoaded] = useState(false);
  const [letterbox, setLetterbox] = useState(false);
  /**
   * The image errored. Tracked as STATE, not swallowed, because a failed load
   * is one of the three things a tile can be and it has to be able to say so.
   *
   * It matters most for the discography grid's un-seeded entries: those are
   * DISCOVERY requests, so they get exactly one attempt (§7) and a failure is
   * final for this page view. Before 6.3c that tile stayed a bare --ink-2 box,
   * pixel-identical to a release with no artwork and to one still loading —
   * so a §7 policy about how hard we try upstream rendered as a broken page.
   */
  const [failed, setFailed] = useState(false);
  // Seeded synchronously so a known colour is present on the very first paint
  // rather than flashing --ink-2 for a frame.
  const [tint, setTint] = useState(() => mutedTint(color) ?? cachedCoverColor(src));
  // Reset per-image state when the tile is pointed at different artwork.
  // During render rather than in an effect, deliberately: the layout effect
  // below re-settles an already-decoded image before paint, and a reset that
  // ran AFTER it would clear `loaded` back to false and hide a cover that was
  // already on screen. Grid tiles are recycled, so this is the common path.
  const [renderedSrc, setRenderedSrc] = useState(src);
  if (src !== renderedSrc) {
    setRenderedSrc(src);
    setLoaded(false);
    setFailed(false);
    setLetterbox(false);
  }

  const imgRef = useRef<HTMLImageElement>(null);
  const { ref: viewportRef, visible } = useInViewport<HTMLDivElement>();

  // Two gates, and they answer different questions. `visible` asks "does anyone
  // want this?", which is what bounds the TOTAL. `granted` asks "may it start
  // now?", which is what bounds the BURST. A deferred tile needs both.
  const [granted, setGranted] = useState(false);
  const releaseRef = useRef<(() => void) | null>(null);
  const acquiredRef = useRef(false);

  useEffect(() => {
    if (!defer || !visible || !src || acquiredRef.current) return;
    acquiredRef.current = true;
    const release = acquireCoverSlot(() => setGranted(true));
    releaseRef.current = release;
    return () => {
      release();
      releaseRef.current = null;
      acquiredRef.current = false;
    };
    // `granted` is deliberately NOT a dependency. Including it would re-run this
    // on the very state change the grant causes, and the cleanup would hand the
    // slot back before the image had loaded — the gate releasing itself
    // instantly and bounding nothing.
  }, [defer, visible, src]);

  /** Give the slot back so the next tile can start. Safe to call more than once. */
  const releaseSlot = useCallback(() => {
    releaseRef.current?.();
    releaseRef.current = null;
  }, []);

  // The tint still paints immediately — a deferred tile is a coloured tile, not
  // an empty one, so the grid reads as loading rather than as broken while it
  // waits. That is the same distinction 6.1.1 was about.
  const withheld = Boolean(defer) && !(visible && granted);
  const served = coverSources(withheld ? null : src, size);

  useEffect(() => {
    const fromServer = mutedTint(color);
    if (fromServer) {
      setTint(fromServer);
      return;
    }

    setTint(cachedCoverColor(src));
    if (!src) return;
    // A withheld tile must not extract either: extraction reads the rendition
    // the browser is fetching, so running it here would issue exactly the
    // request the defer exists to postpone — the optimisation cancelling itself.
    if (withheld) return;

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
  }, [src, color, served.src, withheld]);

  // Everything that must happen once the pixels are known, from whichever path
  // got us there. It has to be callable without an event, because on the cached
  // path there is no event to be called from.
  const settle = useCallback(
    (img: HTMLImageElement) => {
      if (img.naturalWidth && img.naturalHeight) {
        const ratio = img.naturalWidth / img.naturalHeight;
        if (ratio > 1.3 || ratio < 0.77) setLetterbox(true);
      }
      setLoaded(true);
      releaseSlot();
    },
    [releaseSlot]
  );

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

  const image = src && !withheld && (
    <img
      ref={imgRef}
      src={served.src}
      srcSet={served.srcSet}
      alt={onClick ? "" : alt}
      className={loaded ? undefined : "img-loading"}
      style={letterbox ? { objectFit: "contain" } : undefined}
      onLoad={handleLoad}
      onError={() => {
        setFailed(true);
        releaseSlot();
      }}
      loading="lazy"
    />
  );

  const background = tint ? { background: tint } : undefined;

  /**
   * A tile is exactly one of three things, and before 6.3c all three painted
   * the same flat --ink-2 box:
   *
   *   ABSENT   no artwork to show — no src, or the one attempt we get failed.
   *   LOADING  artwork is on its way. Measured cold on Bob Dylan's grid, one
   *            un-seeded tile takes 2.2-5.8s to fetch, resize and encode, and
   *            there are 138 of them on the Albums tab alone. A flat box for
   *            six seconds is indistinguishable from a broken page.
   *   LOADED   the artwork.
   *
   * `absent` wins over `loading` so a failed tile settles on the deliberate
   * mark instead of shimmering forever at something that is never coming.
   *
   * The gate for LOADING is `visible`, not `withheld`, and the difference is
   * the whole bug. `withheld` is true for two unrelated reasons — the tile is
   * off screen, OR it is on screen and waiting its turn in `coverLoadQueue`
   * (which bounds the BURST, not the total). Keying the shimmer off `withheld`
   * therefore withheld it from tiles a person is looking at right now.
   *
   * Measured on Bob Dylan's Albums tab after this shipped: scrolling settled at
   * 13-16 of 18 VISIBLE tiles painting a bare --ink-2 box with no shimmer at
   * all — the queue was saturated, so nothing had been granted a slot yet, and
   * the state that was supposed to fix blank tiles skipped precisely the tiles
   * that were blank.
   *
   * So: on screen and pixels not here yet ⇒ shimmer, whether it is fetching or
   * queued, because the difference is ours and not the viewer's. Off screen and
   * deferred ⇒ still inert, which is what keeps `defer` from animating hundreds
   * of tiles nobody is looking at.
   */
  const absent = !src || failed;
  const loading = !absent && (!defer || visible) && (pending || !loaded);
  const state = `${loading ? " cover-pending" : ""}${absent ? " cover-absent" : ""}`;

  // A clickable cover is a control, so it is rendered as a real <button>. It
  // used to be a <div onClick>, which meant the release page's zoom-to-full-size
  // affordance existed only for a mouse — no tab stop, no Enter, no Space, and
  // nothing announced. The alt text moves to the button's label so a screen
  // reader hears one thing, not the image name followed by the button name.
  if (onClick) {
    return (
      <button
        type="button"
        ref={viewportRef as unknown as React.RefObject<HTMLButtonElement>}
        className={`cover cover-button${zoomable ? " cover-zoom" : ""}${state}`}
        onClick={onClick}
        style={background}
        aria-label={`${alt} — view full size`}
      >
        {image}
        {absent && <AbsentMark />}
      </button>
    );
  }

  return (
    <div ref={viewportRef} className={`cover${zoomable ? " cover-zoom" : ""}${state}`} style={background}>
      {image}
      {absent && <AbsentMark />}
    </div>
  );
}
