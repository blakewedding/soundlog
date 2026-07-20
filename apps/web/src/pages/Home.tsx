import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { FeedItem } from "@soundlog/shared";
import { api } from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { ReleaseCard } from "../components/album/ReleaseCard";
import { ReviewCard } from "../components/review/ReviewCard";
import { FeedList } from "../components/feed/FeedList";

export default function Home() {
  const { user } = useAuth();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 48 }}>
      <section>
        <h1 style={{ marginBottom: 8 }}>Log the music that matters.</h1>
        <p style={{ color: "var(--text-muted)", maxWidth: 560 }}>
          Track every listen. Rate on your terms. Write the review the album deserves — from the
          biggest release of the year to the tape only forty people have heard.
        </p>
      </section>

      {user && <FeedSection />}
      <PopularSection />
      <RecentReviewsSection />
    </div>
  );
}

function FeedSection() {
  const [pages, setPages] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  // First page is a query; "load more" appends via cursor.
  const { data, isLoading } = useQuery({
    queryKey: ["feed"],
    queryFn: () => api.feed(),
  });

  const items = pages.length ? pages : data?.items ?? [];
  const nextCursor = cursor !== undefined ? cursor : data?.nextCursor ?? null;

  async function loadMore() {
    const next = await api.feed(nextCursor ?? undefined);
    setPages([...(items ?? []), ...next.items]);
    setCursor(next.nextCursor ?? undefined);
  }

  return (
    <section>
      <div className="section-label">From people you follow</div>
      {isLoading && <p className="meta">Loading your feed…</p>}
      {!isLoading && items.length === 0 && (
        <p className="meta">
          Your feed is quiet — <Link to="/search">find members</Link> to follow, or search for an
          artist and follow other listeners from their reviews.
        </p>
      )}
      {items.length > 0 && (
        <>
          <FeedList items={items} />
          {nextCursor && (
            <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={loadMore}>
              Load more
            </button>
          )}
        </>
      )}
    </section>
  );
}

function PopularSection() {
  const { data, isLoading } = useQuery({
    queryKey: ["recent-releases"],
    queryFn: () => api.recentReleases(12),
    staleTime: 60_000,
  });
  const releases = data?.releases ?? [];

  return (
    <section>
      <div className="section-label">Popular this week</div>
      {isLoading ? (
        <div className="release-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton" style={{ aspectRatio: "1" }} />
          ))}
        </div>
      ) : releases.length > 0 ? (
        <div className="release-grid">
          {releases.map((r) => (
            <ReleaseCard key={r.id} release={r} />
          ))}
        </div>
      ) : (
        <p className="meta">
          Nothing in the catalog yet — <Link to="/search">search</Link> to seed the first release.
        </p>
      )}
    </section>
  );
}

function RecentReviewsSection() {
  const { data, isLoading } = useQuery({
    queryKey: ["recent-reviews"],
    queryFn: () => api.recentReviews(6),
    staleTime: 60_000,
  });
  const reviews = data?.reviews ?? [];

  return (
    <section>
      <div className="section-label">Recent reviews</div>
      {isLoading && <p className="meta">Loading…</p>}
      {!isLoading && reviews.length === 0 && <p className="meta">No reviews yet — be the first.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {reviews.map((r) => (
          <ReviewCard key={r.id} review={r} />
        ))}
      </div>
    </section>
  );
}
