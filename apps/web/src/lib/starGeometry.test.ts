// Regression cover for a half-star drift that shipped and reached a phone.
//
// The component tests stub one rect for the whole star row, so they pinned
// BEHAVIOUR (drag previews, commits on release) and were structurally blind to
// GEOMETRY. Every one of them passed while a quarter of the control mapped to
// the wrong value on a real device.
//
// This layer fixes that by driving the mapping with box geometry measured off a
// real browser at several widths, including the ones where the flex bounds
// engage. Numbers below are captured, not invented.
import { describe, it, expect } from "vitest";
import { stepFromX, type StarBox } from "./starGeometry";

/** Five equal boxes, the normal case. */
const row = (left: number, cellWidth: number): StarBox[] =>
  Array.from({ length: 5 }, (_, i) => ({ left: left + i * cellWidth, width: cellWidth }));

/**
 * Measured in Chrome on the release page and the review form. `cell` is the
 * rendered width of one star; `rowWidth` is what the container rect reported —
 * where the two disagree is where the old ratio-based mapping went wrong.
 */
const MEASURED = {
  // 320px viewport — boxes at their 44px floor; row and stars agree.
  narrowRelease: { boxes: row(29, 45.2), cell: 45.2, rowWidth: 226 },
  narrowReview: { boxes: row(33, 44), cell: 44, rowWidth: 220 },
  // 380px — the width everything was originally verified at. Divides evenly,
  // which is exactly why it hid both defects.
  midRelease: { boxes: row(29, 57.2), cell: 57.2, rowWidth: 286 },
  midReview: { boxes: row(33, 55.6), cell: 55.6, rowWidth: 278 },
  // 430px — boxes pinned at the 64px cap while the row kept growing. The row
  // measured 336 while the stars occupied 320: 16px of dead space.
  wideRelease: { boxes: row(29, 64), cell: 64, rowWidth: 336 },
  wideReview: { boxes: row(33, 64), cell: 64, rowWidth: 328 },
} as const;

/** The old, broken mapping — kept so the regression is demonstrable. */
function legacyRatioMapping(rowLeft: number, rowWidth: number, x: number): number {
  const ratio = Math.min(1, Math.max(0, (x - rowLeft) / rowWidth));
  return Math.min(5, Math.max(0.5, Math.ceil(ratio * 10) / 2));
}

describe("stepFromX — every half-star is reachable, at every measured width", () => {
  for (const [name, g] of Object.entries(MEASURED)) {
    it(`${name}: the centre of each half-zone resolves to its own value`, () => {
      const half = g.cell / 2;
      for (let i = 0; i < 5; i++) {
        const box = g.boxes[i];
        expect(stepFromX(g.boxes, box.left + half / 2)).toBe(i + 0.5);
        expect(stepFromX(g.boxes, box.left + half + half / 2)).toBe(i + 1);
      }
    });

    it(`${name}: boundaries land in the upper zone, matching DOM hit zones`, () => {
      // Rendered zones are [left, right) — the pixel on a boundary belongs to
      // the zone above it. `ceil` used to hand it to the zone below.
      const half = g.cell / 2;
      for (let i = 0; i < 5; i++) {
        const box = g.boxes[i];
        expect(stepFromX(g.boxes, box.left)).toBe(i + 0.5);
        expect(stepFromX(g.boxes, box.left + half)).toBe(i + 1);
        expect(stepFromX(g.boxes, box.left + half - 0.01)).toBe(i + 0.5);
      }
    });

    it(`${name}: a slow sweep is monotonic and hits all ten values in order`, () => {
      const first = g.boxes[0];
      const last = g.boxes[4];
      const seen: number[] = [];
      for (let x = first.left; x < last.left + last.width; x += 0.5) {
        const v = stepFromX(g.boxes, x)!;
        if (seen[seen.length - 1] !== v) seen.push(v);
      }
      expect(seen).toEqual([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
    });

    it(`${name}: every pixel agrees with the box that contains it`, () => {
      const first = g.boxes[0];
      const last = g.boxes[4];
      for (let x = first.left; x < last.left + last.width; x += 1) {
        const idx = Math.min(4, Math.floor((x - first.left) / g.cell));
        const box = g.boxes[idx];
        const expected = x < box.left + box.width / 2 ? idx + 0.5 : idx + 1;
        expect(stepFromX(g.boxes, x)).toBe(expected);
      }
    });
  }
});

describe("the regression this replaces", () => {
  it("the old ratio mapping really did drift at the 64px cap", () => {
    // Guards the fix by proving the old approach fails these same geometries —
    // if someone reverts to row-width math, this documents what breaks.
    const g = MEASURED.wideRelease;
    const rowLeft = g.boxes[0].left;
    let wrong = 0;
    for (let x = rowLeft; x < rowLeft + 320; x += 1) {
      const idx = Math.min(4, Math.floor((x - rowLeft) / g.cell));
      const box = g.boxes[idx];
      const truth = x < box.left + box.width / 2 ? idx + 0.5 : idx + 1;
      if (legacyRatioMapping(rowLeft, g.rowWidth, x) !== truth) wrong++;
    }
    // Measured at ~24% of the control on a real browser.
    expect(wrong).toBeGreaterThan(60);
    expect(stepFromX(g.boxes, rowLeft + 0)).toBe(0.5);
  });

  it("resolves from the boxes, so trailing row space cannot skew it", () => {
    // Same boxes, but pretend the container is far wider. A geometry-driven
    // mapping is unaffected because it never looks at the container.
    const g = MEASURED.wideRelease;
    const atThreeStars = g.boxes[2].left + g.cell / 2; // right half of star 3
    expect(stepFromX(g.boxes, atThreeStars)).toBe(3);
  });
});

describe("edges and degenerate input", () => {
  const boxes = row(29, 57.2);

  it("pins to 0.5 left of the first star and 5 right of the last", () => {
    expect(stepFromX(boxes, -500)).toBe(0.5);
    expect(stepFromX(boxes, 29 - 1)).toBe(0.5);
    expect(stepFromX(boxes, 5000)).toBe(5);
  });

  it("returns null before layout, so jsdom cannot fabricate a rating", () => {
    expect(stepFromX([], 100)).toBeNull();
    expect(stepFromX(row(0, 0), 100)).toBeNull();
    expect(stepFromX(boxes.slice(0, 3), 100)).toBeNull();
  });

  it("handles unequal boxes — the last star ending short does not shift the rest", () => {
    const uneven: StarBox[] = [
      { left: 0, width: 60 },
      { left: 60, width: 60 },
      { left: 120, width: 60 },
      { left: 180, width: 60 },
      { left: 240, width: 40 },
    ];
    expect(stepFromX(uneven, 130)).toBe(2.5);
    expect(stepFromX(uneven, 155)).toBe(3);
    expect(stepFromX(uneven, 250)).toBe(4.5);
    expect(stepFromX(uneven, 270)).toBe(5);
  });

  it("attributes a gap between boxes to the star ahead of it", () => {
    const gapped: StarBox[] = [
      { left: 0, width: 50 },
      { left: 60, width: 50 },
      { left: 120, width: 50 },
      { left: 180, width: 50 },
      { left: 240, width: 50 },
    ];
    expect(stepFromX(gapped, 55)).toBe(1.5); // in the gap before star 2
  });
});
