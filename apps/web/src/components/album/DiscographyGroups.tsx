import { Link } from "react-router-dom";
import type { DiscographyEntry, DiscographyGroup } from "@soundlog/shared";
import { RELEASE_TYPE_LABELS } from "@soundlog/shared";
import { CoverImage } from "../ui/CoverImage";
import { StarRating } from "../ui/StarRating";

/**
 * Cover art for a release-group we haven't seeded. The Cover Art Archive serves
 * a redirect straight off the release-group MBID, so the browser can fetch it
 * lazily (CoverImage sets loading="lazy") with no backend call and no bulk
 * seeding. A group with no art 404s and simply keeps the placeholder tile.
 */
const caaThumb = (mbid: string) =>
  `https://coverartarchive.org/release-group/${encodeURIComponent(mbid)}/front-250`;

/**
 * One discography entry. Seeded releases link to their real page and show the
 * community rating; un-seeded ones link by MusicBrainz ref, which materializes
 * the release on arrival via seed-on-first-access (skeleton first, enrichment
 * behind it — Phase 5.7). Nothing is seeded merely by rendering this list.
 */
function EntryCard({ entry }: { entry: DiscographyEntry }) {
  const to = entry.seeded && entry.releaseId
    ? `/release/${encodeURIComponent(entry.releaseId)}`
    : `/release/${encodeURIComponent(`mb:${entry.mbid}`)}`;

  return (
    <div className={entry.seeded ? undefined : "discog-unseeded"}>
      <Link to={to} className="card-link">
        <CoverImage
          src={entry.seeded ? entry.coverUrl : caaThumb(entry.mbid)}
          alt={`${entry.title} cover`}
        />
        <strong style={{ fontSize: 14, lineHeight: 1.3, display: "block", marginTop: 8 }}>
          {entry.title}
        </strong>
      </Link>
      <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="type-badge">{RELEASE_TYPE_LABELS[entry.type]}</span>
          {entry.year && <span className="meta">{entry.year}</span>}
        </div>
        {entry.seeded && entry.avgRating != null ? (
          <StarRating value={entry.avgRating} count={entry.ratingCount} />
        ) : entry.seeded ? (
          <span className="meta">In your catalog</span>
        ) : (
          <span className="meta discog-hint">Not in catalog yet</span>
        )}
        {entry.myRating != null && (
          <span className="meta">Your rating: {entry.myRating.toFixed(1)}</span>
        )}
      </div>
    </div>
  );
}

export function DiscographyGroups({ groups }: { groups: DiscographyGroup[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {groups.map((group) => (
        <section key={group.key}>
          <div className="section-label">
            {group.label} ({group.entries.length})
          </div>
          <div className="release-grid">
            {group.entries.map((e) => (
              <EntryCard key={e.mbid} entry={e} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
