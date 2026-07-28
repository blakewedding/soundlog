export const API_ROUTES = {
  health: "/api/health",
  search: "/api/search",
  releases: "/api/releases",
  releasesImport: "/api/releases/import",
  artists: "/api/artists",
  labels: "/api/labels",
  charts: "/api/charts",
  users: "/api/users",
  // The caller acting on their own account, as distinct from `users` — which is
  // the public view of somebody. See backend/src/routes/me.ts.
  me: {
    profile: "/api/me/profile",
    avatar: "/api/me/avatar",
    password: "/api/me/password",
    email: "/api/me/email",
  },
  feed: "/api/feed",
  reviewsRecent: "/api/reviews/recent",
  auth: {
    register: "/api/auth/register",
    login: "/api/auth/login",
    refresh: "/api/auth/refresh",
    spotify: "/api/auth/spotify",
    google: "/api/auth/google",
    verifyEmail: "/api/auth/verify-email",
    resendVerification: "/api/auth/resend-verification",
    forgotPassword: "/api/auth/forgot-password",
    resetPassword: "/api/auth/reset-password",
    // Clicked from the mailbox being claimed, so unauthenticated by necessity.
    confirmEmailChange: "/api/auth/confirm-email-change",
  },
} as const;

export const RELEASE_TYPE_LABELS: Record<string, string> = {
  ALBUM: "Album",
  SINGLE: "Single",
  SONG: "Song",
  EP: "EP",
  MIXTAPE: "Mixtape",
  DJ_MIX: "DJ Mix",
  COMPILATION: "Compilation",
  MUSIC_VIDEO: "Music Video",
  VIDEO: "Video",
};
