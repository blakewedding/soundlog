import { useEffect, useRef, useState } from "react";

/**
 * How far ahead of the viewport a tile starts loading.
 *
 * Deliberately tight. Native `loading="lazy"` is already on every cover and it
 * is not the problem — the problem is its margin, which browsers set generously
 * (hundreds to thousands of px, scaled by connection speed) on the assumption
 * that a page has tens of images rather than hundreds. In a dense discography
 * grid that fires most of the grid at once: the 6.2d HARs recorded **1,647
 * cover requests from one browsing session**, 778 of which never left the
 * browser before being abandoned.
 *
 * 200px is roughly one row ahead at grid sizes, which is enough that a tile is
 * decoded by the time a normal scroll reaches it, and small enough that
 * scrolling fast does not enqueue the whole catalogue.
 */
const DEFAULT_ROOT_MARGIN = "200px";

/**
 * Whether an element has come within `rootMargin` of the viewport yet.
 *
 * One-way: once true it stays true. A tile that scrolls back out must not drop
 * its `src` — that would evict a decoded image and re-request it on the way
 * back, turning a scroll up and down into twice the traffic this exists to
 * remove.
 *
 * Falls back to "visible immediately" where IntersectionObserver is missing, so
 * the absence of the optimisation can never be the absence of the artwork.
 */
export function useInViewport<T extends Element>(
  rootMargin: string = DEFAULT_ROOT_MARGIN
): { ref: React.RefObject<T>; visible: boolean } {
  // The `useRef<T>(null)` overload, not `useRef<T | null>`: only the former
  // yields a RefObject<T> that React accepts as a `ref` prop.
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // `some` rather than `entries[0]`: an observer can deliver a batch, and
        // a single intersecting entry is enough.
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible, rootMargin]);

  return { ref, visible };
}
