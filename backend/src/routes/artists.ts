import { Router } from "express";
import { HttpError } from "../middleware/errorHandler.js";
import { getArtistWithReleases } from "../services/catalogService.js";

export const artistsRouter = Router();

// GET /api/artists/:id — artist header + their releases in the catalog.
artistsRouter.get("/:id", async (req, res, next) => {
  try {
    const found = await getArtistWithReleases(req.params.id);
    if (!found) throw new HttpError(404, "Artist not found");
    const { artist, releases } = found;
    res.json({
      artist: {
        id: artist.id,
        name: artist.name,
        sortName: artist.sortName,
        type: artist.type,
        area: artist.area,
        beginDate: artist.beginDate,
        musicbrainzId: artist.musicbrainzId,
      },
      releases: releases.map((r) => ({
        id: r.id,
        title: r.title,
        artistName: r.artistName,
        year: r.releaseDate?.toISOString().slice(0, 4) ?? null,
        type: r.type,
        coverUrl: r.coverUrl,
        genres: r.genres,
      })),
    });
  } catch (err) {
    next(err);
  }
});
