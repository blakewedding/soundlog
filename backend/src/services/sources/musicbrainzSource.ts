import type { MetadataSource, SourceCandidate, ReleaseDetail } from "./types.js";
import {
  searchReleaseGroups,
  lookupReleaseGroup,
  getCoverArtUrls,
  creditsOf,
  type MBReleaseGroup,
} from "../musicbrainzService.js";
import { mapReleaseGroupType } from "../catalog/typeMapping.js";

function toCandidate(rg: MBReleaseGroup): SourceCandidate {
  const { artistName, artistId } = creditsOf(rg);
  return {
    source: "musicbrainz",
    musicbrainzId: rg.id,
    title: rg.title,
    artistName,
    artistId,
    year: rg["first-release-date"]?.slice(0, 4) || undefined,
    type: mapReleaseGroupType(rg["primary-type"], rg["secondary-types"]),
  };
}

// MusicBrainz needs no credentials (a User-Agent, which has a default, is enough),
// so it is always available — the canonical spine of the catalog.
export const musicbrainzSource: MetadataSource = {
  name: "musicbrainz",
  isConfigured: () => true,

  async search(query) {
    const groups = await searchReleaseGroups(query);
    return groups.map(toCandidate);
  },

  async lookupRelease(mbid): Promise<ReleaseDetail | null> {
    const rg = await lookupReleaseGroup(mbid);
    if (!rg) return null;
    return { ...toCandidate(rg), releaseDate: rg["first-release-date"] };
  },

  async getCoverArt(candidate) {
    if (!candidate.musicbrainzId) return null;
    const urls = await getCoverArtUrls(candidate.musicbrainzId);
    return urls?.thumb ?? null;
  },
};
