import { Router } from "express";
import { HttpError } from "../middleware/errorHandler.js";
import { getArtistWithReleases, materializeArtistByMbid } from "../services/catalogService.js";
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { optionalAuth, type AuthedRequest } from "../middleware/auth.js";
import {
  getDiscographyState,
  mergeDiscography,
  isAssembling,
} from "../services/discographyService.js";
import { bustArtistDiscography, discographyCacheKey } from "../services/musicbrainzService.js";
import { peekCached } from "../services/cache.js";

export const artistsRouter = Router();

/**
 * `mb:<mbid>` — an artist from search that we do not hold yet.
 *
 * The artist half of the ref contract release seeding has used since 5.7, added
 * in 6.2d because without it artist search could surface a cold artist and then
 * have nowhere to send them. Every route below resolves the ref FIRST and then
 * works on a cuid exactly as before, so nothing downstream knows refs exist.
 *
 * Both the detail route and the discography route take it, deliberately: the
 * first thing anyone does with a newly-materialized artist is browse their
 * discography, and a ref that opened the page but not the browse would be a
 * dead end one click deeper.
 *
 * Namespaced (§3): a bare id is what seeded *Bodycage* when *Live At The Liquid
 * Room* was clicked.
 */
const MB_REF = /^mb:([0-9a-f-]{36})$/i;

async function resolveArtistRef(ref: string): Promise<string> {
  const m = MB_REF.exec(ref);
  if (!m) return ref;
  const artist = await materializeArtistByMbid(m[1]);
  // Null is MusicBrainz answering definitively that there is no such artist.
  // An unreachable MusicBrainz throws instead and becomes a 503 (§1) — never a
  // 404, which would tell the user the artist does not exist.
  if (!artist) throw new HttpError(404, "Artist not found");
  return artist.id;
}

/** The artist row plus its MusicBrainz id, which the discography browse needs. */
async function artistWithMbid(id: string) {
  const artist = await prisma.artist.findUnique({
    where: { id },
    select: { id: true, name: true, latinName: true, musicbrainzId: true },
  });
  if (!artist) throw new HttpError(404, "Artist not found");
  return artist;
}

// GET /api/artists/:id/discography
// 200 → the complete, grouped discography (cached upstream for 7d).
// 202 → still assembling; body carries progress so the page can show it rather
//       than spinning silently through several throttled MusicBrainz calls.
artistsRouter.get("/:id/discography", optionalAuth, async (req: AuthedRequest, res, next) => {
  try {
    const artist = await artistWithMbid(await resolveArtistRef(req.params.id));
    if (!artist.musicbrainzId) {
      // Without an MBID there is nothing to browse — and we will NOT guess by
      // name (5.8). Report it plainly instead of silently showing nothing.
      return res.json({
        status: "complete",
        unavailable: "This artist has no MusicBrainz id, so no discography can be listed.",
        groups: [],
        counts: { total: 0, seeded: 0 },
      });
    }

    const state = await getDiscographyState(artist.musicbrainzId);
    if (state.status === "assembling") {
      return res.status(202).json({ status: "assembling", progress: state.progress });
    }

    const groups = await mergeDiscography(state.entries, req.userId);
    const all = groups.flatMap((g) => g.entries);
    res.json({
      status: "complete",
      groups,
      counts: { total: all.length, seeded: all.filter((e) => e.seeded).length },
    });
  } catch (err) {
    next(err); // UpstreamUnavailableError → 503 + Retry-After (Phase 5.7)
  }
});

// POST /api/artists/:id/discography/refresh
// Any user may re-pull an artist whose MusicBrainz entry has grown. Rate-limited
// to once per artist per hour per user (anonymous callers fall back to their IP)
// so a refresh button can't be leaned on to hammer the shared 1 req/s throttle.
const REFRESH_WINDOW_SECONDS = 3600;

artistsRouter.post(
  "/:id/discography/refresh",
  optionalAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      const artist = await artistWithMbid(req.params.id);
      if (!artist.musicbrainzId) throw new HttpError(400, "Artist has no MusicBrainz id");

      // Only a refresh that actually DOES something may consume the hourly slot.
      // Two cases where it wouldn't, and where burning the slot would lock the
      // user out of a real refresh for an hour over a no-op:
      //   - an assembly is already running (it writes the cache after any bust,
      //     so the refresh would be silently overwritten), or
      //   - nothing is cached yet, so there is simply nothing to invalidate.
      if (isAssembling(artist.musicbrainzId)) {
        return res.json({
          status: "assembling",
          note: "Already fetching the latest discography.",
        });
      }
      const cachedAlready = await peekCached<unknown[]>(
        discographyCacheKey(artist.musicbrainzId)
      );
      if (!cachedAlready) {
        return res.json({ status: "assembling", note: "Fetching this discography for the first time." });
      }

      const who = req.userId ?? `ip:${req.ip}`;
      const key = `discog:refresh:${who}:${artist.musicbrainzId}`;
      // SET NX EX — atomic claim; a second attempt inside the window is refused.
      const claimed = await redis.set(key, "1", "EX", REFRESH_WINDOW_SECONDS, "NX");
      if (claimed !== "OK") {
        const ttl = await redis.ttl(key);
        throw new HttpError(
          429,
          `Discography was refreshed recently — try again in ${Math.max(1, Math.ceil(ttl / 60))} minute(s).`
        );
      }

      await bustArtistDiscography(artist.musicbrainzId);
      // Re-assembly starts on the next GET, which will report progress again.
      res.json({ status: "refreshing" });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/artists/:id — artist header + their releases in the catalog.
artistsRouter.get("/:id", async (req, res, next) => {
  try {
    const found = await getArtistWithReleases(await resolveArtistRef(req.params.id));
    if (!found) throw new HttpError(404, "Artist not found");
    const { artist, releases } = found;
    res.json({
      artist: {
        id: artist.id,
        name: artist.name,
        latinName: artist.latinName,
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
        coverColor: r.coverColor,
        genres: r.genres,
      })),
    });
  } catch (err) {
    next(err);
  }
});
