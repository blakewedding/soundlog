import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { optionalAuth, type AuthedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { resolveRelease, toReleaseDTO, getRecentReleases } from "../services/catalogService.js";

export const releasesRouter = Router();

// GET /api/releases?limit= — recently added releases (interim "popular" feed
// until Phase 4 activity data exists).
releasesRouter.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 12, 50);
    res.json({ releases: await getRecentReleases(limit) });
  } catch (err) {
    next(err);
  }
});

// POST /api/releases/import  { ref }
// Explicitly seed a release from a search ref ("mb:"/"discogs:"/"spotify:<id>")
// or an internal id. Idempotent — returns the existing row if already seeded.
const importSchema = z.object({ ref: z.string().min(1) });

releasesRouter.post("/import", validate(importSchema), async (req, res, next) => {
  try {
    const release = await resolveRelease(req.body.ref);
    if (!release) throw new HttpError(404, "Could not resolve that release");
    res.status(201).json({ release: await toReleaseDTO(release) });
  } catch (err) {
    next(err);
  }
});

// GET /api/releases/:id
//   :id = internal Release id        → lookup (404 if unknown)
//   :id = "<source>:<sourceId>"      → seed-on-first-access
releasesRouter.get("/:id", optionalAuth, async (req: AuthedRequest, res, next) => {
  try {
    const release = await resolveRelease(req.params.id);
    if (!release) throw new HttpError(404, "Release not found");
    res.json({ release: await toReleaseDTO(release, req.userId) });
  } catch (err) {
    next(err);
  }
});
