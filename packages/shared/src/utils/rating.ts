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
