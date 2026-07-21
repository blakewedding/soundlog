#!/usr/bin/env node
/**
 * Generate the PLACEHOLDER Soundlog icon assets from the Groove glyph.
 *
 *   node scripts/generate-icons.mjs
 *
 * These are placeholders. They are geometrically faithful to the glyph's closed
 * cut (see GrooveMark in src/components/ui/Wordmark.tsx) and correct as files —
 * right sizes, right colours, opaque, safe-zone respecting — but they are not
 * finished icon design. What is outstanding is tracked in the README under
 * Phase 7: small-size optical refinement, iOS squircle fitting, and the full
 * platform size ladder.
 *
 * Final artwork replaces the files in public/icons/ in place. Keep the
 * filenames and pixel dimensions and nothing else has to change — index.html
 * and site.webmanifest reference them by fixed name. This script is then
 * obsolete and should be deleted, not re-run.
 *
 * No dependencies on purpose: a native image toolchain is not worth adding for
 * placeholder art. Shapes are analytic (circles and a rounded rect), sampled
 * 4x4 per pixel and box-filtered, then written as RGBA PNG via zlib.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "public", "icons");

/**
 * Geometry comes from the same file the on-screen preview reads
 * (src/components/ui/MarkIcon.tsx), so the two cannot drift. Edit the JSON, not
 * this script.
 */
const geometry = JSON.parse(
  readFileSync(join(HERE, "..", "src", "lib", "iconGeometry.json"), "utf8")
);

const hexToRgb = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

const INK_1 = hexToRgb(geometry.colors.tile);
const GOLD = hexToRgb(geometry.colors.ring);
const TEXT = hexToRgb(geometry.colors.spindle);

const RING_R = geometry.ringRadius;
const RING_W = geometry.ringStroke;
const SPINDLE_R = geometry.spindleRadius;

const SUPERSAMPLE = 4;

// --- PNG encoding ---------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {Uint8Array} rgba row-major RGBA, length w*h*4 */
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 = compression, filter, interlace — all 0.

  // Filter type 0 (None) on every scanline; the shapes are smooth and these
  // files are tiny, so the extra work of adaptive filtering buys nothing.
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1
    );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Rasterising ----------------------------------------------------------

/** Signed-distance test for a rounded rectangle covering the whole tile. */
function insideRoundedRect(x, y, size, radius) {
  if (radius <= 0) return true;
  const dx = Math.max(radius - x, x - (size - radius), 0);
  const dy = Math.max(radius - y, y - (size - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * @param {number} size    edge length in px
 * @param {number} radiusF corner radius as a fraction of the edge (0 = square)
 */
function renderIcon(size, radiusF) {
  const out = new Uint8Array(size * size * 4);
  const radius = radiusF * size;
  const c = size / 2;
  const ringR = RING_R * size;
  const ringHalf = (RING_W * size) / 2;
  const spindleR = SPINDLE_R * size;
  const step = 1 / SUPERSAMPLE;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = px + (sx + 0.5) * step;
          const y = py + (sy + 0.5) * step;

          if (!insideRoundedRect(x, y, size, radius)) continue; // transparent

          const d = Math.hypot(x - c, y - c);
          // Spindle over ring over tile.
          const colour =
            d <= spindleR ? TEXT : Math.abs(d - ringR) <= ringHalf ? GOLD : INK_1;

          r += colour[0];
          g += colour[1];
          b += colour[2];
          a += 255;
        }
      }

      const n = SUPERSAMPLE * SUPERSAMPLE;
      const i = (py * size + px) * 4;
      // Un-premultiply so partially covered edge pixels keep their hue.
      const cov = a / (255 * n);
      out[i] = cov > 0 ? Math.round(r / (n * cov)) : 0;
      out[i + 1] = cov > 0 ? Math.round(g / (n * cov)) : 0;
      out[i + 2] = cov > 0 ? Math.round(b / (n * cov)) : 0;
      out[i + 3] = Math.round(a / n);
    }
  }

  return encodePng(out, size, size);
}

/** The vector favicon — same geometry, resolution independent. */
function renderSvg() {
  const pct = (v) => +(v * 100).toFixed(3);
  const { tile, ring, spindle } = geometry.colors;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Soundlog">
  <!-- PLACEHOLDER asset. Generated by scripts/generate-icons.mjs from
       src/lib/iconGeometry.json. Final artwork replaces this file in place;
       see public/icons/README.md. -->
  <rect width="100" height="100" rx="${pct(geometry.faviconCornerRadius)}" fill="${tile}"/>
  <circle cx="50" cy="50" r="${pct(RING_R)}" fill="none"
          stroke="${ring}" stroke-width="${pct(RING_W)}"/>
  <circle cx="50" cy="50" r="${pct(SPINDLE_R)}" fill="${spindle}"/>
</svg>
`;
}

// --- Output ---------------------------------------------------------------
//
// Square and opaque on purpose. Every platform applies its own mask, so baking
// a squircle in would produce a rounded shape rounded twice. Fitting the true
// iOS superellipse is part of the Phase 7 icon work.

const PNGS = [
  ["favicon-16.png", 16, geometry.faviconCornerRadius],
  ["favicon-32.png", 32, geometry.faviconCornerRadius],
  ["apple-touch-icon.png", 180, 0],
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
];

mkdirSync(OUT_DIR, { recursive: true });

writeFileSync(join(OUT_DIR, "favicon.svg"), renderSvg());
console.log("wrote favicon.svg");

for (const [name, size, radiusF] of PNGS) {
  const png = renderIcon(size, radiusF);
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`wrote ${name} (${size}x${size}, ${png.length} bytes)`);
}
