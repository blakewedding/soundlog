import { Link } from "react-router-dom";
import type { FeedItem } from "@soundlog/shared";
import { ReviewCard } from "../review/ReviewCard";
import { StarRating } from "../ui/StarRating";
import { CoverImage } from "../ui/CoverImage";

/**
 * Renders a stream of activity. Each entry is drawn with the SAME components
 * used elsewhere — REVIEW items are literal ReviewCards, ratings use StarRating,
 * releases use CoverImage — so there is no second review/rating presentation to
 * keep in sync.
 */
/**
 * Rows past this index all share the last delay. Uncapped, a 20-item page would
 * leave the final row waiting 0.8s after the data already arrived — a stagger
 * that reads as slowness rather than polish.
 */
const MAX_STAGGERED_ROWS = 6;
const STAGGER_STEP_MS = 40;

export function FeedList({ items }: { items: FeedItem[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {items.map((item, i) => (
        <div
          key={item.id}
          className="feed-item"
          style={{ animationDelay: `${Math.min(i, MAX_STAGGERED_ROWS) * STAGGER_STEP_MS}ms` }}
        >
          <FeedRow item={item} />
        </div>
      ))}
    </div>
  );
}

function actor(item: FeedItem) {
  const name = item.user.displayName ?? item.user.username;
  return (
    <Link to={`/${item.user.username}`} className="review-user">
      {name}
    </Link>
  );
}

function when(item: FeedItem) {
  return <span className="meta">{new Date(item.createdAt).toLocaleDateString()}</span>;
}

function FeedRow({ item }: { item: FeedItem }) {
  // Reviews render as the full card (it already shows actor + release + rating).
  if (item.type === "REVIEW" && item.review) {
    return <ReviewCard review={item.review} />;
  }

  if ((item.type === "LOG" || item.type === "RATING") && item.release) {
    const verb = item.type === "LOG" ? "logged a listen to" : "rated";
    return (
      <ActivityCard item={item}>
        <div style={{ width: 44, flexShrink: 0 }}>
          <CoverImage
            src={item.release.coverUrl}
            color={item.release.coverColor}
            size="row"
            alt={`${item.release.title} cover`}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <div>
            {actor(item)} <span className="meta">{verb}</span>{" "}
            <Link to={`/release/${item.release.id}`} className="artist-link">
              {item.release.title}
            </Link>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="meta">{item.release.artistName}</span>
            {item.type === "RATING" && item.rating != null && <StarRating value={item.rating} />}
            {when(item)}
          </div>
        </div>
      </ActivityCard>
    );
  }

  if ((item.type === "LIST_CREATE" || item.type === "LIST_ITEM_ADD") && item.list) {
    const verb = item.type === "LIST_CREATE" ? "created the list" : "added to";
    return (
      <ActivityCard item={item}>
        <div>
          <div>
            {actor(item)} <span className="meta">{verb}</span>{" "}
            <Link to={`/list/${item.list.id}`} className="artist-link">
              {item.list.title}
            </Link>
          </div>
          <div>
            <span className="meta">{item.list.itemCount ?? 0} releases</span> {when(item)}
          </div>
        </div>
      </ActivityCard>
    );
  }

  if (item.type === "COMMENT" && item.comment) {
    return (
      <ActivityCard item={item}>
        <div style={{ minWidth: 0 }}>
          <div>
            {actor(item)} <span className="meta">commented on a review</span>
          </div>
          <p className="review-body" style={{ fontSize: 14 }}>
            “{item.comment.content}”
          </p>
          {when(item)}
        </div>
      </ActivityCard>
    );
  }

  if (item.type === "FOLLOW" && item.targetUser) {
    return (
      <ActivityCard item={item}>
        <div>
          <div>
            {actor(item)} <span className="meta">followed</span>{" "}
            <Link to={`/${item.targetUser.username}`} className="review-user">
              {item.targetUser.displayName ?? item.targetUser.username}
            </Link>
          </div>
          {when(item)}
        </div>
      </ActivityCard>
    );
  }

  return null;
}

function ActivityCard({ item, children }: { item: FeedItem; children: React.ReactNode }) {
  return (
    <div className="card" style={{ display: "flex", gap: 12, alignItems: "center", padding: 12 }}>
      {children}
      <span aria-hidden style={{ display: "none" }}>
        {item.type}
      </span>
    </div>
  );
}
