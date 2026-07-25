import { Router } from "express";
import { HttpError } from "../middleware/errorHandler.js";
import { getLabelWithReleases } from "../services/catalogService.js";

export const labelsRouter = Router();

// GET /api/labels/:id — label header + releases on the label.
labelsRouter.get("/:id", async (req, res, next) => {
  try {
    const found = await getLabelWithReleases(req.params.id);
    if (!found) throw new HttpError(404, "Label not found");
    const { label, releases } = found;
    res.json({
      label: {
        id: label.id,
        name: label.name,
        area: label.area,
        founded: label.founded,
        musicbrainzId: label.musicbrainzId,
      },
      releases: releases.map((r) => ({
        id: r.id,
        title: r.title,
        artistName: r.artistName,
        year: r.releaseDate?.toISOString().slice(0, 4) ?? null,
        type: r.type,
        coverUrl: r.coverUrl,
        coverColor: r.coverColor,
        genres: r.genres,
      })),
    });
  } catch (err) {
    next(err);
  }
});
