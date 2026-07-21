/** Clamp any input to the platform's 0.5–5.0 half-star scale. */
export function clampRating(value: number): number {
  const snapped = Math.round(value * 2) / 2;
  return Math.min(5, Math.max(0.5, snapped));
}

/** Render a rating as star glyphs, e.g. 3.5 → "★★★½" */
export function ratingToStars(value: number): string {
  const full = Math.floor(value);
  const half = value % 1 >= 0.5;
  return "★".repeat(full) + (half ? "½" : "");
}

/**
 * How an artist name is rendered everywhere in the UI.
 *
 * MusicBrainz stores names in their original script, so a Japanese act reads as
 * "フィッシュマンズ" — unreadable to most of our users, and impossible to type.
 * When we hold a Latin rendering we show "Latin (Original)" so both the
 * recognisable name and the authentic one are present.
 */
export function artistDisplayName(artist: {
  name: string;
  latinName?: string | null;
}): string {
  const latin = artist.latinName?.trim();
  if (!latin || latin === artist.name) return artist.name;
  return `${latin} (${artist.name})`;
}
