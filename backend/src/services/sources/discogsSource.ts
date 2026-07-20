import type { MetadataSource, SourceCandidate, ReleaseDetail } from "./types.js";
import {
  searchDiscogs,
  getDiscogsRelease,
  discogsConfigured,
  pickSquarestImage,
  type DiscogsSearchResult,
  type DiscogsRelease,
} from "../discogsService.js";
import { mapDiscogsFormats } from "../catalog/typeMapping.js";

// Discogs search titles are "Artist - Title".
function parseArtistTitle(combined: string): { artistName: string; title: string } {
  const idx = combined.indexOf(" - ");
  if (idx === -1) return { artistName: "Unknown Artist", title: combined.trim() };
  return { artistName: combined.slice(0, idx).trim(), title: combined.slice(idx + 3).trim() };
}

function searchResultToCandidate(r: DiscogsSearchResult): SourceCandidate {
  const { artistName, title } = parseArtistTitle(r.title);
  return {
    source: "discogs",
    // Namespace-qualified: masters and releases share numbers but are
    // different records, so the type must travel with the id everywhere.
    discogsId: `${r.type}:${r.id}`,
    title,
    artistName,
    year: r.year,
    type: mapDiscogsFormats(r.format ?? []),
    coverUrl: r.cover_image || r.thumb || undefined,
  };
}

function primaryCover(rel: DiscogsRelease): string | undefined {
  // Squarest image ≈ the actual front cover; "primary" is often a full sleeve
  // spread that crops badly in square tiles.
  return pickSquarestImage(rel.images)?.uri ?? undefined;
}

export const discogsSource: MetadataSource = {
  name: "discogs",
  isConfigured: discogsConfigured,

  async search(query) {
    const results = await searchDiscogs(query);
    return results.map(searchResultToCandidate);
  },

  async lookupRelease(id): Promise<ReleaseDetail | null> {
    const rel = await getDiscogsRelease(id);
    if (!rel) return null;
    const formats = rel.formats?.map((f) => f.name) ?? [];
    const descriptions = rel.formats?.flatMap((f) => f.descriptions ?? []) ?? [];
    return {
      source: "discogs",
      // Keep the caller's qualified id — the response's numeric id loses the
      // namespace (master N and release N both echo id: N).
      discogsId: id,
      title: rel.title,
      artistName: rel.artists?.map((a) => a.name).join(", ") || "Unknown Artist",
      year: rel.year ? String(rel.year) : undefined,
      releaseDate: rel.year ? String(rel.year) : undefined,
      type: mapDiscogsFormats(formats, descriptions),
      genres: [...(rel.genres ?? []), ...(rel.styles ?? [])].slice(0, 5).map((g) => g.toLowerCase()),
      coverUrl: primaryCover(rel),
    };
  },

  async getCoverArt(candidate) {
    if (!candidate.discogsId) return null;
    const rel = await getDiscogsRelease(candidate.discogsId);
    return rel ? primaryCover(rel) ?? null : null;
  },
};
