// Dominant-colour placeholders for album art.
//
// A cover tile is a 1:1 hole in the layout until its image arrives. Filling it
// with flat --ink-2 reads as "nothing here yet"; filling it with a muted tint
// of the artwork reads as "this is loading, and it looks like this". Same
// perceived-performance trick as the blur-up placeholder, without shipping a
// second image.
//
// Three constraints shaped this:
//
// 1. Colours are MUTED into the palette, never used raw. A saturated cover
//    average would put arbitrary colour on the page, which is precisely what
//    "Gold on Vinyl" spends its restraint avoiding. Every extracted colour is
//    normalised for chroma then blended most of the way back to --ink-2, so it
//    reads as tinted ink.
//
// 2. Extraction is FAULT-ISOLATED and never touches the visible <img>. It runs
//    against a separate crossOrigin image; if that fails — CORS, 404, a dropped
//    socket — the tile keeps its flat placeholder and the real cover still
//    loads normally. Setting crossOrigin on the visible <img> instead would be
//    one non-CORS host away from invisible artwork everywhere.
//
// 3. Results are cached in localStorage, including *negative* results, so a
//    cover that can't be sampled is attempted once rather than on every render.
//
// The limitation this had until 6.1: the first view of a cover had nothing
// cached, so the placeholder paid off only on repeat views — precisely the view
// where the wait is longest was the view with no tint. The backend now samples
// the dominant colour when it seeds a release and serves it as
// `release.coverColor`, so the FIRST paint is tinted too (see
// `backend/src/services/coverTint.ts`). Everything below is still the path for
// rows seeded before that, and for any cover the server could not sample.
//
// `mutedTint` is the join between the two: the server stores a RAW `#rrggbb`
// and the muting stays here, so the palette decision has one home. That matters
// specifically because of the mistake documented in muteIntoPalette — a server
// that had stored *muted* colours would have frozen the twelve-identical-greys
// version of it into the database.

const STORAGE_KEY = "soundlog:cover-colors";
const MAX_ENTRIES = 400;
/** Marks "we tried and couldn't", so we don't re-attempt every mount. */
const NO_COLOR = "-";

type ColorMap = Record<string, string>;

let memory: ColorMap | null = null;
const inFlight = new Map<string, Promise<string | null>>();

function load(): ColorMap {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    memory = raw ? (JSON.parse(raw) as ColorMap) : {};
  } catch {
    memory = {}; // private mode, quota, or corrupt JSON — degrade to in-memory
  }
  return memory;
}

function persist(map: ColorMap): void {
  try {
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      // Cheap FIFO trim: drop the oldest inserted keys.
      const trimmed: ColorMap = {};
      for (const k of keys.slice(keys.length - MAX_ENTRIES)) trimmed[k] = map[k];
      memory = trimmed;
      map = trimmed;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage full or unavailable — the in-memory map still serves this session.
  }
}

/** Synchronous lookup: what we already know, for the very first paint. */
export function cachedCoverColor(src: string | null | undefined): string | null {
  if (!src) return null;
  const hit = load()[src];
  return hit && hit !== NO_COLOR ? hit : null;
}

function remember(src: string, value: string | null): void {
  const map = load();
  map[src] = value ?? NO_COLOR;
  persist(map);
}

/**
 * Map a sampled colour into the ink palette, in HSL.
 *
 * Hue is kept, saturation is boosted a little then capped, and lightness is
 * compressed into a narrow dark band straddling --ink-2 (L≈0.12). The result is
 * a tile that is recognisably *this* record's colour while still reading as
 * part of a warm-black page.
 *
 * The first version normalised chroma instead — scaling each sample so its
 * brightest channel hit 255 before blending. That looked reasonable in the
 * abstract and was wrong in practice: because the blend was a fixed ratio, every
 * cover came out with a max channel of exactly 96. Twelve different sleeves
 * produced twelve near-identical grey tiles, each far lighter than the surface
 * it was replacing. Normalising chroma throws away the lightness signal, which
 * is most of what distinguishes one cover from another.
 */
function muteIntoPalette(r: number, g: number, b: number): string {
  const [h, s, l] = rgbToHsl(r, g, b);

  const SAT_BOOST = 1.3;
  const SAT_CAP = 0.45;
  /**
   * Lightness band, widened in 6.1.1 from 0.10–0.24 to 0.10–0.34.
   *
   * The old band compressed every cover into 14 points of lightness, which meant
   * a pale sleeve could not read as pale: Wilco's *Sky Blue Sky* samples #d2d2d2
   * — starlings against a white sky — and came out rgb(55,55,55), against an
   * empty --ink-2 tile of rgb(28,28,33). On a phone those are the same dark
   * grey, and the tile was reported as looking broken.
   *
   * Widening is the opposite of the mistake documented above, not a repeat of
   * it: that failure came from normalising CHROMA, which threw the lightness
   * signal away. This restores lightness while leaving the saturation cap and
   * the hue untouched, so the restraint the palette is protecting is intact —
   * what changes is that a white record now looks like one.
   *
   * Measured over the 154-cover catalog: 153/154 distinct tints (was 152/154),
   * luminance spread 33–138 (was 27–76). Sky Blue Sky moves from 26 points above
   * the empty tile to 68; pure black does not move at all.
   */
  const L_FLOOR = 0.1;
  const L_RANGE = 0.34;

  const mutedS = Math.min(s * SAT_BOOST, SAT_CAP);
  const mutedL = L_FLOOR + l * L_RANGE;

  const [nr, ng, nb] = hslToRgb(h, mutedS, mutedL);
  return `rgb(${nr}, ${ng}, ${nb})`;
}

/**
 * Mute a server-sampled `#rrggbb` into the palette — the same transform the
 * browser-side extraction applies, so a tile looks identical whether its colour
 * arrived in the payload or was sampled from the artwork.
 *
 * Returns null for anything that isn't a six-digit hex colour, which keeps a bad
 * or truncated value in the database from putting arbitrary CSS on the page.
 */
export function mutedTint(hex: string | null | undefined): string | null {
  if (typeof hex !== "string") return null;
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return muteIntoPalette((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
}

/** @returns [h 0–1, s 0–1, l 0–1] */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l]; // achromatic

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;

  return [h / 6, s, l];
}

/** @returns [r, g, b] as 0–255 integers */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const channel = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  return [
    Math.round(channel(h + 1 / 3) * 255),
    Math.round(channel(h) * 255),
    Math.round(channel(h - 1 / 3) * 255),
  ];
}

/**
 * Average the artwork down to one colour.
 *
 * Drawing into an 8x8 canvas lets the GPU do the downscaling, so this is a
 * handful of pixel reads rather than a full-resolution scan. Near-transparent
 * and near-black pixels are skipped: letterboxed art (cassette J-cards, gatefold
 * scans) would otherwise average toward its background rather than its subject.
 */
function sample(img: HTMLImageElement): string | null {
  const SIZE = 8;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, SIZE, SIZE);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, SIZE, SIZE).data;
  } catch {
    return null; // tainted canvas — the host didn't actually allow the read
  }

  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 128) continue;
    const lum = data[i] + data[i + 1] + data[i + 2];
    if (lum < 24) continue; // effectively black — usually padding, not artwork
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  if (n === 0) return null;

  return muteIntoPalette(r / n, g / n, b / n);
}

/**
 * Extract and cache the placeholder colour for a cover. Resolves to null when
 * the artwork can't be sampled — callers treat that as "keep the flat tile",
 * never as an error worth surfacing.
 */
export function extractCoverColor(src: string): Promise<string | null> {
  const known = load()[src];
  if (known) return Promise.resolve(known === NO_COLOR ? null : known);

  const existing = inFlight.get(src);
  if (existing) return existing;

  const job = new Promise<string | null>((resolve) => {
    const img = new Image();
    // Required for getImageData. The Cover Art Archive and its archive.org
    // redirect targets both send Access-Control-Allow-Origin: *.
    img.crossOrigin = "anonymous";
    img.decoding = "async";

    img.onload = () => {
      let color: string | null = null;
      try {
        color = sample(img);
      } catch {
        color = null;
      }
      remember(src, color);
      resolve(color);
    };
    img.onerror = () => {
      remember(src, null);
      resolve(null);
    };

    img.src = src;
  }).finally(() => inFlight.delete(src));

  inFlight.set(src, job);
  return job;
}

/** Test seam — resets both caches. */
export function __resetCoverColorCache(): void {
  memory = null;
  inFlight.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}
