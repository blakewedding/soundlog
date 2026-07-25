/**
 * The dominant colour of a cover, sampled server-side.
 *
 * The web app has extracted this in the browser since 5.5 and it works, with one
 * honest limitation recorded in `apps/web/src/lib/coverColor.ts`: extraction
 * needs the artwork, so the FIRST view of a cover has no tint and the tile is
 * flat `--ink-2` for exactly the wait the tint exists to dress. Sampling here
 * moves the colour into the release payload, so the first paint of a
 * never-before-seen cover is already tinted — which is the whole point of the
 * placeholder.
 *
 * ## What is stored, and what is not
 *
 * This returns the RAW sampled colour as `#rrggbb`. The muting — hue kept,
 * saturation capped, lightness compressed into a narrow band around `--ink-2` —
 * stays in the web client, so the palette decision has exactly one home and
 * cannot drift between what the server baked in and what the CSS expects.
 *
 * That warning is not theoretical: the first version of the mute normalised
 * chroma and produced twelve near-identical greys from twelve different sleeves,
 * because normalising chroma discards the lightness that distinguishes covers.
 * A server that stored *muted* colours would have frozen that class of mistake
 * into the database.
 *
 * ## Why the algorithm is duplicated rather than shared
 *
 * The sampling loop below is deliberately the same arithmetic as
 * `sample()` in `apps/web/src/lib/coverColor.ts` — average an 8x8 downscale,
 * skipping near-transparent and near-black pixels so letterboxed art averages
 * toward its subject and not its padding. It cannot be imported: `@soundlog/shared`
 * is not a backend dependency (CLAUDE.md, Commands). Keep the two in step; a
 * change to one is a change to both.
 */
import sharp from "sharp";
import { ensureVariant } from "./coverCache.js";
import { COVER_THUMB_WIDTH, decodeProxiedCoverPath, isProxyableCoverHost } from "./coverProxy.js";

/** Downscale target. 64 pixels is plenty for an average and costs nothing. */
const SIZE = 8;
/** Below this alpha a pixel is padding, not artwork. */
const MIN_ALPHA = 128;
/** Summed-channel floor: effectively black is usually letterboxing. */
const MIN_LUMA_SUM = 24;

/**
 * Sample the dominant colour for an upstream (or already-proxied) cover URL.
 *
 * Resolves to `#rrggbb`, or null when there is nothing to sample — no artwork
 * upstream, an all-transparent image, or a host we do not proxy. **Throws** only
 * what `ensureVariant` throws, i.e. a retryable upstream failure, so callers can
 * distinguish "this cover has no colour" from "ask again later". Every current
 * caller is fault-isolated and simply leaves the column null.
 *
 * As a side effect this warms the w400 rendition on disk, so the visitor who
 * triggers a seed also gets a cache hit for the cover they are about to load.
 */
export async function sampleCoverTint(coverUrl: string): Promise<string | null> {
  const upstreamUrl = decodeProxiedCoverPath(coverUrl)?.upstreamUrl ?? coverUrl;
  if (!isProxyableCoverHost(upstreamUrl)) return null;

  const variant = await ensureVariant(upstreamUrl, COVER_THUMB_WIDTH);
  if (!variant) return null;

  try {
    const { data } = await sharp(variant.file)
      .resize(SIZE, SIZE, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return averageHex(data);
  } catch (err) {
    // Supplemental by definition — a tint that can't be computed is a flat tile,
    // never a failed request.
    console.warn(`[covers] tint sampling failed for ${upstreamUrl}: ${(err as Error).message}`);
    return null;
  }
}

/** Average RGBA pixels to `#rrggbb`, skipping padding. Exported for tests. */
export function averageHex(data: Buffer | Uint8Array): string | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;

  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < MIN_ALPHA) continue;
    if (data[i] + data[i + 1] + data[i + 2] < MIN_LUMA_SUM) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n += 1;
  }
  if (n === 0) return null;

  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
