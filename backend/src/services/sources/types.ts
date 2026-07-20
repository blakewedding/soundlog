// The common contract every metadata source implements. catalogService only
// ever talks to sources through this interface, so a source (especially Spotify)
// can be added or removed purely via env config — see registry.ts.
import type { ReleaseType } from "@prisma/client";

export type SourceName = "musicbrainz" | "discogs" | "spotify";

// A lightweight search hit, normalized across sources. Carries whatever
// canonical ids the source knows so the merge step can dedupe.
export interface SourceCandidate {
  source: SourceName;
  musicbrainzId?: string;
  discogsId?: string;
  spotifyId?: string;
  releaseId?: string; // internal Release id, set when already in our catalog
  title: string;
  artistName: string;
  artistId?: string; // source-native artist id
  year?: string;
  type: ReleaseType;
  coverUrl?: string;
}

// A fuller record used to seed a Release row.
export interface ReleaseDetail extends SourceCandidate {
  releaseDate?: string; // "2007", "2007-10", or "2007-10-10"
  genres?: string[];
  trackCount?: number;
  lastfmUrl?: string;
}

export interface MetadataSource {
  readonly name: SourceName;
  /** Whether the credentials/config this source needs are present. */
  isConfigured(): boolean;
  /** Free-text search returning normalized candidates. */
  search(query: string): Promise<SourceCandidate[]>;
  /** Full lookup by this source's native id, for seeding. */
  lookupRelease(id: string): Promise<ReleaseDetail | null>;
  /** Best cover-art URL this source can offer for a candidate, or null. */
  getCoverArt(candidate: SourceCandidate): Promise<string | null>;
}
