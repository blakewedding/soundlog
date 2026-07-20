import { ratingToStars } from "@soundlog/shared";

interface Props {
  value: number;
  count?: number;
}

/** Gold mono-font star display — the platform's signature mark. */
export function StarRating({ value, count }: Props) {
  return (
    <span className="stars" aria-label={`Rated ${value} out of 5`}>
      {ratingToStars(value)}
      {count !== undefined && <span className="count">({count.toLocaleString()})</span>}
    </span>
  );
}
