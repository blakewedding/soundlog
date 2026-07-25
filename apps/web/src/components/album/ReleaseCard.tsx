import { Link } from "react-router-dom";
import type { ReleaseListItem } from "@soundlog/shared";
import { RELEASE_TYPE_LABELS } from "@soundlog/shared";
import { CoverImage } from "../ui/CoverImage";
import { ArtistCredit } from "./ArtistCredit";
import { usePrefetchRelease } from "../../hooks/usePrefetchRelease";

/**
 * Grid card for a catalog release. The cover + title are one Link (a single,
 * reliable click target); the artist name is its own Link so it can go to the
 * artist page without nesting anchors.
 */
export function ReleaseCard({ release }: { release: ReleaseListItem }) {
  const prefetch = usePrefetchRelease();
  return (
    <div>
      <Link
        to={`/release/${encodeURIComponent(release.id)}`}
        className="card-link"
        onMouseEnter={() => prefetch(release.id)}
        onFocus={() => prefetch(release.id)}
      >
        <CoverImage src={release.coverUrl} color={release.coverColor} alt={`${release.title} cover`} />
        <strong style={{ fontSize: 14, lineHeight: 1.3, display: "block", marginTop: 8 }}>
          {release.title}
        </strong>
      </Link>
      <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
        <ArtistCredit artistId={release.artist?.id} artistName={release.artistName} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="type-badge">{RELEASE_TYPE_LABELS[release.type]}</span>
          {release.year && <span className="meta">{release.year}</span>}
        </div>
      </div>
    </div>
  );
}
