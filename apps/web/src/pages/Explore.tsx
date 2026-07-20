import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { ReleaseCard } from "../components/album/ReleaseCard";
import { ReviewCard } from "../components/review/ReviewCard";
import { FollowButton } from "../components/social/FollowButton";

/**
 * The discovery front door — friendly to logged-out visitors. Composes the
 * likes-weighted popular reviews, the active-genres rail, recent additions, and
 * (when signed in) suggested listeners.
 */
export default function Explore() {
  const { user } = useAuth();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 48 }}>
      <section>
        <h1 style={{ marginBottom: 8 }}>Explore</h1>
        <p style={{ color: "var(--text-muted)", maxWidth: 560 }}>
          What listeners are loving right now — the most-liked reviews, the busiest genres, and the
          newest additions to the catalog.
        </p>
      </section>

      <ActiveGenres />
      <PopularReviews />
      {user && <SuggestedListeners username={user.username} />}
      <RecentAdditions />
    </div>
  );
}

function ActiveGenres() {
  const { data } = useQuery({
    queryKey: ["active-genres"],
    queryFn: () => api.activeGenres(14),
    staleTime: 60_000,
  });
  const genres = data?.genres ?? [];
  if (genres.length === 0) return null;
  return (
    <section>
      <div className="section-label">Active genres</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        {genres.map((g) => (
          <Link key={g.slug} to={`/genre/${encodeURIComponent(g.slug)}`} className="type-badge">
            {g.tag} · {g.count}
          </Link>
        ))}
      </div>
    </section>
  );
}

function PopularReviews() {
  const { data, isLoading } = useQuery({
    queryKey: ["popular-reviews"],
    queryFn: () => api.popularReviews(10),
    staleTime: 60_000,
  });
  const reviews = data?.reviews ?? [];
  return (
    <section>
      <div className="section-label">Popular reviews</div>
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

function SuggestedListeners({ username }: { username: string }) {
  const { data } = useQuery({
    queryKey: ["similar-listeners", username],
    queryFn: () => api.similarListeners(username),
  });
  const listeners = data?.listeners ?? [];
  if (listeners.length === 0) return null;
  return (
    <section>
      <div className="section-label">Listeners like you</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        {listeners.map((l) => (
          <div key={l.id} className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: 12 }}>
            <Link to={`/${l.username}`} className="card-link" style={{ flex: 1 }}>
              <strong style={{ fontSize: 14 }}>{l.displayName ?? l.username}</strong>{" "}
              <span className="meta">
                @{l.username} · {l.sharedCount} shared {l.sharedCount === 1 ? "favorite" : "favorites"}
              </span>
            </Link>
            <FollowButton username={l.username} initialFollowing={l.isFollowing} size="sm" />
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentAdditions() {
  const { data, isLoading } = useQuery({
    queryKey: ["recent-releases"],
    queryFn: () => api.recentReleases(12),
    staleTime: 60_000,
  });
  const releases = data?.releases ?? [];
  return (
    <section>
      <div className="section-label">Recently added</div>
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
