import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type CommentDTO } from "../../services/api";
import { useAuth } from "../../contexts/AuthContext";

/**
 * Threaded comments for a review — one nesting level. Replies attach to
 * top-level comments only; soft-deleted parents render as placeholders so
 * their replies stay readable.
 */
export function CommentThread({
  reviewId,
  onCommentAdded,
}: {
  reviewId: string;
  onCommentAdded?: () => void; // fired only when a NEW comment is posted (bumps the count)
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["comments", reviewId],
    queryFn: () => api.commentsFor(reviewId),
  });

  // Refetch this thread after any change (add/edit/delete).
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["comments", reviewId] });
  const onAdded = () => {
    refresh();
    onCommentAdded?.();
  };

  if (isLoading) return <p className="meta">Loading comments…</p>;
  const comments = data?.comments ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {comments.length === 0 && <p className="meta">No comments yet.</p>}
      {comments.map((c) => (
        <Comment
          key={c.id}
          comment={c}
          reviewId={reviewId}
          canInteract={!!user}
          meId={user?.id}
          onChange={refresh}
          onAdded={onAdded}
        />
      ))}
      {user ? (
        <CommentBox reviewId={reviewId} onPosted={onAdded} placeholder="Add a comment…" />
      ) : (
        <p className="meta">Log in to join the discussion.</p>
      )}
    </div>
  );
}

function Comment({
  comment,
  reviewId,
  canInteract,
  meId,
  onChange,
  onAdded,
}: {
  comment: CommentDTO;
  reviewId: string;
  canInteract: boolean;
  meId?: string;
  onChange: () => void;
  onAdded: () => void;
}) {
  const [replying, setReplying] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <CommentBody comment={comment} meId={meId} onChange={onChange} />
      {/* One nesting level: reply affordance only on top-level comments. */}
      {canInteract && !comment.deleted && (
        <button
          className="btn btn-ghost"
          style={{ alignSelf: "flex-start", padding: "2px 10px", fontSize: 12 }}
          onClick={() => setReplying((r) => !r)}
        >
          {replying ? "Cancel" : "Reply"}
        </button>
      )}
      {replying && (
        <div style={{ marginLeft: 24 }}>
          <CommentBox
            reviewId={reviewId}
            parentId={comment.id}
            onPosted={() => {
              setReplying(false);
              onAdded();
            }}
            placeholder="Write a reply…"
          />
        </div>
      )}
      {(comment.replies?.length ?? 0) > 0 && (
        <div style={{ marginLeft: 24, display: "flex", flexDirection: "column", gap: 8, borderLeft: "1px solid var(--line)", paddingLeft: 12 }}>
          {comment.replies!.map((r) => (
            <CommentBody key={r.id} comment={r} meId={meId} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentBody({
  comment,
  meId,
  onChange,
}: {
  comment: CommentDTO;
  meId?: string;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.content ?? "");
  const mine = !!meId && comment.user?.id === meId;

  if (comment.deleted) {
    return (
      <p className="meta" style={{ fontStyle: "italic" }}>
        [comment deleted]
      </p>
    );
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    await api.updateComment(comment.id, draft);
    setEditing(false);
    onChange();
  }

  async function remove() {
    await api.deleteComment(comment.id);
    onChange();
  }

  if (editing) {
    return (
      <form onSubmit={saveEdit} style={{ display: "flex", gap: 8 }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Edit comment" />
        <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>
          Save
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </form>
    );
  }

  return (
    <div>
      <span className="review-user" style={{ fontSize: 13 }}>
        {comment.user?.displayName ?? comment.user?.username}
      </span>{" "}
      <span style={{ fontSize: 14 }}>{comment.content}</span>
      {mine && (
        <>
          <button
            className="btn btn-ghost"
            style={{ marginLeft: 8, padding: "0 8px", fontSize: 11 }}
            onClick={() => {
              setDraft(comment.content ?? "");
              setEditing(true);
            }}
          >
            Edit
          </button>
          <button
            className="btn btn-ghost"
            style={{ marginLeft: 4, padding: "0 8px", fontSize: 11 }}
            onClick={remove}
          >
            Delete
          </button>
        </>
      )}
    </div>
  );
}

function CommentBox({
  reviewId,
  parentId,
  onPosted,
  placeholder,
}: {
  reviewId: string;
  parentId?: string;
  onPosted: () => void;
  placeholder: string;
}) {
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setBusy(true);
    try {
      await api.addComment(reviewId, { content, parentId });
      setContent("");
      onPosted();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={post} style={{ display: "flex", gap: 8 }}>
      <input value={content} onChange={(e) => setContent(e.target.value)} placeholder={placeholder} />
      <button type="submit" className="btn btn-primary" disabled={busy || !content.trim()}>
        Post
      </button>
    </form>
  );
}
