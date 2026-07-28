import { API_ROUTES } from "@soundlog/shared";
import type {
  Artist,
  Label,
  ChartEntry,
  DiscographyResponse,
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

/**
 * Access tokens live 15 minutes. Without this, every write silently 401'd once a
 * session aged past that — "Log listen" would appear to do nothing at all. On a
 * 401 we redeem the httpOnly refresh cookie once and replay the request.
 * Concurrent 401s share one in-flight refresh so we never stampede /auth/refresh.
 */
let refreshInFlight: Promise<string | null> | null = null;

function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
      if (!res.ok) return null; // refresh token gone/expired — a real sign-out
      const body = (await res.json()) as { accessToken?: string };
      if (!body.accessToken) return null;
      setAccessToken(body.accessToken);
      return body.accessToken;
    } catch {
      return null;
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

function send(path: string, init: RequestInit | undefined, token: string | null): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    credentials: "include",
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res = await send(path, init, accessToken);

  // One transparent retry after refreshing an expired access token. The auth
  // endpoints themselves are excluded — refreshing in response to their 401
  // would recurse.
  if (res.status === 401 && accessToken && !path.startsWith("/api/auth/")) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await send(path, init, fresh);
  }

  if (!res.ok) {
    let message = fallbackMessage(res.status);
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Not JSON. This is the interesting case rather than the boring one: it
      // means something in front of the app answered — nginx, Varnish, or
      // Cloudflare — and those emit HTML. Whatever we show here is what the
      // user sees, so it must not be a status code.
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

/**
 * What to say when the failure carried no message we can read.
 *
 * `API error 413` is what a user actually saw when nginx refused a phone photo:
 * the proxy answers with HTML, so there is no `error` field to lift, and the
 * status code went straight to the screen. A status code is not an error
 * message — it tells the person nothing about what they did or what to do next.
 *
 * These are deliberately about the CONDITION rather than the layer, because the
 * user does not care which hop refused them.
 */
function fallbackMessage(status: number): string {
  if (status === 413) return "That file is too large to upload.";
  if (status === 401) return "Please sign in again.";
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "We couldn't find that.";
  if (status === 429) return "That's a lot of requests — give it a moment and try again.";
  if (status >= 500) return "Something went wrong on our end. Please try again.";
  return "That didn't work. Please try again.";
}

export interface SessionUser {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  // Present on the session endpoints (register / login / me / verify), absent
  // on the trimmed SessionUser embedded in reviews and lists — which is why it
  // is optional rather than a required boolean. Only the banner reads it, and
  // it treats "absent" the same as "verified": never nag on partial data.
  emailVerified?: boolean;
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
    coverColor?: string | null;
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
    release: {
      id: string;
      title: string;
      artistName: string;
      coverUrl?: string | null;
      coverColor?: string | null;
      type: string;
      year?: string | null;
    };
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

  // ---- email verification & password reset (Phase 6b) ----
  verifyEmail: (token: string) =>
    request<{ user: SessionUser }>(API_ROUTES.auth.verifyEmail, json({ token })),
  resendVerification: () =>
    request<{ sent: boolean; emailConfigured: boolean }>(API_ROUTES.auth.resendVerification, {
      method: "POST",
    }),
  // Always resolves for any syntactically valid address — the server answers
  // identically whether or not an account exists, and the UI must not invent a
  // distinction the API deliberately refuses to make.
  forgotPassword: (email: string) =>
    request<{ ok: true }>(API_ROUTES.auth.forgotPassword, json({ email })),
  resetPassword: (token: string, password: string) =>
    request<{ user: SessionUser; accessToken: string }>(
      API_ROUTES.auth.resetPassword,
      json({ token, password })
    ),

  // ---- catalog ----
  // Tabbed search across releases, artists, members, lists, labels.
  // tab "all" returns a trimmed top-results view of every bucket.
  search: (q: string, tab: SearchTab = "all", type?: string) =>
    request<SearchResponse>(
      `${API_ROUTES.search}?q=${encodeURIComponent(q)}&tab=${tab}${type ? `&type=${type}` : ""}`
    ),
  getRelease: (ref: string) =>
    request<{ release: Release }>(`${API_ROUTES.releases}/${encodeURIComponent(ref)}`),
  /**
   * Ask the server to RE-RUN enrichment for a release it already holds.
   *
   * The release page's "Try again" calls this before refetching. Refetching
   * alone was the bug: a GET by internal id is a database read, so nothing
   * re-executed the stage that failed and the button was decoration.
   */
  refreshRelease: (id: string) =>
    request<{ status: "pending" | "ready" | "failed"; release?: Release }>(
      `${API_ROUTES.releases}/${encodeURIComponent(id)}/refresh`,
      { method: "POST" }
    ),
  recentReleases: (limit = 12) =>
    request<{ releases: ReleaseListItem[] }>(`${API_ROUTES.releases}?limit=${limit}`),
  getArtist: (id: string) =>
    request<{ artist: Artist; releases: ReleaseListItem[] }>(
      `${API_ROUTES.artists}/${encodeURIComponent(id)}`
    ),
  artistDiscography: (id: string) =>
    request<DiscographyResponse>(`${API_ROUTES.artists}/${encodeURIComponent(id)}/discography`),
  refreshDiscography: (id: string) =>
    request<{ status: string }>(
      `${API_ROUTES.artists}/${encodeURIComponent(id)}/discography/refresh`,
      { method: "POST" }
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

  // ---- the caller's own account ----
  myProfile: () => request<{ profile: OwnProfile }>(API_ROUTES.me.profile),
  updateMyProfile: (body: {
    displayName?: string | null;
    bio?: string | null;
    links?: ProfileLink[];
  }) => request<{ profile: OwnProfile }>(API_ROUTES.me.profile, { method: "PATCH", body: JSON.stringify(body) }),
  /**
   * The image as the RAW request body — not multipart. There are no fields to
   * send besides the bytes, and the server derives the path from the user id
   * and a content hash, so a filename would only be something to throw away.
   *
   * The `Content-Type` override is load-bearing: `send()` sets
   * application/json by default, and the route only accepts `image/*`.
   */
  uploadAvatar: (file: File) =>
    request<{ profile: OwnProfile; bytes: number }>(API_ROUTES.me.avatar, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    }),
  deleteAvatar: () =>
    request<{ profile: OwnProfile }>(API_ROUTES.me.avatar, { method: "DELETE" }),
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

/** One entry in a profile's link list. Validated server-side; https only. */
export interface ProfileLink {
  label: string;
  url: string;
}

/**
 * The caller's OWN account — a different shape from `Profile`, which is what
 * anyone may see about somebody. This one carries the email and the settings
 * fields, and is only ever returned by `/api/me/*`.
 */
export interface OwnProfile {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  links: ProfileLink[];
  plan: "FREE" | "PRO";
  /**
   * Round-tripped but NOT enforced anywhere yet — 6.2b makes it real across
   * Postgres and Elasticsearch. Nothing should render a control for this until
   * then: a toggle that appears to work and does not is worse than its absence.
   */
  profileVisibility: "PUBLIC" | "PRIVATE";
  createdAt: string;
  emailVerified: boolean;
}

export interface ProfileRating {
  value: number;
  updatedAt: string;
  release: {
    id: string;
    title: string;
    artistName: string;
    coverUrl?: string | null;
    coverColor?: string | null;
    type: string;
  };
}
