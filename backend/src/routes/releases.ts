import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { optionalAuth, type AuthedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import {
  resolveRelease,
  toReleaseDTO,
  getRecentReleases,
  reenrichRelease,
} from "../services/catalogService.js";
import { enrichmentStatus } from "../services/enrichmentState.js";
import { redis } from "../config/redis.js";

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

// POST /api/releases/:id/refresh
//
// Re-run enrichment for a release we already hold. This is what the release
// page's "Try again" actually calls; without it that button only refetched the
// DTO while nothing re-executed, so a stage failure was permanent in practice.
// Movement (New Order) proved it in production: 39 requests, one enrichment run.
//
// Rate-limited per caller per release. One minute, not the discography's hour —
// this is a retry button a person is looking at, and the upstream cost is a
// handful of calls rather than a 250-group browse. Long enough that mashing it
// cannot hammer the shared MusicBrainz throttle; short enough to be usable.
const REENRICH_WINDOW_SECONDS = 60;

releasesRouter.post("/:id/refresh", optionalAuth, async (req: AuthedRequest, res, next) => {
  try {
    const existing = await resolveRelease(req.params.id);
    if (!existing) throw new HttpError(404, "Release not found");

    // Already running — report that instead of burning the caller's slot on a
    // no-op, the same reasoning as the discography refresh.
    if (enrichmentStatus(existing.id) === "pending") {
      return res.json({ status: "pending", note: "Already fetching this release's details." });
    }

    const who = req.userId ?? `ip:${req.ip}`;
    const key = `release:refresh:${who}:${existing.id}`;
    const claimed = await redis.set(key, "1", "EX", REENRICH_WINDOW_SECONDS, "NX");
    if (claimed !== "OK") {
      const ttl = await redis.ttl(key);
      throw new HttpError(429, `Just tried that — give it ${Math.max(1, ttl)} more second(s).`);
    }

    const refreshed = await reenrichRelease(existing.id);
    if (!refreshed) {
      throw new HttpError(
        422,
        "This release has no source id to re-fetch from, so there is nothing to retry."
      );
    }

    res.json({ status: enrichmentStatus(refreshed.id), release: await toReleaseDTO(refreshed, req.userId) });
  } catch (err) {
    next(err);
  }
});
