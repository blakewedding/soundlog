// Pure mappers from each source's type vocabulary onto our ReleaseType enum.
// MusicBrainz release-group primary/secondary types are the canonical signal;
// Discogs formats cover video, and Spotify distinguishes a one-track SONG.
import type { ReleaseType } from "@prisma/client";

/**
 * MusicBrainz release-group primary type + secondary types → ReleaseType.
 * Secondary types take precedence (a "DJ-mix" album is a DJ_MIX, not an ALBUM).
 */
export function mapReleaseGroupType(
  primaryType?: string | null,
  secondaryTypes: string[] = []
): ReleaseType {
  const secondary = secondaryTypes.map((s) => s.toLowerCase());
  if (secondary.includes("dj-mix")) return "DJ_MIX";
  if (secondary.includes("mixtape/street")) return "MIXTAPE";
  if (secondary.includes("compilation")) return "COMPILATION";

  switch ((primaryType ?? "").toLowerCase()) {
    case "single":
      return "SINGLE";
    case "ep":
      return "EP";
    case "album":
      return "ALBUM";
    default:
      return "ALBUM";
  }
}

/**
 * Discogs format names + descriptions → ReleaseType. This is where video
 * releases enter the catalog (MusicBrainz release-groups don't distinguish them).
 */
export function mapDiscogsFormats(formats: string[] = [], descriptions: string[] = []): ReleaseType {
  const f = formats.map((s) => s.toLowerCase());
  const d = descriptions.map((s) => s.toLowerCase());

  if (d.includes("music video") || d.includes("music videos")) return "MUSIC_VIDEO";
  if (f.some((x) => ["dvd", "blu-ray", "vhs", "video"].includes(x))) return "VIDEO";
  // Discogs marks DJ mixes as "DJ Mix" or (on CDs) just "Mixed".
  if (d.includes("dj mix") || f.includes("dj mix") || d.includes("mixed") || f.includes("mixed"))
    return "DJ_MIX";
  if (d.includes("mixtape")) return "MIXTAPE";
  if (d.includes("compilation")) return "COMPILATION";
  if (d.includes("ep")) return "EP";
  if (d.includes("single") || d.includes("maxi-single")) return "SINGLE";
  return "ALBUM";
}

/** Spotify album_type (+ track count) → ReleaseType. A one-track single is a SONG. */
export function mapSpotifyType(albumType?: string, totalTracks?: number): ReleaseType {
  switch ((albumType ?? "").toLowerCase()) {
    case "single":
      return totalTracks === 1 ? "SONG" : "SINGLE";
    case "compilation":
      return "COMPILATION";
    default:
      return "ALBUM";
  }
}
