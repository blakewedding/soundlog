import { useState } from "react";
import { api, ApiError, type ReviewDTO } from "../../services/api";
import { StarRatingInput } from "../ui/StarRatingInput";

// The editable fields — accepts a ReviewDTO or a FeedReview (both carry these).
interface EditableReview {
  id: string;
  content: string;
  rating?: number | null;
  containsSpoilers: boolean;
}

interface Props {
  releaseId: string;
  existing?: EditableReview | null; // present = edit mode
  onSaved: (review: ReviewDTO) => void;
  onCancel?: () => void;
}

export function ReviewForm({ releaseId, existing, onSaved, onCancel }: Props) {
  const [content, setContent] = useState(existing?.content ?? "");
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null);
  const [spoilers, setSpoilers] = useState(existing?.containsSpoilers ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = existing
        ? await api.updateReview(existing.id, {
            content,
            rating: rating ?? null,
            containsSpoilers: spoilers,
          })
        : await api.createReview({
            releaseId,
            content,
            rating: rating ?? undefined,
            containsSpoilers: spoilers,
          });
      onSaved(res.review);
      if (!existing) {
        setContent("");
        setRating(null);
        setSpoilers(false);
      }
    } catch (err) {
      // The one-review-per-release 409 arrives here with its friendly message.
      setError(err instanceof ApiError ? err.message : "Couldn't save your review");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong>{existing ? "Edit your review" : "Write a review"}</strong>
        <StarRatingInput
          value={rating}
          onChange={setRating}
          onClear={() => setRating(null)}
          label="Rating for your review"
        />
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="What did this record do to you?"
        rows={5}
        required
      />
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <label className="meta" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          {/* No inline width: the base stylesheet no longer stretches
              checkboxes, and an inline width would override the touch sizing. */}
          <input
            type="checkbox"
            checked={spoilers}
            onChange={(e) => setSpoilers(e.target.checked)}
          />
          Contains spoilers
        </label>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {onCancel && (
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving || !content.trim()}>
            {saving ? "Saving…" : existing ? "Save changes" : "Post review"}
          </button>
        </div>
      </div>
      {error && (
        <p className="meta" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </form>
  );
}
