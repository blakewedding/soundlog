import type { MetadataSource } from "./types.js";
import { searchSpotify, getSpotifyAlbumDetail, spotifyConfigured } from "../spotifyService.js";

// Spotify is supplemental: it only appears in the source list when configured,
// so no catalog code path hard-depends on it.
export const spotifySource: MetadataSource = {
  name: "spotify",
  isConfigured: spotifyConfigured,

  async search(query) {
    return spotifyConfigured() ? searchSpotify(query) : [];
  },

  async lookupRelease(id) {
    return spotifyConfigured() ? getSpotifyAlbumDetail(id) : null;
  },

  async getCoverArt(candidate) {
    return candidate.coverUrl ?? null;
  },
};
