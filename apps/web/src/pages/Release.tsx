import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RELEASE_TYPE_LABELS } from "@soundlog/shared";
import type { FeedReview } from "@soundlog/shared";
import { api, type ReviewDTO } from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { StarRating } from "../components/ui/StarRating";
import { StarRatingInput } from "../components/ui/StarRatingInput";
import { CoverImage } from "../components/ui/CoverImage";
import { Lightbox } from "../components/ui/Lightbox";
import { ReviewForm } from "../components/review/ReviewForm";
import { ReviewCard } from "../components/review/ReviewCard";

export default function Release() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [logged, setLogged] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["release", id, user?.id],
    queryFn: () => api.getRelease(id),
    enabled: id.length > 0,
    retry: 1,
  });

  const releaseId = data?.release.id;
  const { data: reviewsData } = useQuery({
    queryKey: ["reviews", releaseId],
    queryFn: () => api.reviewsFor(releaseId!),
    enabled: !!releaseId,
  });

  if (isLoading) return <ReleaseSkeleton />;
  if (isError || !data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="meta">We couldn't load that release.</p>
        <Link to="/search">← Back to search</Link>
      </div>
    );
  }

  const release = data.release;
  const reviews = reviewsData?.reviews ?? [];
  const myReview = user ? reviews.find((r) => r.user.id === user.id) ?? null : null;
  const year = release.releaseDate?.slice(0, 4);
  const largeCover = release.coverUrlLarge ?? release.coverUrl;

  const refreshRelease = () => queryClient.invalidateQueries({ queryKey: ["release", id, user?.id] });
  const refreshReviews = () => queryClient.invalidateQueries({ queryKey: ["reviews", releaseId] });
  // The diary shows my rating per entry, so a rating change must refresh it too.
  const refreshDiary = () => queryClient.invalidateQueries({ queryKey: ["diary"] });

  async function rate(value: number) {
    await api.rate(release.id, value);
    refreshRelease();
    refreshDiary();
  }
  async function unrate() {
    await api.unrate(release.id);
    refreshRelease();
    refreshDiary();
  }
  async function logListen() {
    await api.logListen(release.id);
    setLogged(true);
    setTimeout(() => setLogged(false), 2500);
    refreshDiary(); // make the new entry appear in the diary immediately
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 32, alignItems: "start" }}>
        <div style={{ width: 240, display: "flex", flexDirection: "column", gap: 12 }}>
          <CoverImage
            src={release.coverUrl}
            alt={`${release.title} cover`}
            zoomable={Boolean(largeCover)}
            onClick={() => largeCover && setLightboxOpen(true)}
          />
          {user && (
            <>
              <button className="btn btn-primary" onClick={logListen}>
                {logged ? "Logged ✓" : "Log listen"}
              </button>
              <AddToList releaseId={release.id} />
            </>
          )}
        </div>
        {lightboxOpen && largeCover && (
          <Lightbox src={largeCover} alt={`${release.title} cover`} onClose={() => setLightboxOpen(false)} />
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>{release.title}</h1>
            {release.artist ? (
              <Link to={`/artist/${release.artist.id}`} className="artist-link" style={{ fontSize: 18 }}>
                {release.artistName}
              </Link>
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: 18 }}>{release.artistName}</p>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span className="type-badge">{RELEASE_TYPE_LABELS[release.type]}</span>
            {year && (
              <Link to={`/year/${year}`} className="artist-link meta">
                {year}
              </Link>
            )}
            {release.trackCount ? <span className="meta">{release.trackCount} tracks</span> : null}
            {release.label && (
              <Link to={`/label/${release.label.id}`} className="artist-link meta">
                {release.label.name}
              </Link>
            )}
          </div>

          {release.avgRating !== undefined ? (
            <StarRating value={release.avgRating} count={release.ratingCount} />
          ) : (
            <p className="meta">No ratings yet — be the first to log this.</p>
          )}

          {user && (
            <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: 12 }}>
              <span className="meta">Your rating</span>
              <StarRatingInput value={release.myRating ?? null} onChange={rate} onClear={unrate} />
            </div>
          )}

          {release.genres.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {release.genres.map((g) => (
                <Link key={g} to={`/genre/${encodeURIComponent(g.replace(/\s+/g, "-"))}`} className="type-badge">
                  {g}
                </Link>
              ))}
            </div>
          )}

          {release.similarArtists && release.similarArtists.length > 0 && (
            <div>
              <div className="section-label">Similar artists</div>
              <p className="meta">{release.similarArtists.join(" · ")}</p>
            </div>
          )}
        </div>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="section-label">Reviews ({reviews.length})</div>

        {user && !myReview && (
          <ReviewForm
            releaseId={release.id}
            onSaved={() => {
              refreshReviews();
              refreshRelease();
            }}
          />
        )}
        {!user && <p className="meta"><Link to="/login">Log in</Link> to rate, log, and review.</p>}

        {reviews.map((review) => (
          // Map the release-scoped ReviewDTO onto the shared FeedReview so the
          // same interactive ReviewCard renders here as in the feed/profiles.
          <ReviewCard
            key={review.id}
            review={
              {
                ...review,
                release: {
                  id: release.id,
                  title: release.title,
                  artistName: release.artistName,
                  coverUrl: release.coverUrl,
                },
              } satisfies FeedReview
            }
          />
        ))}
      </section>
    </div>
  );
}


function AddToList({ releaseId }: { releaseId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ["lists"], queryFn: () => api.lists(), enabled: !!user });
  const mine = (data?.lists ?? []).filter((l) => l.user?.id === user?.id);

  if (mine.length === 0) return null;

  async function add(listId: string) {
    if (!listId) return;
    try {
      await api.addListItem(listId, { releaseId });
      setStatus("Added ✓");
      // Reflect the new item on the list index (itemCount) and the list page.
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      queryClient.invalidateQueries({ queryKey: ["list", listId] });
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Couldn't add");
    }
    setTimeout(() => setStatus(null), 2500);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <select defaultValue="" onChange={(e) => add(e.target.value)} style={{ background: "var(--ink-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 4, padding: "8px 10px", fontSize: 13 }}>
        <option value="" disabled>
          Add to list…
        </option>
        {mine.map((l) => (
          <option key={l.id} value={l.id}>
            {l.title}
          </option>
        ))}
      </select>
      {status && <span className="meta">{status}</span>}
    </div>
  );
}

/** Mirrors the loaded layout so seed-on-first-access reads as loading, not breakage. */
function ReleaseSkeleton() {
  return (
    <div
      style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 32, alignItems: "start" }}
      aria-busy="true"
      aria-label="Loading release"
    >
      <div className="skeleton" style={{ width: 240, aspectRatio: "1" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="skeleton" style={{ height: 36, width: "60%" }} />
        <div className="skeleton" style={{ height: 20, width: "35%" }} />
        <div className="skeleton" style={{ height: 16, width: "45%" }} />
        <div className="skeleton" style={{ height: 16, width: "50%" }} />
      </div>
    </div>
  );
}
