// Shared domain types — mirror backend/prisma/schema.prisma.
// Consumed by both the web (React) and mobile (React Native) apps.

export type ReleaseType =
  | "ALBUM" | "SINGLE" | "SONG" | "EP" | "MIXTAPE"
  | "DJ_MIX" | "COMPILATION" | "MUSIC_VIDEO" | "VIDEO";

export interface User {
  id: string;
  username: string;
  displayName?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
}

export interface Artist {
  id: string;
  name: string;
  /** Latin/English rendering when `name` is non-Latin (フィッシュマンズ -> Fishmans). */
  latinName?: string | null;
  sortName?: string | null;
  type?: string | null; // "Person" | "Group" | ...
  area?: string | null;
  beginDate?: string | null; // formed/born — MB partial dates
  musicbrainzId?: string | null;
}

export interface Label {
  id: string;
  name: string;
  area?: string | null;
  founded?: string | null; // MB partial date ("1989", "1989-05")
  musicbrainzId?: string | null;
}

export type ActivityType =
  | "LOG" | "REVIEW" | "RATING" | "LIST_CREATE" | "LIST_ITEM_ADD" | "COMMENT" | "FOLLOW";

// Review shape rendered by ReviewCard (feed + recent-reviews). The full release
// object isn't needed here — only what the card shows.
export interface FeedReview {
  id: string;
  user: User;
  release: { id: string; title: string; artistName: string; coverUrl?: string | null; coverColor?: string | null };
  content: string;
  rating?: number | null;
  containsSpoilers: boolean;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean; // viewer-relative; false when anonymous
  createdAt: string;
}

// A hydrated feed/activity entry. The shape carries only what each `type` needs;
// the client renders it with the SAME components used elsewhere (ReviewCard,
// StarRating, list/release cards) — no parallel implementations.
export interface FeedItem {
  id: string;
  type: ActivityType;
  createdAt: string;
  user: User;
  release?: {
    id: string;
    title: string;
    artistName: string;
    coverUrl?: string | null;
    coverColor?: string | null;
    type: ReleaseType;
  } | null;
  rating?: number | null; // RATING → the value
  review?: FeedReview | null; // REVIEW → rendered via ReviewCard
  list?: { id: string; title: string; itemCount?: number } | null;
  comment?: { content: string; reviewId: string } | null;
  targetUser?: User | null; // FOLLOW → who was followed
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

// Public profile: header + tab counts + viewer-relative flags.
/** One link on a public profile. Validated https-only server-side. */
export interface ProfileLink {
  label: string;
  url: string;
}

export interface Profile {
  id: string;
  username: string;
  displayName?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  /** Public, like the bio. Absent on payloads written before 6.2b. */
  links?: ProfileLink[];
  createdAt: string;
  counts: {
    followers: number;
    following: number;
    reviews: number;
    ratings: number;
    lists: number; // public lists (or all, when viewing your own)
    logs: number;
  };
  isFollowing: boolean; // does the viewer follow this profile
  isMe: boolean;
}

export interface Release {
  id: string;
  title: string;
  artistName: string;
  artist?: { id: string; name: string } | null;
  label?: { id: string; name: string } | null;
  releaseDate?: string | null;
  genres: string[];
  coverUrl?: string | null;
  coverUrlLarge?: string | null; // the lightbox rendition
  /** Raw dominant colour (#rrggbb) for the placeholder tint; muted client-side. */
  coverColor?: string | null;
  /**
   * Whether the server is still filling this release in.
   *
   *   pending — enrichment in flight; fields may still be missing, and the page
   *             must show that rather than presenting the gaps as final
   *   ready   — done; what is here IS the answer, absences included
   *   failed  — finished with a broken stage; partial and known to be partial
   *
   * Optional so an older client (or a response cached from before this shipped)
   * reads undefined and behaves exactly as it did before.
   */
  enrichment?: "pending" | "ready" | "failed";
  type: ReleaseType;
  trackCount?: number | null;
  spotifyId?: string | null;
  avgRating?: number;
  ratingCount?: number;
  similarArtists?: string[];
  myRating?: number; // present only for authenticated requests
  myReviewId?: string;
  /** How many times the viewer has logged this release (0 when anonymous). */
  myLogCount?: number;
}

// Compact release shape used by list endpoints (recent releases, artist pages).
export interface ReleaseListItem {
  id: string;
  title: string;
  artistName: string;
  artist?: { id: string; name: string } | null;
  year?: string | null;
  type: ReleaseType;
  coverUrl?: string | null;
  coverColor?: string | null;
  genres?: string[];
}

// An artist hit in search results (seeded catalog only).
export interface ArtistSearchResult {
  id: string;
  name: string;
  latinName?: string | null;
  type?: string | null;
  area?: string | null;
  releaseCount: number;
}

// A unified catalog search hit. `ref` is either an internal Release id (already
// seeded) or "<source>:<sourceId>" (seed-on-first-access at GET /api/releases/:ref).
export interface CatalogSearchResult {
  ref: string;
  releaseId?: string | null;
  artistId?: string | null; // internal Artist id, when seeded
  title: string;
  artistName: string;
  year?: string | null;
  type: ReleaseType;
  coverUrl?: string | null;
  coverColor?: string | null;
}

// A member (user) hit in search results.
export interface MemberSearchResult {
  id: string;
  username: string;
  displayName?: string | null;
}

// A public list hit in search results.
export interface ListSearchResult {
  id: string;
  title: string;
  username: string;
  itemCount: number;
}

// A label hit in search results, with how many of its releases we hold.
export interface LabelSearchResult {
  id: string;
  name: string;
  area?: string | null;
  releaseCount: number;
}

// The tabs of the search UI. "all" is the unified top-results view.
export type SearchTab = "all" | "releases" | "artists" | "members" | "lists" | "labels";

// Full tabbed-search response. Every bucket is present; a specific tab fills its
// own bucket (and "all" fills a trimmed set of each).
export interface SearchResponse {
  tab: SearchTab;
  results: CatalogSearchResult[];
  artists: ArtistSearchResult[];
  members: MemberSearchResult[];
  lists: ListSearchResult[];
  labels: LabelSearchResult[];
}

// A "listeners like you" suggestion — overlap on highly-rated releases.
export interface SimilarListener {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  sharedCount: number;
  isFollowing: boolean;
}

// ---- Artist discographies (Phase 5.6) ----

/** One release-group in an artist's discography, merged with local catalog data. */
export interface DiscographyEntry {
  mbid: string;
  title: string;
  year?: string | null;
  type: ReleaseType;
  disambiguation?: string;
  /** Set once the release exists locally; null while un-seeded. */
  releaseId?: string | null;
  seeded: boolean;
  coverUrl?: string | null;
  coverColor?: string | null;
  avgRating?: number | null;
  ratingCount: number;
  myRating?: number | null;
}

export interface DiscographyGroup {
  key: string;
  label: string;
  entries: DiscographyEntry[];
}

/**
 * A prolific artist's first-ever fetch takes several throttled MusicBrainz
 * calls, so the endpoint reports assembly progress instead of blocking.
 */
export type DiscographyResponse =
  | {
      status: "complete";
      groups: DiscographyGroup[];
      counts: { total: number; seeded: number };
      unavailable?: string;
    }
  | { status: "assembling"; progress: { fetched: number; total: number | null } };

// A genre with how many releases carry it — the active-genres rail.
export interface GenreCount {
  tag: string;
  slug: string;
  count: number;
}

// A ranked release on a genre or year chart.
export interface ChartEntry {
  id: string;
  title: string;
  artistName: string;
  artistId?: string | null;
  year?: string | null;
  type: ReleaseType;
  coverUrl?: string | null;
  coverColor?: string | null;
  genres: string[];
  avgRating?: number | null;
  ratingCount: number;
  weightedRating: number;
}

export interface Review {
  id: string;
  user: User;
  release: Release;
  content: string;
  rating?: number | null;
  containsSpoilers: boolean;
  likeCount: number;
  commentCount: number;
  createdAt: string;
}

export interface ReviewComment {
  id: string;
  user: User;
  content: string;
  parentId?: string | null;
  createdAt: string;
}

export interface List {
  id: string;
  user: User;
  title: string;
  description?: string | null;
  isRanked: boolean;
  itemCount: number;
}
