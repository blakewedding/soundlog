import { Link } from "react-router-dom";
import type { DiscographyEntry, DiscographyGroup } from "@soundlog/shared";
import { RELEASE_TYPE_LABELS } from "@soundlog/shared";
import { CoverImage } from "../ui/CoverImage";
import { StarRating } from "../ui/StarRating";
import { usePrefetchRelease } from "../../hooks/usePrefetchRelease";

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
  const prefetch = usePrefetchRelease();
  const ref = entry.seeded && entry.releaseId ? entry.releaseId : `mb:${entry.mbid}`;
  const to = `/release/${encodeURIComponent(ref)}`;

  return (
    <div className={entry.seeded ? undefined : "discog-unseeded"}>
      {/* Only seeded entries prefetch. An un-seeded entry's "mb:" ref
          materializes the release on GET, so hovering a discography must not
          bulk-seed an artist's back catalogue. */}
      <Link
        to={to}
        className="card-link"
        onMouseEnter={() => prefetch(ref)}
        onFocus={() => prefetch(ref)}
      >
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
        // A real heading, not a styled div: screen-reader users navigate a long
        // discography by jumping between headings, and a div is not in that
        // list. aria-labelledby names the section so the group is announced on
        // entry as well. The .section-label class keeps the visual treatment.
        // h3: these groups sit UNDER the page's "Discography" h2, so the
        // outline reads h1 artist → h2 Discography → h3 Albums/Singles/…
        // rather than three peers of the section that contains them.
        <section key={group.key} aria-labelledby={`discog-${group.key}`}>
          <h3 id={`discog-${group.key}`} className="section-label">
            {group.label} ({group.entries.length})
          </h3>
          <ul className="release-grid" style={{ listStyle: "none" }}>
            {group.entries.map((e) => (
              <li key={e.mbid}>
                <EntryCard entry={e} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
