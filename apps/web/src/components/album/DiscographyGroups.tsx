import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { DiscographyEntry, DiscographyGroup } from "@soundlog/shared";
import { RELEASE_TYPE_LABELS } from "@soundlog/shared";
import { CoverImage } from "../ui/CoverImage";
import { StarRating } from "../ui/StarRating";
import { usePrefetchRelease } from "../../hooks/usePrefetchRelease";
import { COVER_SIZES, proxiedUpstream } from "../../lib/coverVariant";

/**
 * Cover art for a release-group we haven't seeded. The Cover Art Archive serves
 * a redirect straight off the release-group MBID, so no backend metadata call and
 * no bulk seeding is needed — the browser fetches it lazily (CoverImage sets
 * loading="lazy"), and a group with no art 404s and keeps the placeholder tile.
 *
 * The BYTES now come through our proxy rather than from coverartarchive.org
 * directly. This was the last browser-direct third-party image request in the
 * app (§7's deliberate exception), and it paid the full CAA cost — two redirects
 * into an Internet Archive node — on an uncacheable hostname, for a grid of
 * thumbnails. `front-500` because the 2x rendition needs pixels to work with.
 */
const caaThumb = (mbid: string) =>
  proxiedUpstream(
    `https://coverartarchive.org/release-group/${encodeURIComponent(mbid)}/front-500`,
    COVER_SIZES.grid[0]
  );

/**
 * One discography entry. Seeded releases link to their real page and show the
 * community rating; un-seeded ones link by MusicBrainz ref, which materializes
 * the release on arrival via seed-on-first-access (skeleton first, enrichment
 * behind it — Phase 5.7). Nothing is seeded merely by rendering this list.
 */
function EntryCard({ entry, artwork }: { entry: DiscographyEntry; artwork: boolean }) {
  const prefetch = usePrefetchRelease();
  const ref = entry.seeded && entry.releaseId ? entry.releaseId : `mb:${entry.mbid}`;
  const to = `/release/${encodeURIComponent(ref)}`;

  // A seeded release's cover is a LOOKUP for a row we hold — cheap, retried,
  // and never part of the storm. Only the speculative discovery thumbnail for an
  // un-seeded group is rationed (§7 draws exactly this line).
  const src = entry.seeded ? entry.coverUrl : artwork ? caaThumb(entry.mbid) : null;

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
          src={src}
          color={entry.coverColor}
          alt={`${entry.title} cover`}
          // A discography is the longest grid in the app and the one the 6.2d
          // storm came from. Native lazy is on but too generous here.
          defer
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

/**
 * How many speculative discovery thumbnails one artist page may ever request.
 *
 * A HARD CAP across the whole page, not per group, and that is the point: it is
 * what bounds the total no matter how far someone scrolls or how many groups
 * they expand. The observer bounds the *burst*; pagination bounds what is in the
 * DOM; only this bounds the sum.
 *
 * Measured motivation (6.2d): a Cure + Zappa session produced **1,647** cover
 * requests, 778 abandoned unsent, with client queueing at a p50 of 15.6s and
 * server TTFB at 17.4s — and the profile page visited afterwards had its own
 * tiles stuck behind that queue.
 *
 * A cap rather than zero, ruled deliberately: dropping discovery art entirely
 * would leave a mostly-placeholder discography, which guts browsing. 48 is
 * budgeted in RENDER ORDER, so the groups people actually look at — Albums
 * first — get real artwork, and the 400-entry Singles tail gets placeholders.
 * If a storm rerun shows 48 still too many, zero is one constant away.
 */
const DISCOVERY_COVER_BUDGET = 48;

/**
 * Entries rendered per group before "Show all".
 *
 * Bounds the DOM as well as the network. Before this, opening Bowie mounted
 * every group in full, so a scroll walked the entire catalogue and the observer
 * would dutifully load each tile as it passed. Most visits want the albums, not
 * all 400 singles.
 */
const PAGE_SIZE = 24;

export function DiscographyGroups({ groups }: { groups: DiscographyGroup[] }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  /**
   * Which entries are shown, and which of those may request artwork.
   *
   * Derived in ONE pass from props plus expansion state, rather than by
   * decrementing a shared counter as each group renders. That earlier shape had
   * a real bug — caught by the test below rather than in review: expanding a
   * group re-renders only that group, so the counter was already exhausted and
   * every tile in it lost its artwork, including tiles that had been showing it
   * a moment earlier. Mutating during render is also unsafe under StrictMode's
   * double invocation.
   *
   * Expansion state therefore lives HERE, not in each group: the budget spans
   * groups, so the thing that changes it has to be visible to the thing that
   * computes it.
   */
  const plan = useMemo(() => {
    let left = DISCOVERY_COVER_BUDGET;
    return groups.map((group) => {
      const isOpen = expanded.has(group.key);
      const shown = isOpen ? group.entries : group.entries.slice(0, PAGE_SIZE);
      const artwork = shown.map((e) => {
        // A seeded release's cover is a lookup for a row we hold — never
        // speculative, so never rationed.
        if (e.seeded) return true;
        if (left <= 0) return false;
        left -= 1;
        return true;
      });
      return { group, shown, artwork, hidden: group.entries.length - shown.length };
    });
  }, [groups, expanded]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {plan.map(({ group, shown, artwork, hidden }) => (
        // A real heading, not a styled div: screen-reader users navigate a long
        // discography by jumping between headings, and a div is not in that
        // list. h3: these groups sit UNDER the page's "Discography" h2, so the
        // outline reads h1 artist → h2 Discography → h3 Albums/Singles/…
        <section key={group.key} aria-labelledby={`discog-${group.key}`}>
          <h3 id={`discog-${group.key}`} className="section-label">
            {group.label} ({group.entries.length})
          </h3>
          <ul className="release-grid" style={{ listStyle: "none" }}>
            {shown.map((e, i) => (
              <li key={e.mbid}>
                <EntryCard entry={e} artwork={artwork[i]} />
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 12 }}
              onClick={() => setExpanded((prev) => new Set(prev).add(group.key))}
            >
              Show all {group.entries.length} {group.label.toLowerCase()}
            </button>
          )}
        </section>
      ))}
    </div>
  );
}
