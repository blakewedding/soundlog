import { useState } from "react";
import { api } from "../../services/api";
import { useAuth } from "../../contexts/AuthContext";

interface Props {
  username: string;
  initialFollowing: boolean;
  onChange?: (following: boolean, followerCount: number) => void;
  size?: "sm" | "md";
}

/** Follow/unfollow toggle. Hidden for anonymous viewers and for your own card. */
export function FollowButton({ username, initialFollowing, onChange, size = "md" }: Props) {
  const { user } = useAuth();
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);

  if (!user || user.username === username) return null;

  async function toggle() {
    setBusy(true);
    try {
      const res = following ? await api.unfollow(username) : await api.follow(username);
      setFollowing(res.following);
      onChange?.(res.following, res.followerCount);
    } finally {
      setBusy(false);
    }
  }

  const pad = size === "sm" ? "2px 12px" : "8px 18px";
  return (
    <button
      className={`btn ${following ? "btn-ghost" : "btn-primary"}`}
      style={{ padding: pad, fontSize: size === "sm" ? 12 : 13 }}
      onClick={toggle}
      disabled={busy}
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}
