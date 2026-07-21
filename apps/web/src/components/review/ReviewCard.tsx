import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FeedReview } from "@soundlog/shared";
import { api } from "../../services/api";
import { useAuth } from "../../contexts/AuthContext";
import { StarRating } from "../ui/StarRating";
import { CommentThread } from "./CommentThread";
import { ReviewForm } from "./ReviewForm";
import { patchReviewEverywhere } from "../../lib/reviewCache";

// Queries that render a review, invalidated when a review is edited or deleted
// (structural changes optimistic patching can't fully cover).
const REVIEW_SURFACES = [
  ["feed"],
  ["recent-reviews"],
  ["reviews"],
  ["profile-reviews"],
  ["profile-activity"],
  ["release"],
] as const;

/**
 * The single review presentation across the app — feed, profiles, recent
 * reviews, release page. Fully interactive wherever it mounts: like, comment,
 * and (for the owner) edit/delete. Like/comment state is driven from the query
 * cache and patched across every surface, so counts never disagree.
 */
export function ReviewCard({ review }: { review: FeedReview }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showComments, setShowComments] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);

  const mine = !!user && user.id === review.user.id;

  const likeMutation = useMutation({
    mutationFn: (like: boolean) => (like ? api.likeReview(review.id) : api.unlikeReview(review.id)),
    // Optimistic: flip immediately across all surfaces.
    onMutate: (like) => {
      const prev = { likedByMe: review.likedByMe, likeCount: review.likeCount };
      patchReviewEverywhere(queryClient, review.id, (r) => ({
        likedByMe: like,
        likeCount: r.likeCount + (like ? 1 : -1),
      }));
      return prev;
    },
    onError: (_err, _like, prev) => {
      if (prev) patchReviewEverywhere(queryClient, review.id, prev); // roll back
    },
    onSuccess: (res) =>
      patchReviewEverywhere(queryClient, review.id, {
        likeCount: res.likeCount,
        likedByMe: res.likedByMe,
      }),
  });

  function onLike() {
    if (!user) {
      navigate("/login");
      return;
    }
    if (likeMutation.isPending) return;
    likeMutation.mutate(!review.likedByMe);
  }

  function invalidateSurfaces() {
    for (const key of REVIEW_SURFACES) queryClient.invalidateQueries({ queryKey: key });
  }

  async function destroy() {
    await api.deleteReview(review.id);
    invalidateSurfaces();
  }

  if (editing) {
    return (
      <ReviewForm
        releaseId={review.release.id}
        existing={review}
        onSaved={(updated) => {
          setEditing(false);
          patchReviewEverywhere(queryClient, review.id, {
            content: updated.content,
            rating: updated.rating,
            containsSpoilers: updated.containsSpoilers,
          });
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const hidden = review.containsSpoilers && !revealed && !mine;

  return (
    <article className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div>
          <Link to={`/${review.user.username}`} className="review-user">
            {review.user.displayName ?? review.user.username}
          </Link>
          <span className="meta" style={{ marginLeft: 8 }}>
            on{" "}
            <Link to={`/release/${review.release.id}`} className="artist-link">
              {review.release.title}
            </Link>{" "}
            — {review.release.artistName}
          </span>
        </div>
        {review.rating != null && <StarRating value={review.rating} />}
      </header>

      {hidden ? (
        <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setRevealed(true)}>
          This review contains spoilers — show it
        </button>
      ) : (
        <p className="review-body">{review.content}</p>
      )}

      <footer className="review-actions">
        <button
          onClick={onLike}
          aria-pressed={review.likedByMe}
          aria-label={review.likedByMe ? "Unlike" : "Like"}
          style={review.likedByMe ? { color: "var(--gold)" } : undefined}
        >
          ♥ {review.likeCount}
        </button>
        {/* Without an explicit name this announces as "speech balloon 3" —
            the emoji is decoration, so it is hidden and the button is named. */}
        <button
          onClick={() => setShowComments((s) => !s)}
          aria-expanded={showComments}
          aria-label={
            showComments
              ? "Hide comments"
              : `Show ${review.commentCount} ${review.commentCount === 1 ? "comment" : "comments"}`
          }
        >
          <span aria-hidden>💬</span> {review.commentCount}
        </button>
        {mine && <button onClick={() => setEditing(true)}>Edit</button>}
        {mine && <button onClick={destroy}>Delete</button>}
        <span>{new Date(review.createdAt).toLocaleDateString()}</span>
      </footer>

      {/* Lazy: CommentThread only mounts (and fetches) once expanded. */}
      {showComments && (
        <CommentThread
          reviewId={review.id}
          onCommentAdded={() =>
            patchReviewEverywhere(queryClient, review.id, (r) => ({ commentCount: r.commentCount + 1 }))
          }
        />
      )}
    </article>
  );
}
