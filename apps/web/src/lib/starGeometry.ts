/**
 * Mapping a pointer x coordinate onto a half-star value.
 *
 * Pure and geometry-driven on purpose: it takes the STAR BOXES AS RENDERED and
 * asks which one contains the point, rather than recomputing positions from a
 * container width and a constant. That distinction is the bug this file exists
 * to prevent.
 *
 * What went wrong before. The mapping was
 *
 *     ceil(((x - row.left) / row.width) * 10) / 2
 *
 * which assumes the row rect is exactly the stars and that ten equal zones are
 * evenly spread across it. Once the boxes flexed between a 44px floor and a
 * 64px cap, both assumptions broke:
 *
 *  - **The row is not the stars.** Above ~412px viewport the boxes hit their
 *    64px cap and stop growing, but the row keeps filling its flex line — at
 *    430px the row measured 336px while the stars occupied 320px. Sixteen
 *    pixels of dead space at the end skewed every ratio: 24% of the row mapped
 *    to the wrong half-star.
 *  - **`ceil` puts boundaries in the wrong interval.** DOM hit zones are
 *    half-open, `[left, right)`, so the pixel exactly on a boundary belongs to
 *    the zone above. `ceil` gave it to the zone below — a half-star flip at
 *    every boundary, visible even where the widths did line up.
 *
 * Both were invisible at 380px, where the boxes happen to divide evenly and the
 * row exactly equals the stars. Verifying at one width proved nothing.
 */

/** The part of a DOMRect this needs — so tests can pass measured geometry. */
export interface StarBox {
  left: number;
  width: number;
}

/**
 * The half-star under `x`, or null when the boxes have no layout yet (jsdom, or
 * a first paint before measurement).
 *
 * Resolution is per box: find the star containing the point, then its left half
 * (`n - 0.5`) or right half (`n`). This matches the rendered hit zones exactly,
 * because those zones ARE the left and right halves of these same boxes — so a
 * tap and a drag release on the same pixel can never disagree.
 */
export function stepFromX(
  boxes: StarBox[],
  x: number,
  { clampLeft = true }: { clampLeft?: boolean } = {}
): number | null {
  if (boxes.length !== 5) return null;
  if (boxes.some((b) => b.width <= 0)) return null;

  // Before the first star — for a DRAG, clamp to the lowest rating rather than
  // nothing, so sliding off the left edge pins at 0.5 instead of going dead.
  // A TAP passes clampLeft: false: a discrete press that landed outside the
  // boxes resolved nothing and must say so, not quietly rate half a star.
  if (x < boxes[0].left) return clampLeft ? 0.5 : null;

  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    const right = box.left + box.width;
    const isLast = i === boxes.length - 1;

    if (x < right || isLast) {
      // A gap between boxes (none today, but flex `gap` would create one):
      // attribute it to the star just ahead rather than dropping the event.
      if (x < box.left) return i + 0.5;
      // Half-open, matching the DOM zones: the midpoint pixel is the right half.
      return x < box.left + box.width / 2 ? i + 0.5 : i + 1;
    }
  }

  return 5;
}

/** Read the live boxes off the rendered star cells. */
export function boxesFromElements(elements: (HTMLElement | null)[]): StarBox[] {
  return elements.filter((el): el is HTMLElement => el != null).map((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, width: r.width };
  });
}
