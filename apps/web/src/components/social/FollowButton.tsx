import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../services/api";
import { useAuth } from "../../contexts/AuthContext";
import { invalidateFollowSurfaces, patchFollowEverywhere } from "../../lib/followCache";

interface Props {
  username: string;
  initialFollowing: boolean;
  onChange?: (following: boolean, followerCount: number) => void;
  size?: "sm" | "md";
}

/**
 * Follow/unfollow toggle. Hidden for anonymous viewers and for your own card.
 *
 * Optimistic, per CLAUDE.md §6 — the same shape as the 4.1 like button and the
 * 5.7 rating: the label flips on click, every cached surface is patched
 * together, the server value is reconciled on success, and a failure rolls back
 * *and says so* with a retry.
 *
 * Before this, `toggle` was an un-caught async click handler: a rejected write
 * became an unhandled promise rejection, the button silently un-stuck itself,
 * and the click looked like it did nothing.
 */
export function FollowButton({ username, initialFollowing, onChange, size = "md" }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [following, setFollowing] = useState(initialFollowing);

  // The prop is the source of truth; local state is only the optimistic layer.
  // Two FollowButtons can render the same person at once (a profile header and
  // the followers tab below it) — when a cache patch updates one's prop, this
  // keeps the other from sitting on a stale local value.
  useEffect(() => setFollowing(initialFollowing), [initialFollowing]);

  const mutation = useMutation({
    mutationFn: (next: boolean) => (next ? api.follow(username) : api.unfollow(username)),
    onMutate: (next) => {
      const prev = following;
      setFollowing(next);
      patchFollowEverywhere(
        queryClient,
        username,
        { isFollowing: next, delta: next ? 1 : -1 },
        user?.username
      );
      return { prev };
    },
    onError: (_err, next, ctx) => {
      // Roll back both the local label and every surface we patched.
      if (ctx) setFollowing(ctx.prev);
      patchFollowEverywhere(
        queryClient,
        username,
        { isFollowing: !next, delta: next ? -1 : 1 },
        user?.username
      );
    },
    onSuccess: (res) => {
      setFollowing(res.following);
      onChange?.(res.following, res.followerCount);
    },
    // Counts and feed content also moved server-side — refetch to reconcile.
    onSettled: () => invalidateFollowSurfaces(queryClient),
  });

  if (!user || user.username === username) return null;

  const pad = size === "sm" ? "2px 12px" : "8px 18px";

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      <button
        className={`btn ${following ? "btn-ghost" : "btn-primary"}`}
        style={{ padding: pad, fontSize: size === "sm" ? 12 : 13 }}
        onClick={() => mutation.mutate(!following)}
        disabled={mutation.isPending}
        aria-pressed={following}
      >
        {following ? "Following" : "Follow"}
      </button>
      {mutation.isError && (
        <span role="alert" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="meta" style={{ color: "var(--danger)", fontSize: 11 }}>
            {/* Describes the ATTEMPTED action, not current state. Reading
                `following` here named the wrong verb: by the time the message
                renders the rollback has already restored the old value, so a
                failed unfollow announced "Couldn't follow." */}
            {mutation.variables ? "Couldn't follow." : "Couldn't unfollow."}
          </span>
          <button
            className="btn btn-ghost"
            style={{ padding: "0 8px", fontSize: 11 }}
            onClick={() => mutation.mutate(!following)}
          >
            Try again
          </button>
        </span>
      )}
    </span>
  );
}
