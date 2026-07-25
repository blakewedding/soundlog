/**
 * `GET /covers/w<width>/<encoded>.webp` — the only path by which a browser now
 * loads album art. See `services/coverProxy.ts` for the URL shape and why the
 * upstream URL is encoded into it, and `services/coverCache.ts` for the fetch
 * and render.
 *
 * Mounted OUTSIDE `/api`, because this is not the JSON API: it serves image
 * bytes with a year-long `immutable` lifetime, while `/api` is JSON with
 * 60-second edge TTLs. Two behaviours, two prefixes. The cost of that choice is
 * that every proxy in front of the app needs a rule (nginx's SPA fallback would
 * otherwise answer with `index.html`, a 200 that renders as a broken image) —
 * see `infrastructure/docker/nginx.conf` and the dev proxy in
 * `apps/web/vite.config.ts`.
 *
 * ## Cache-Control, and why `immutable` is safe here
 *
 * The URL contains the exact upstream URL and the exact width, so a given URL
 * can only ever mean one rendition of one image. Different artwork is a
 * different URL by construction. That is what makes a one-year immutable
 * lifetime honest rather than a bet — and it is what lets Cloudflare's US edge
 * answer for a Helsinki origin.
 *
 * ## The three responses (§1)
 *
 *  - **200** with the rendition, cacheable for a year.
 *  - **404** when upstream definitively has no image — cacheable, but for a day,
 *    not a year: art gets uploaded to the Cover Art Archive later, and a
 *    year-long "no cover" would outlive that by months.
 *  - **503 + Retry-After + `no-store`** when we could not tell. Never cached,
 *    anywhere: this is the failure that must stay retryable, and an edge-cached
 *    503 would turn one bad minute at the archive into a day of blank tiles.
 */
import { Router } from "express";
import { ensureVariant } from "../services/coverCache.js";
import { decodeProxiedCoverPath } from "../services/coverProxy.js";

export const coversRouter = Router();

const YEAR_SECONDS = 60 * 60 * 24 * 365;
const DAY_SECONDS = 60 * 60 * 24;

coversRouter.get("/w:width/:file", async (req, res, next) => {
  // Re-derive the canonical path and decode it in one step, so the route and
  // the writer agree on the shape by construction rather than by convention.
  const decoded = decodeProxiedCoverPath(`/covers/w${req.params.width}/${req.params.file}`);
  if (!decoded) {
    // An unknown width, a corrupt segment, or a host we do not proxy. This is a
    // request this app would never have emitted; it has no upstream to try.
    return res.status(404).set("Cache-Control", `public, max-age=${DAY_SECONDS}`).end();
  }

  try {
    const variant = await ensureVariant(decoded.upstreamUrl, decoded.width);

    if (!variant) {
      return res
        .status(404)
        .set("Cache-Control", `public, max-age=${DAY_SECONDS}`)
        .json({ error: "No cover art for that release." });
    }

    res.set({
      "Cache-Control": `public, max-age=${YEAR_SECONDS}, immutable`,
      ETag: variant.etag,
      "X-Cover-Cache": variant.hit ? "HIT" : "MISS",
    });

    // `send`'s own ETag is derived from size+mtime, and mtime moves when the LRU
    // sweeper touches a file for recency — an entity tag that changes while the
    // bytes do not. Ours is content-derived, so conditional requests are handled
    // here and file-level etag/lastModified are turned off below.
    if (req.headers["if-none-match"] === variant.etag) return res.status(304).end();

    return res.sendFile(variant.file, { etag: false, lastModified: false }, (err) => {
      // A send that fails mid-stream (client went away, file swept between the
      // stat and the read) must not fall through to the JSON error handler with
      // headers already on the wire.
      if (err && !res.headersSent) next(err);
    });
  } catch (err) {
    // UpstreamUnavailableError → 503 + Retry-After via the single error mapper.
    // The header set here is what keeps that 503 out of every cache in the path.
    res.set("Cache-Control", "no-store");
    return next(err);
  }
});
