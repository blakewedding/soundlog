import { Link } from "react-router-dom";
import type { ChartEntry } from "@soundlog/shared";
import { RELEASE_TYPE_LABELS } from "@soundlog/shared";
import { CoverImage } from "../ui/CoverImage";
import { StarRating } from "../ui/StarRating";

/** A ranked release chart: numbered rows with cover, links, and rating. */
export function ChartList({ entries }: { entries: ChartEntry[] }) {
  return (
    <ol className="chart-list">
      {entries.map((e, i) => (
        <li key={e.id} className="chart-row">
          <span className="chart-rank">{i + 1}</span>
          <Link to={`/release/${encodeURIComponent(e.id)}`} className="chart-cover">
            <CoverImage src={e.coverUrl} alt={`${e.title} cover`} />
          </Link>
          <div className="chart-meta">
            <Link to={`/release/${encodeURIComponent(e.id)}`} className="card-link">
              <strong style={{ fontSize: 15 }}>{e.title}</strong>
            </Link>
            {e.artistId ? (
              <Link to={`/artist/${e.artistId}`} className="artist-link meta">
                {e.artistName}
              </Link>
            ) : (
              <span className="meta">{e.artistName}</span>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="type-badge">{RELEASE_TYPE_LABELS[e.type]}</span>
              {e.year && <span className="meta">{e.year}</span>}
            </div>
          </div>
          <div className="chart-rating">
            {e.avgRating != null ? (
              <StarRating value={e.avgRating} count={e.ratingCount} />
            ) : (
              <span className="meta">Not yet rated</span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
