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
function EntryCard({ entry }: { entry: DiscographyEntry }) {
  const prefetch = usePrefetchRelease();
  const ref = entry.seeded && entry.releaseId ? entry.releaseId : `mb:${entry.mbid}`;
  const to = `/release/${encodeURIComponent(ref)}`;

  // Every entry gets its artwork. The rationing is visibility (the tile asks
  // only when on screen) plus in-flight concurrency (coverLoadQueue) — not a
  // count, which is what left tiles people were looking at permanently blank.
  const src = entry.seeded ? entry.coverUrl : caaThumb(entry.mbid);

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
 * ## Why there is no lifetime budget here any more
 *
 * The first 6.2d attempt rationed discovery covers with a page-wide budget of 48
 * spent in render order. Measured, it killed the storm — 1,647 requests down to
 * 273, and the 778 abandoned-unsent requests down to zero — and failed the
 * product: covers loaded through Albums, EPs and the first row of Singles and
 * then stopped at a clean line, leaving tiles someone was actively looking at
 * (*Just Like Heaven*, art that plainly exists) as permanent placeholders.
 * Parking on them changed nothing, because a spent budget never refills.
 *
 * It was not even a coherent lifetime cap: the allocation recomputed on every
 * render, so as groups expanded the granted SET shifted and one artist made 147
 * requests against a budget of 48.
 *
 * The insight that replaced it: **once visibility gates loading, visibility IS
 * the rationing mechanism.** A tile only requests artwork if somebody scrolled
 * it into view, so the total is bounded by what was actually looked at — which
 * is the bound we wanted, expressed in the only unit that matters. What
 * visibility does not bound is the burst, and that is now
 * `lib/coverLoadQueue.ts`: in-flight concurrency, not lifetime count. Everything
 * visible loads eventually; only a few load at once.
 *
 * So this file keeps exactly one bound of its own — pagination, below — and the
 * other two live where they belong: in the tile that knows whether it is on
 * screen, and in the queue that knows how many are in flight.
 */

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

  const plan = useMemo(
    () =>
      groups.map((group) => {
        const shown = expanded.has(group.key)
          ? group.entries
          : group.entries.slice(0, PAGE_SIZE);
        return { group, shown, hidden: group.entries.length - shown.length };
      }),
    [groups, expanded]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {plan.map(({ group, shown, hidden }) => (
        // A real heading, not a styled div: screen-reader users navigate a long
        // discography by jumping between headings, and a div is not in that
        // list. h3: these groups sit UNDER the page's "Discography" h2, so the
        // outline reads h1 artist → h2 Discography → h3 Albums/Singles/…
        <section key={group.key} aria-labelledby={`discog-${group.key}`}>
          <h3 id={`discog-${group.key}`} className="section-label">
            {group.label} ({group.entries.length})
          </h3>
          <ul className="release-grid" style={{ listStyle: "none" }}>
            {shown.map((e) => (
              <li key={e.mbid}>
                <EntryCard entry={e} />
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
