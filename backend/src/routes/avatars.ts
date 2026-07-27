/**
 * `GET /avatars/w<width>/<userId>-<hash>.webp` — the only path by which a
 * browser loads a user's picture.
 *
 * Mounted OUTSIDE `/api` for the same reason `/covers` is: this serves image
 * bytes with a year-long `immutable` lifetime, while `/api` is JSON on 60-second
 * edge TTLs. Two behaviours, two prefixes — and the cost of that choice is that
 * every proxy in front of the app needs a rule, or nginx's SPA fallback answers
 * with `index.html`: a 200 that renders as a broken image. See
 * `infrastructure/docker/nginx.conf`, `apps/web/vite.config.ts`, and
 * `infrastructure/varnish/cache-policy.vcl`.
 *
 * ## Why `immutable` is honest here
 *
 * The file name contains a hash of the uploaded bytes, so a given URL can only
 * ever mean one rendition of one image. Changing your picture produces a
 * different URL by construction, which is what makes a one-year lifetime safe
 * rather than a bet that nobody will notice a stale face.
 *
 * ## Two responses, not three
 *
 * `/covers` has three because it talks to an upstream that can be unreachable —
 * a 503 there is §1's "we could not tell". There is no upstream here: the bytes
 * are either on our disk or they are not.
 *
 *  - **200** with the rendition, cacheable for a year.
 *  - **404** when we hold no master for that user and hash. Definitive.
 *
 * A 404 is cached only briefly. Unlike a missing cover — where "no art exists"
 * is a fact about the world that a day-long cache is right about — a missing
 * avatar is usually a race: the row was updated a moment ago and the edge asked
 * for the previous hash. A short life lets that heal on the next request.
 */
import { Router } from "express";
import { ensureAvatarVariant } from "../services/avatarService.js";
import { parseAvatarPath } from "../services/avatarStorage.js";

export const avatarsRouter = Router();

const YEAR_SECONDS = 60 * 60 * 24 * 365;
const MISS_SECONDS = 60;

avatarsRouter.get("/w:width/:file", async (req, res, next) => {
  // Re-derive the canonical path and parse it in one step, so the route and the
  // writer agree on the shape by construction rather than by convention.
  const parsed = parseAvatarPath(`/avatars/w${req.params.width}/${req.params.file}`);
  if (!parsed) {
    // An unknown width, a malformed id, a short hash. A request this app would
    // never have emitted, and — because the id segment is the only
    // caller-controlled input to a filesystem read — the place where a traversal
    // attempt stops. It never reaches the disk.
    return res.status(404).set("Cache-Control", `public, max-age=${MISS_SECONDS}`).end();
  }

  try {
    const file = await ensureAvatarVariant(parsed.userId, parsed.hash, parsed.width);
    if (!file) {
      return res
        .status(404)
        .set("Cache-Control", `public, max-age=${MISS_SECONDS}`)
        .json({ error: "No avatar there." });
    }

    res.set({
      "Cache-Control": `public, max-age=${YEAR_SECONDS}, immutable`,
      // Content-derived and stable: the hash fixes the bytes and the width fixes
      // the render, so this never changes for a URL that exists.
      ETag: `"${parsed.hash}-${parsed.width}"`,
    });

    if (req.headers["if-none-match"] === `"${parsed.hash}-${parsed.width}"`) {
      return res.status(304).end();
    }

    return res.sendFile(file, { etag: false, lastModified: false }, (err) => {
      // A send that fails mid-stream must not fall through to the JSON error
      // handler with headers already on the wire.
      if (err && !res.headersSent) next(err);
    });
  } catch (err) {
    return next(err);
  }
});
