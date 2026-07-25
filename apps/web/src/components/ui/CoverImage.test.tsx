// Phase 6.1 — CoverImage after the cover proxy.
//
// The tile now has two possible sources of its placeholder tint, and the rule
// between them is what this pins: a server-sampled colour wins and suppresses
// browser-side extraction entirely. Running both would sample the same artwork
// with two slightly different algorithms and repaint the tile mid-load, which
// reads as a glitch rather than as loading.
//
// The extraction path itself (5.5) still has to work for rows the server never
// sampled — that is the other half of these cases.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { CoverImage } from "./CoverImage";
import { __resetCoverColorCache } from "../../lib/coverColor";

const PROXIED = "/covers/w400/aHR0cHM6Ly9jb3ZlcmFydGFyY2hpdmUub3JnL3JlbGVhc2UvYWJjLzEyMzQ1LTUwMC5qcGc.webp";

/** Records every URL browser-side extraction is asked to sample. */
const sampled: string[] = [];

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = "";
  decoding = "";
  #src = "";
  set src(value: string) {
    this.#src = value;
    sampled.push(value);
    setTimeout(() => this.onload?.(), 0);
  }
  get src() {
    return this.#src;
  }
  naturalWidth = 400;
  naturalHeight = 400;
}

beforeEach(() => {
  sampled.length = 0;
  __resetCoverColorCache();
  vi.stubGlobal("Image", FakeImage as unknown as typeof Image);
  // A canvas read that returns a recognisable colour, so extraction "succeeds".
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray([20, 200, 60, 255]) }),
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CoverImage — rendition selection", () => {
  it("requests the row rendition for a 40px thumbnail, not the stored 400px one", () => {
    render(<CoverImage src={PROXIED} alt="Untrue cover" size="row" />);
    const img = screen.getByAltText("Untrue cover");

    expect(img.getAttribute("src")).toBe(PROXIED.replace("/w400/", "/w96/"));
    expect(img.getAttribute("srcset")).toBe(
      `${PROXIED.replace("/w400/", "/w96/")} 1x, ${PROXIED.replace("/w400/", "/w200/")} 2x`
    );
  });

  it("defaults to the grid tile", () => {
    render(<CoverImage src={PROXIED} alt="Untrue cover" />);
    expect(screen.getByAltText("Untrue cover").getAttribute("src")).toBe(
      PROXIED.replace("/w400/", "/w200/")
    );
  });

  it("leaves an un-healed third-party URL exactly as it is", () => {
    const legacy = "https://coverartarchive.org/release/abc/12345-500.jpg";
    render(<CoverImage src={legacy} alt="Legacy cover" size="row" />);
    const img = screen.getByAltText("Legacy cover");

    expect(img.getAttribute("src")).toBe(legacy);
    expect(img.getAttribute("srcset")).toBeNull();
  });
});

describe("CoverImage — placeholder tint", () => {
  it("paints a server-sampled colour on the first render", () => {
    const { container } = render(
      <CoverImage src={PROXIED} alt="Untrue cover" color="#3a72b0" />
    );
    // Muted into the palette, so it is NOT the raw colour — dark, and in the
    // narrow band around --ink-2. What matters here is that something was
    // painted before any image loaded or any canvas was read.
    const tile = container.querySelector(".cover") as HTMLElement;
    expect(tile.style.background).toMatch(/^rgb\(/);
  });

  it("does not run browser-side extraction when the server supplied a colour", async () => {
    render(<CoverImage src={PROXIED} alt="Untrue cover" color="#3a72b0" />);
    // Give the extraction effect every chance to fire.
    await new Promise((r) => setTimeout(r, 10));
    expect(sampled).toEqual([]);
  });

  it("falls back to extraction for a row the server never sampled", async () => {
    render(<CoverImage src={PROXIED} alt="Untrue cover" />);
    await waitFor(() => expect(sampled.length).toBe(1));
    // It samples the rendition the browser is already fetching — no extra image.
    expect(sampled[0]).toBe(PROXIED.replace("/w400/", "/w200/"));
  });

  it("ignores a malformed stored colour rather than putting it on the page", async () => {
    render(<CoverImage src={PROXIED} alt="Untrue cover" color="not-a-colour" />);
    // Treated as "no colour": extraction runs, as it would for a null.
    await waitFor(() => expect(sampled.length).toBe(1));
  });
});
