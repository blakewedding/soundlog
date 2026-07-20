import { Router } from "express";
import { HttpError } from "../middleware/errorHandler.js";
import {
  getGenreChart,
  getYearChart,
  getActiveGenres,
  slugToTag,
} from "../services/chartService.js";

export const chartsRouter = Router();

// GET /api/charts/genres — the most-represented genres in the catalog.
chartsRouter.get("/genres", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 12, 40);
    const genres = await getActiveGenres(limit);
    res.json({ genres });
  } catch (err) {
    next(err);
  }
});

// GET /api/charts/genre/:tag — releases tagged with :tag (a slug like
// "detroit-techno"), ranked by weighted rating. ?minRatings= gates thin data.
chartsRouter.get("/genre/:tag", async (req, res, next) => {
  try {
    const tag = slugToTag(req.params.tag);
    if (!tag) throw new HttpError(400, "Missing genre");
    const minRatings = Number(req.query.minRatings ?? 0) || 0;
    const releases = await getGenreChart(tag, { minRatings });
    res.json({ tag, releases });
  } catch (err) {
    next(err);
  }
});

// GET /api/charts/year/:year — releases from :year, ranked by weighted rating.
chartsRouter.get("/year/:year", async (req, res, next) => {
  try {
    const year = Number(req.params.year);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      throw new HttpError(400, "Invalid year");
    }
    const minRatings = Number(req.query.minRatings ?? 0) || 0;
    const releases = await getYearChart(year, { minRatings });
    res.json({ year, releases });
  } catch (err) {
    next(err);
  }
});
