import type { MetadataSource, SourceName } from "./types.js";
import { musicbrainzSource } from "./musicbrainzSource.js";
import { discogsSource } from "./discogsSource.js";
import { spotifySource } from "./spotifySource.js";

// Priority order: MusicBrainz (canonical) → Discogs → Spotify (supplemental).
// dedupeMerge treats earlier candidates as authoritative, so MB anchors groups.
const ALL_SOURCES: MetadataSource[] = [musicbrainzSource, discogsSource, spotifySource];

/** The sources whose config/credentials are present, in priority order. */
export function getConfiguredSources(): MetadataSource[] {
  return ALL_SOURCES.filter((source) => source.isConfigured());
}

export function getSource(name: SourceName): MetadataSource | undefined {
  return ALL_SOURCES.find((source) => source.name === name);
}
