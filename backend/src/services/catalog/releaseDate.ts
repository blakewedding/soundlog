// Pure release-date helpers. The catalog stores the ORIGINAL release date of a
// work — the earliest date reported at the release-group / master level — never
// an individual pressing's year (which is often a reissue).

/** Parse a partial source date ("1992", "1992-06", "1992-06-29") to a Date. */
export function parseReleaseDate(value?: string | null): Date | null {
  if (!value) return null;
  const iso = value.length === 4 ? `${value}-01-01` : value.length === 7 ? `${value}-01` : value;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Of several candidate dates (from different sources, mixed precision), return
 * the raw string of the earliest — the original release. Ignores empties and
 * unparseable values.
 */
export function earliestReleaseDate(values: Array<string | null | undefined>): string | null {
  let best: { raw: string; t: number } | null = null;
  for (const value of values) {
    const date = parseReleaseDate(value);
    if (!date || !value) continue;
    const t = date.getTime();
    if (!best || t < best.t) best = { raw: value, t };
  }
  return best?.raw ?? null;
}
