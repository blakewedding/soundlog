// Cover image selection — the 6.3 defect.
//
// Ranking Discogs images purely on squareness picks vinyl LABEL scans, because
// a record label is a circle cropped to a perfect square and therefore scores
// better than any real sleeve. Tom Waits' *Small Change* shipped the Asylum
// Records "SIDE ONE" label as its cover art on every surface in the app.
//
// The fix must not simply invert to "always trust primary": the squareness rule
// was added because `primary` is sometimes a full unfolded sleeve spread that
// crops to a smear in a square tile. Both shapes are pinned here.
import { describe, it, expect } from "vitest";
import { pickCoverImage, pickSquarestImage } from "../../src/services/discogsService.js";

describe("pickCoverImage", () => {
  it("keeps the declared front over a perfectly square label scan", () => {
    // The real shape of Discogs release 725926 (Small Change, Asylum, vinyl LP).
    const images = [
      { uri: "front.jpg", type: "primary", width: 550, height: 545 },
      { uri: "back.jpg", type: "secondary", width: 600, height: 597 },
      { uri: "label-a.jpg", type: "secondary", width: 600, height: 600 },
      { uri: "label-b.jpg", type: "secondary", width: 600, height: 600 },
    ];
    // Squareness alone picks a label — this is the bug, pinned so it stays fixed.
    expect(pickSquarestImage(images)?.uri).toBe("label-a.jpg");
    expect(pickCoverImage(images)?.uri).toBe("front.jpg");
  });

  it("still avoids a primary that is measurably a sleeve spread", () => {
    // The case squareness was introduced for: a 600×368 J-card spread.
    const images = [
      { uri: "spread.jpg", type: "primary", width: 600, height: 368 },
      { uri: "square.jpg", type: "secondary", width: 600, height: 590 },
    ];
    expect(pickCoverImage(images)?.uri).toBe("square.jpg");
  });

  it("trusts an unmeasurable primary rather than a measurable label scan", () => {
    // Unknown dimensions cannot disprove the declaration, and falling through
    // would hand the tile to the one image we CAN measure — the square label.
    const images = [
      { uri: "front.jpg", type: "primary" },
      { uri: "label.jpg", type: "secondary", width: 600, height: 600 },
    ];
    expect(pickCoverImage(images)?.uri).toBe("front.jpg");
  });

  it("falls back to squarest when nothing is declared primary", () => {
    const images = [
      { uri: "spread.jpg", type: "secondary", width: 600, height: 368 },
      { uri: "square.jpg", type: "secondary", width: 600, height: 590 },
    ];
    expect(pickCoverImage(images)?.uri).toBe("square.jpg");
  });

  it("returns null for no images", () => {
    expect(pickCoverImage([])).toBeNull();
    expect(pickCoverImage(undefined)).toBeNull();
  });
});
