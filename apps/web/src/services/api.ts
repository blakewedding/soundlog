import { API_ROUTES } from "@soundlog/shared";
import type {
  Artist,
  Label,
  ChartEntry,
  GenreCount,
  Release,
  ReleaseListItem,
  SearchResponse,
  SearchTab,
  FeedItem,
  FeedReview,
  Profile,
  Paginated,
  SimilarListener,
  User,
} from "@soundlog/shared";

// The access token lives in memory only (never storage); the refresh token is
// an httpOnly cookie the browser sends to /api/auth/* on our behalf.
let accessToken: string | null = null;
export function setAccessToken(token: string | null) {
  accessToken = token;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init?.headers,
    },
    credentials: "include",
  });
  if (!res.ok) {
    let message = `API error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // keep the fallback message
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export interface SessionUser {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface ReviewDTO {
  id: string;
  releaseId: string;
  user: SessionUser;
  content: string;
  rating?: number | null;
  containsSpoilers: boolean;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  createdAt: string;
}

export interface DiaryEntry {
  id: string;
  listenedAt: string;
  isRelisten: boolean;
  myRating?: number | null;
  release: {
    id: string;
    title: string;
    artistName: string;
    coverUrl?: string | null;
    type: string;
  };
}

export interface CommentDTO {
  id: string;
  parentId: string | null;
  content: string | null;
  deleted: boolean;
  user: SessionUser | null;
  createdAt: string;
  replies?: CommentDTO[];
}

export interface ListDTO {
  id: string;
  title: string;
  description?: string | null;
  isPublic: boolean;
  isRanked: boolean;
  user?: SessionUser;
  itemCount?: number;
  items?: Array<{
    releaseId: string;
    position: number;
    note?: string | null;
    release: { id: string; title: string; artistName: string; coverUrl?: string | null; type: string; year?: string | null };
  }>;
}

export const api = {
  health: () => request<{ status: string }>(API_ROUTES.health),

  // ---- auth ----
  register: (body: { username: string; email: string; password: string }) =>
    request<{ user: SessionUser; accessToken: string }>(API_ROUTES.auth.register, json(body)),
  login: (body: { email: string; password: string }) =>
    request<{ user: SessionUser; accessToken: string }>(API_ROUTES.auth.login, json(body)),
  refresh: () => request<{ accessToken: string }>(API_ROUTES.auth.refresh, { method: "POST" }),
  me: () => request<{ user: SessionUser }>("/api/auth/me"),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),

  // ---- catalog ----
  // Tabbed search across releases, artists, members, lists, labels.
  // tab "all" returns a trimmed top-results view of every bucket.
  search: (q: string, tab: SearchTab = "all", type?: string) =>
    request<SearchResponse>(
      `${API_ROUTES.search}?q=${encodeURIComponent(q)}&tab=${tab}${type ? `&type=${type}` : ""}`
    ),
  getRelease: (ref: string) =>
    request<{ release: Release }>(`${API_ROUTES.releases}/${encodeURIComponent(ref)}`),
  recentReleases: (limit = 12) =>
    request<{ releases: ReleaseListItem[] }>(`${API_ROUTES.releases}?limit=${limit}`),
  getArtist: (id: string) =>
    request<{ artist: Artist; releases: ReleaseListItem[] }>(
      `${API_ROUTES.artists}/${encodeURIComponent(id)}`
    ),
  getLabel: (id: string) =>
    request<{ label: Label; releases: ReleaseListItem[] }>(
      `${API_ROUTES.labels}/${encodeURIComponent(id)}`
    ),
  genreChart: (tag: string) =>
    request<{ tag: string; releases: ChartEntry[] }>(
      `${API_ROUTES.charts}/genre/${encodeURIComponent(tag)}`
    ),
  yearChart: (year: string | number) =>
    request<{ year: number; releases: ChartEntry[] }>(`${API_ROUTES.charts}/year/${year}`),
  activeGenres: (limit = 12) =>
    request<{ genres: GenreCount[] }>(`${API_ROUTES.charts}/genres?limit=${limit}`),

  // ---- ratings & logs ----
  rate: (releaseId: string, value: number) =>
    request<{ rating: { value: number } }>(`/api/ratings/${releaseId}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),
  unrate: (releaseId: string) => request<void>(`/api/ratings/${releaseId}`, { method: "DELETE" }),
  logListen: (releaseId: string) => request<{ log: unknown }>("/api/logs", json({ releaseId })),
  myDiary: (cursor?: string, limit = 25) =>
    request<{ logs: DiaryEntry[]; nextCursor: string | null }>(
      `/api/logs/me?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
    ),
  updateLog: (id: string, body: { listenedAt?: string; isRelisten?: boolean }) =>
    request<{ log: DiaryEntry }>(`/api/logs/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteLog: (id: string) => request<void>(`/api/logs/${id}`, { method: "DELETE" }),

  // ---- reviews ----
  reviewsFor: (releaseId: string) =>
    request<{ reviews: ReviewDTO[] }>(`/api/reviews/release/${releaseId}`),
  createReview: (body: { releaseId: string; content: string; rating?: number; containsSpoilers?: boolean }) =>
    request<{ review: ReviewDTO }>("/api/reviews", json(body)),
  updateReview: (id: string, body: { content?: string; rating?: number | null; containsSpoilers?: boolean }) =>
    request<{ review: ReviewDTO }>(`/api/reviews/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteReview: (id: string) => request<void>(`/api/reviews/${id}`, { method: "DELETE" }),
  likeReview: (id: string) =>
    request<{ likeCount: number; likedByMe: boolean }>(`/api/reviews/${id}/like`, { method: "POST" }),
  unlikeReview: (id: string) =>
    request<{ likeCount: number; likedByMe: boolean }>(`/api/reviews/${id}/like`, { method: "DELETE" }),

  // ---- comments ----
  commentsFor: (reviewId: string) => request<{ comments: CommentDTO[] }>(`/api/reviews/${reviewId}/comments`),
  addComment: (reviewId: string, body: { content: string; parentId?: string }) =>
    request<{ comment: CommentDTO }>(`/api/reviews/${reviewId}/comments`, json(body)),
  updateComment: (id: string, content: string) =>
    request<{ comment: CommentDTO }>(`/api/comments/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),
  deleteComment: (id: string) => request<void>(`/api/comments/${id}`, { method: "DELETE" }),

  // ---- lists ----
  lists: () => request<{ lists: ListDTO[] }>("/api/lists"),
  createList: (body: { title: string; description?: string; isRanked?: boolean; isPublic?: boolean }) =>
    request<{ list: ListDTO }>("/api/lists", json(body)),
  getList: (id: string) => request<{ list: ListDTO }>(`/api/lists/${id}`),
  updateList: (id: string, body: Partial<{ title: string; description: string; isRanked: boolean; isPublic: boolean }>) =>
    request<{ list: ListDTO }>(`/api/lists/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteList: (id: string) => request<void>(`/api/lists/${id}`, { method: "DELETE" }),
  addListItem: (listId: string, body: { releaseId: string; note?: string }) =>
    request<{ item: unknown }>(`/api/lists/${listId}/items`, json(body)),
  removeListItem: (listId: string, releaseId: string) =>
    request<void>(`/api/lists/${listId}/items/${releaseId}`, { method: "DELETE" }),
  updateListItemNote: (listId: string, releaseId: string, note: string | null) =>
    request<{ item: unknown }>(`/api/lists/${listId}/items/${releaseId}`, {
      method: "PATCH",
      body: JSON.stringify({ note }),
    }),
  reorderList: (listId: string, order: string[]) =>
    request<void>(`/api/lists/${listId}/items`, { method: "PUT", body: JSON.stringify({ order }) }),

  // ---- social: feed, profiles, follow ----
  feed: (cursor?: string, limit = 20) =>
    request<Paginated<FeedItem>>(
      `${API_ROUTES.feed}?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
    ),
  recentReviews: (limit = 8) =>
    request<{ reviews: FeedReview[] }>(`${API_ROUTES.reviewsRecent}?limit=${limit}`),
  popularReviews: (limit = 20) =>
    request<{ reviews: FeedReview[] }>(`${API_ROUTES.feed}/popular?limit=${limit}`),
  profile: (username: string) =>
    request<{ profile: Profile }>(`${API_ROUTES.users}/${encodeURIComponent(username)}`),
  follow: (username: string) =>
    request<{ following: boolean; followerCount: number }>(
      `${API_ROUTES.users}/${encodeURIComponent(username)}/follow`,
      { method: "POST" }
    ),
  unfollow: (username: string) =>
    request<{ following: boolean; followerCount: number }>(
      `${API_ROUTES.users}/${encodeURIComponent(username)}/follow`,
      { method: "DELETE" }
    ),
  followers: (username: string) =>
    request<{ users: FollowUser[] }>(`${API_ROUTES.users}/${encodeURIComponent(username)}/followers`),
  followingList: (username: string) =>
    request<{ users: FollowUser[] }>(`${API_ROUTES.users}/${encodeURIComponent(username)}/following`),
  profileActivity: (username: string, cursor?: string) =>
    request<Paginated<FeedItem>>(
      `${API_ROUTES.users}/${encodeURIComponent(username)}/activity${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`
    ),
  profileReviews: (username: string) =>
    request<{ reviews: FeedReview[] }>(`${API_ROUTES.users}/${encodeURIComponent(username)}/reviews`),
  similarListeners: (username: string) =>
    request<{ listeners: SimilarListener[] }>(
      `${API_ROUTES.users}/${encodeURIComponent(username)}/similar`
    ),
  profileRatings: (username: string) =>
    request<{ ratings: ProfileRating[] }>(`${API_ROUTES.users}/${encodeURIComponent(username)}/ratings`),
  profileLists: (username: string) =>
    request<{ lists: ListDTO[] }>(`${API_ROUTES.users}/${encodeURIComponent(username)}/lists`),
  profileDiary: (username: string, cursor?: string) =>
    request<{ logs: DiaryEntry[]; nextCursor: string | null }>(
      `${API_ROUTES.users}/${encodeURIComponent(username)}/diary${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`
    ),
};

export interface FollowUser extends User {
  isFollowing: boolean;
}

export interface ProfileRating {
  value: number;
  updatedAt: string;
  release: { id: string; title: string; artistName: string; coverUrl?: string | null; type: string };
}
