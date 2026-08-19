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
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

// Phase 6.1.5 — the load-event race.
//
// These MUST drive the CACHED path, which is the entire point: the bug is
// invisible to any test whose image loads after mount, and jsdom fires no load
// events on its own, so a naive test passes against the broken component.
//
// jsdom never fetches, so `complete`/`naturalWidth` are stubbed on the
// prototype to describe an image the browser already had — the state caught
// live on production: { complete: true, naturalWidth: 250, opacity: "0" }.
//
// They assert the CLASS, not a computed opacity: the rule lives in theme.css,
// which jsdom does not apply, so `opacity` would read "" whether the component
// works or not. Pinning the mark rather than the value is the same discipline
// as 5.5's `data-fill` assertion.
function alreadyDecoded(width = 250, height = 250) {
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(height);
}

describe("CoverImage — an image that decoded before React attached onLoad", () => {
  it("is visible on mount, having never received a load event", () => {
    alreadyDecoded();
    render(<CoverImage src={PROXIED} alt="Untrue cover" />);

    // No fireEvent.load anywhere in this test — that is the condition being
    // reproduced. Before 6.1.5 this element kept .img-loading forever.
    expect(screen.getByAltText("Untrue cover").className).not.toContain("img-loading");
  });

  it("letterboxes a non-square cached cover, which the missed event also lost", () => {
    // The ratio check lived only in the load handler, so a cached gatefold scan
    // was center-cropped into a smear as well as being invisible.
    alreadyDecoded(1000, 500);
    render(<CoverImage src={PROXIED} alt="Gatefold cover" />);

    expect(screen.getByAltText("Gatefold cover").style.objectFit).toBe("contain");
  });

  it("does not reveal a broken image: complete is true for a failed load too", () => {
    // `complete` alone would unhide the browser's broken-image glyph at full
    // opacity. naturalWidth is the predicate that means "pixels exist".
    alreadyDecoded(0, 0);
    render(<CoverImage src={PROXIED} alt="Missing cover" />);

    expect(screen.getByAltText("Missing cover").className).toContain("img-loading");
  });
});

describe("CoverImage — the cold path still fades in", () => {
  it("stays hidden until the image actually loads, then reveals it", () => {
    // Default jsdom: complete === false. The component must NOT short-circuit.
    render(<CoverImage src={PROXIED} alt="Untrue cover" />);
    const img = screen.getByAltText("Untrue cover");
    expect(img.className).toContain("img-loading");

    fireEvent.load(img);
    expect(img.className).not.toContain("img-loading");
  });
});

// 6.3c — a tile is exactly one of three things, and it must LOOK like which.
//
// Reported as "Bob Dylan's canonical albums render blank". They were not blank
// and they were not poisoned: the grid was mid-load, and a loading tile, a
// release with no artwork, and a tile whose one discovery attempt (§7) failed
// all painted the identical flat --ink-2 box. A policy about how hard we try
// upstream was rendering as a broken page.
describe("CoverImage — loading, absent, and failed are visually distinct", () => {
  function tile(el: HTMLElement) {
    return el.querySelector(".cover") as HTMLElement;
  }

  it("shimmers while real artwork is still loading", () => {
    const { container } = render(<CoverImage src={PROXIED} alt="Nashville Skyline cover" />);
    const el = tile(container);
    expect(el.className).toContain("cover-pending");
    expect(el.className).not.toContain("cover-absent");
    expect(el.querySelector(".cover-absent-mark")).toBeNull();
  });

  it("stops shimmering once the artwork arrives", () => {
    const { container } = render(<CoverImage src={PROXIED} alt="Nashville Skyline cover" />);
    const img = container.querySelector("img") as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: 400, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 400, configurable: true });
    fireEvent.load(img);
    expect(tile(container).className).not.toContain("cover-pending");
    expect(tile(container).className).not.toContain("cover-absent");
  });

  it("shows the deliberate mark for a release with no artwork at all", () => {
    const { container } = render(<CoverImage src={null} alt="Dylan cover" />);
    const el = tile(container);
    expect(el.className).toContain("cover-absent");
    expect(el.className).not.toContain("cover-pending");
    expect(el.querySelector(".cover-absent-mark")).not.toBeNull();
  });

  it("shows the SAME mark when the one discovery attempt fails — never a bare box", () => {
    const { container } = render(<CoverImage src={PROXIED} alt="The Basement Tapes cover" />);
    const img = container.querySelector("img") as HTMLImageElement;
    fireEvent.error(img);
    const el = tile(container);
    expect(el.className).toContain("cover-absent");
    // and it must SETTLE: a shimmer promises something that is never coming.
    expect(el.className).not.toContain("cover-pending");
    expect(el.querySelector(".cover-absent-mark")).not.toBeNull();
  });

  it("does not announce the mark — the tile's alt text already names the release", () => {
    const { container } = render(<CoverImage src={null} alt="Pat Garrett cover" />);
    expect(container.querySelector(".cover-absent-mark")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("re-arms for the next release when a grid tile is recycled", () => {
    const { container, rerender } = render(
      <CoverImage src={PROXIED} alt="first cover" />
    );
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(tile(container).className).toContain("cover-absent");

    // Same mounted tile, different artwork: the previous failure must not stick.
    rerender(<CoverImage src={`${PROXIED}?v=2`} alt="second cover" />);
    const el = tile(container);
    expect(el.className).not.toContain("cover-absent");
    expect(el.className).toContain("cover-pending");
  });
});

// The bug the first cut of the three-state fix shipped with, found on
// production and pinned here.
//
// `withheld` is true for two unrelated reasons: the tile is off screen, OR it
// is on screen and waiting its turn in coverLoadQueue (which bounds the burst,
// not the total). Gating the shimmer on `withheld` skipped the second group —
// so on Bob Dylan's Albums tab, scrolling settled at 13-16 of 18 VISIBLE tiles
// showing a bare --ink-2 box. The state meant to fix blank tiles missed exactly
// the tiles that were blank.
describe("CoverImage — a visible tile waiting for a queue slot", () => {
  it("shimmers while queued, not only once the queue grants it a slot", async () => {
    // Saturate the queue so nothing this tile asks for can be granted.
    const { __resetCoverQueue, acquireCoverSlot } = await import("../../lib/coverLoadQueue");
    __resetCoverQueue();
    const held: Array<() => void> = [];
    for (let i = 0; i < 64; i++) held.push(acquireCoverSlot(() => {}));

    // `defer` puts the tile on the queue; jsdom reports no intersection, so
    // this also covers "visible but never granted".
    const { container } = render(
      <CoverImage src={PROXIED} alt="Blood on the Tracks cover" defer />
    );
    const el = container.querySelector(".cover") as HTMLElement;

    // Whatever it is, it must never be an unstyled box: a viewer cannot tell
    // "queued behind 63 other tiles" from "this site is broken".
    const styled =
      el.classList.contains("cover-pending") || el.classList.contains("cover-absent");
    expect(styled, "a visible tile rendered as a bare --ink-2 box").toBe(true);

    held.forEach((release) => release());
    __resetCoverQueue();
  });
});
