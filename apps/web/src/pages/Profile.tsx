import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RELEASE_TYPE_LABELS } from "@soundlog/shared";
import type { ProfileRating } from "../services/api";
import { api } from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { FollowButton } from "../components/social/FollowButton";
import { FeedList } from "../components/feed/FeedList";
import { ReviewCard } from "../components/review/ReviewCard";
import { StarRating } from "../components/ui/StarRating";
import { CoverImage } from "../components/ui/CoverImage";
import { Avatar } from "../components/ui/Avatar";

type Tab = "activity" | "reviews" | "ratings" | "lists" | "diary" | "followers" | "following";

export default function Profile() {
  const { username = "" } = useParams();
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("activity");

  // Wait for the auth bootstrap so the profile is fetched WITH the viewer's
  // token — otherwise isFollowing/private-list visibility resolve as anonymous.
  // Keyed by the viewer so switching accounts refetches.
  const { data, isLoading, isError } = useQuery({
    queryKey: ["profile", username, user?.id],
    queryFn: () => api.profile(username),
    enabled: !authLoading,
  });

  if (authLoading || isLoading) return <p className="meta">Loading profile…</p>;
  if (isError || !data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="meta">We couldn't find that member.</p>
        <Link to="/">← Home</Link>
      </div>
    );
  }

  const p = data.profile;
  const joined = new Date(p.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <header style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        {/* Standalone, so NOT decorative: on this page the avatar is the only
            thing identifying whose profile this is. */}
        <Avatar src={p.avatarUrl} name={p.displayName ?? p.username} size="hero" decorative={false} />
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0 }}>{p.displayName ?? p.username}</h1>
            {/* The ONLY entry point to /settings, deliberately. A seventh nav
                link would worsen the three-row wrap the nav already has at
                380px, and this is the place people look for it. */}
            {p.isMe ? (
              <Link to="/settings" className="btn btn-ghost">
                Edit profile
              </Link>
            ) : (
              <FollowButton
                username={p.username}
                initialFollowing={p.isFollowing}
                onChange={() => queryClient.invalidateQueries({ queryKey: ["profile", username] })}
              />
            )}
          </div>
          <p className="meta">@{p.username} · joined {joined}</p>
          {p.bio && <p style={{ marginTop: 8, color: "var(--text-muted)", maxWidth: 560 }}>{p.bio}</p>}
          <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
            <CountButton label="Followers" value={p.counts.followers} onClick={() => setTab("followers")} />
            <CountButton label="Following" value={p.counts.following} onClick={() => setTab("following")} />
            <span className="meta">{p.counts.reviews} reviews</span>
            <span className="meta">{p.counts.ratings} ratings</span>
            <span className="meta">{p.counts.logs} logs</span>
          </div>
        </div>
      </header>

      <SimilarListeners username={p.username} />

      <nav style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
        {(["activity", "reviews", "ratings", "lists", "diary"] as Tab[]).map((t) => (
          <TabButton key={t} active={tab === t} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </TabButton>
        ))}
      </nav>

      {tab === "activity" && <ActivityTab username={p.username} />}
      {tab === "reviews" && <ReviewsTab username={p.username} />}
      {tab === "ratings" && <RatingsTab username={p.username} />}
      {tab === "lists" && <ListsTab username={p.username} />}
      {tab === "diary" && <DiaryTab username={p.username} />}
      {(tab === "followers" || tab === "following") && <PeopleTab username={p.username} which={tab} />}
    </div>
  );
}

function CountButton({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button className="btn btn-ghost" style={{ padding: "2px 10px", fontSize: 12 }} onClick={onClick}>
      <strong style={{ color: "var(--text)" }}>{value}</strong> {label}
    </button>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="btn btn-ghost"
      style={{
        border: "none",
        borderBottom: active ? "2px solid var(--gold)" : "2px solid transparent",
        borderRadius: 0,
        color: active ? "var(--text)" : "var(--text-muted)",
      }}
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="meta">{children}</p>;
}

// "Listeners like you" — members whose loved releases overlap this profile's.
// Silent when there are no suggestions (thin data or everyone's already followed).
function SimilarListeners({ username }: { username: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["similar-listeners", username],
    queryFn: () => api.similarListeners(username),
  });
  const listeners = data?.listeners ?? [];
  if (listeners.length === 0) return null;

  return (
    <section className="card" style={{ padding: 16 }}>
      <div className="section-label">Listeners like {username}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        {listeners.map((l) => (
          <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link to={`/${l.username}`} className="card-link" style={{ flex: 1 }}>
              <strong style={{ fontSize: 14 }}>{l.displayName ?? l.username}</strong>{" "}
              <span className="meta">
                @{l.username} · {l.sharedCount} shared {l.sharedCount === 1 ? "favorite" : "favorites"}
              </span>
            </Link>
            <FollowButton
              username={l.username}
              initialFollowing={l.isFollowing}
              size="sm"
              onChange={() =>
                queryClient.invalidateQueries({ queryKey: ["similar-listeners", username] })
              }
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function ActivityTab({ username }: { username: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["profile-activity", username],
    queryFn: () => api.profileActivity(username),
  });
  if (isLoading) return <Empty>Loading…</Empty>;
  const items = data?.items ?? [];
  return items.length ? <FeedList items={items} /> : <Empty>No activity yet.</Empty>;
}

function ReviewsTab({ username }: { username: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["profile-reviews", username],
    queryFn: () => api.profileReviews(username),
  });
  if (isLoading) return <Empty>Loading…</Empty>;
  const reviews = data?.reviews ?? [];
  return reviews.length ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {reviews.map((r) => (
        <ReviewCard key={r.id} review={r} />
      ))}
    </div>
  ) : (
    <Empty>No reviews yet.</Empty>
  );
}

function RatingsTab({ username }: { username: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["profile-ratings", username],
    queryFn: () => api.profileRatings(username),
  });
  if (isLoading) return <Empty>Loading…</Empty>;
  const ratings = data?.ratings ?? [];
  return ratings.length ? (
    <div className="release-grid">
      {ratings.map((r) => (
        <RatingCard key={r.release.id} rating={r} />
      ))}
    </div>
  ) : (
    <Empty>No ratings yet.</Empty>
  );
}

function RatingCard({ rating }: { rating: ProfileRating }) {
  return (
    <div>
      <Link to={`/release/${rating.release.id}`} className="card-link">
        <CoverImage
          src={rating.release.coverUrl}
          color={rating.release.coverColor}
          alt={`${rating.release.title} cover`}
        />
        <strong style={{ fontSize: 14, display: "block", marginTop: 8 }}>{rating.release.title}</strong>
      </Link>
      <div className="meta">{rating.release.artistName}</div>
      <StarRating value={rating.value} />
    </div>
  );
}

function ListsTab({ username }: { username: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["profile-lists", username],
    queryFn: () => api.profileLists(username),
  });
  if (isLoading) return <Empty>Loading…</Empty>;
  const lists = data?.lists ?? [];
  return lists.length ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {lists.map((l) => (
        <Link key={l.id} to={`/list/${l.id}`} className="card-link card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <strong>{l.title}</strong>
            <div className="meta">
              {l.isRanked ? "Ranked · " : ""}
              {l.itemCount ?? 0} releases
            </div>
          </div>
          {!l.isPublic && <span className="type-badge">Private</span>}
        </Link>
      ))}
    </div>
  ) : (
    <Empty>No public lists.</Empty>
  );
}

function DiaryTab({ username }: { username: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["profile-diary", username],
    queryFn: () => api.profileDiary(username),
  });
  if (isLoading) return <Empty>Loading…</Empty>;
  const logs = data?.logs ?? [];
  return logs.length ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {logs.map((l) => (
        <div key={l.id} className="card" style={{ display: "flex", gap: 12, alignItems: "center", padding: 10 }}>
          <span className="meta" style={{ minWidth: 84 }}>
            {new Date(l.listenedAt).toLocaleDateString()}
          </span>
          <div style={{ width: 40, flexShrink: 0 }}>
            <CoverImage
              src={l.release.coverUrl}
              color={l.release.coverColor}
              size="row"
              alt={`${l.release.title} cover`}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Link to={`/release/${l.release.id}`} className="card-link">
              <strong style={{ fontSize: 14 }}>{l.release.title}</strong>
            </Link>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="meta">{l.release.artistName}</span>
              <span className="type-badge">{RELEASE_TYPE_LABELS[l.release.type]}</span>
              {l.isRelisten && <span className="type-badge">Relisten</span>}
              {l.myRating != null && <StarRating value={l.myRating} />}
            </div>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <Empty>No listens logged.</Empty>
  );
}

function PeopleTab({ username, which }: { username: string; which: "followers" | "following" }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["profile-people", username, which],
    queryFn: () => (which === "followers" ? api.followers(username) : api.followingList(username)),
  });
  if (isLoading) return <Empty>Loading…</Empty>;
  const users = data?.users ?? [];
  return users.length ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {users.map((u) => (
        <div key={u.id} className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: 12 }}>
          <Link to={`/${u.username}`} className="review-user">
            {u.displayName ?? u.username}
          </Link>
          <span className="meta">@{u.username}</span>
          <div style={{ marginLeft: "auto" }}>
            <FollowButton
              username={u.username}
              initialFollowing={u.isFollowing}
              size="sm"
              onChange={() => queryClient.invalidateQueries({ queryKey: ["profile-people", username, which] })}
            />
          </div>
        </div>
      ))}
    </div>
  ) : (
    <Empty>{which === "followers" ? "No followers yet." : "Not following anyone yet."}</Empty>
  );
}
