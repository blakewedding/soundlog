// Pure candidate merge/dedupe. Kept free of I/O so it is unit-testable.
import type { SourceCandidate } from "../sources/types.js";

/** Fold to lowercase alphanumerics, stripping diacritics and punctuation. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Fuzzy identity key for the title+artist fallback tier. */
export function candidateKey(c: Pick<SourceCandidate, "title" | "artistName">): string {
  return `${normalizeText(c.title)}|${normalizeText(c.artistName)}`;
}

function mergeInto(target: SourceCandidate, src: SourceCandidate): void {
  target.musicbrainzId ??= src.musicbrainzId;
  target.discogsId ??= src.discogsId;
  target.spotifyId ??= src.spotifyId;
  target.releaseId ??= src.releaseId;
  target.artistId ??= src.artistId;
  target.year ??= src.year;
  if (!target.coverUrl && src.coverUrl) target.coverUrl = src.coverUrl;
  // MusicBrainz is canonical for the release type.
  if (src.source === "musicbrainz") target.type = src.type;
}

/**
 * Merge candidates that refer to the same release. Dedupe precedence follows the
 * spec: musicbrainzId, then discogsId, then normalized title+artist (spotifyId is
 * also honored so multiple Spotify hits collapse). Input order is treated as
 * source priority — pass MusicBrainz candidates first so groups anchor on the
 * canonical record.
 */
export function dedupeMerge(candidates: SourceCandidate[]): SourceCandidate[] {
  const groups: SourceCandidate[] = [];
  for (const c of candidates) {
    const match = groups.find(
      (g) =>
        (!!c.musicbrainzId && g.musicbrainzId === c.musicbrainzId) ||
        (!!c.discogsId && g.discogsId === c.discogsId) ||
        (!!c.spotifyId && g.spotifyId === c.spotifyId) ||
        candidateKey(g) === candidateKey(c)
    );
    if (match) mergeInto(match, c);
    else groups.push({ ...c });
  }
  return groups;
}
