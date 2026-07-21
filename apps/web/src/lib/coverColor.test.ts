// Phase 5.5 — dominant-colour placeholders.
//
// The behaviour worth pinning: extraction is supplemental, so every failure
// path resolves to null rather than throwing, and a colour that can't be
// sampled is attempted once rather than on every mount.
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { cachedCoverColor, extractCoverColor, __resetCoverColorCache } from "./coverColor";

const SRC = "https://coverartarchive.org/release/abc/front-500.jpg";

/**
 * Stand-in for HTMLImageElement. jsdom has no decoder, so we drive onload /
 * onerror by hand and stub the canvas read the sampler depends on.
 */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = "";
  decoding = "";
  #src = "";

  set src(value: string) {
    this.#src = value;
    // Defer so callers can attach handlers first, as a real image would.
    setTimeout(() => {
      if (value.includes("broken")) this.onerror?.();
      else this.onload?.();
    }, 0);
  }
  get src() {
    return this.#src;
  }
}

/** Fill the fake canvas with a flat colour so the average is predictable. */
function stubCanvas(pixel: [number, number, number, number] | "throws") {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: () => {},
    getImageData: () => {
      if (pixel === "throws") throw new DOMException("tainted", "SecurityError");
      const data = new Uint8ClampedArray(8 * 8 * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = pixel[0];
        data[i + 1] = pixel[1];
        data[i + 2] = pixel[2];
        data[i + 3] = pixel[3];
      }
      return { data };
    },
  } as unknown as CanvasRenderingContext2D);
}

beforeEach(() => {
  __resetCoverColorCache();
  vi.stubGlobal("Image", FakeImage);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("extractCoverColor", () => {
  it("returns a muted rgb() tint for sampled artwork", async () => {
    stubCanvas([200, 40, 40, 255]);
    const color = await extractCoverColor(SRC);
    expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });

  it("keeps the tint dark enough to belong to the ink palette", async () => {
    // A blazing white sleeve must not become a white tile.
    stubCanvas([255, 255, 255, 255]);
    const color = await extractCoverColor(SRC);
    const [r, g, b] = color!.match(/\d+/g)!.map(Number);
    // Lightness is compressed to at most L_FLOOR + L_RANGE = 0.24.
    expect(Math.max(r, g, b)).toBeLessThan(95);
  });

  it("preserves hue so different sleeves give visibly different tiles", async () => {
    // The bug this replaces: chroma normalisation made every cover come out
    // with the same max channel, so twelve sleeves produced one grey.
    stubCanvas([200, 40, 40, 255]);
    const red = await extractCoverColor("https://example.test/red.jpg");
    stubCanvas([40, 60, 200, 255]);
    const blue = await extractCoverColor("https://example.test/blue.jpg");

    const [rr, , rb] = red!.match(/\d+/g)!.map(Number);
    const [br, , bb] = blue!.match(/\d+/g)!.map(Number);
    expect(rr).toBeGreaterThan(rb); // red sleeve stays red-dominant
    expect(bb).toBeGreaterThan(br); // blue sleeve stays blue-dominant
  });

  it("keeps a dark sleeve darker than a bright one", async () => {
    stubCanvas([20, 20, 24, 255]);
    const dark = await extractCoverColor("https://example.test/dark.jpg");
    stubCanvas([230, 225, 220, 255]);
    const bright = await extractCoverColor("https://example.test/bright.jpg");

    const lum = (c: string) => c.match(/\d+/g)!.map(Number).reduce((a, b) => a + b, 0);
    expect(lum(dark!)).toBeLessThan(lum(bright!));
  });

  it("resolves null when the image fails to load, without throwing", async () => {
    stubCanvas([10, 10, 10, 255]);
    await expect(extractCoverColor("https://example.test/broken.jpg")).resolves.toBeNull();
  });

  it("resolves null when the canvas read is refused by CORS", async () => {
    stubCanvas("throws");
    await expect(extractCoverColor(SRC)).resolves.toBeNull();
  });

  it("resolves null for fully transparent artwork", async () => {
    stubCanvas([120, 120, 120, 0]);
    await expect(extractCoverColor(SRC)).resolves.toBeNull();
  });

  it("caches a success so it is sampled only once", async () => {
    stubCanvas([90, 120, 200, 255]);
    const first = await extractCoverColor(SRC);
    expect(cachedCoverColor(SRC)).toBe(first);

    // A second call must not touch the canvas again.
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    await extractCoverColor(SRC);
    expect(spy).not.toHaveBeenCalled();
  });

  it("caches a failure so a bad cover is not retried on every mount", async () => {
    stubCanvas("throws");
    await extractCoverColor(SRC);

    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    await expect(extractCoverColor(SRC)).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
    // A negative result is cached, but never reported as a colour.
    expect(cachedCoverColor(SRC)).toBeNull();
  });

  it("de-duplicates concurrent extractions of the same cover", async () => {
    stubCanvas([70, 70, 90, 255]);
    const [a, b] = await Promise.all([extractCoverColor(SRC), extractCoverColor(SRC)]);
    expect(a).toBe(b);
  });
});

describe("cachedCoverColor", () => {
  it("is null for an unknown cover and for a missing src", () => {
    expect(cachedCoverColor(SRC)).toBeNull();
    expect(cachedCoverColor(null)).toBeNull();
    expect(cachedCoverColor(undefined)).toBeNull();
  });
});
