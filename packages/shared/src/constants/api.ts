export const API_ROUTES = {
  health: "/api/health",
  search: "/api/search",
  releases: "/api/releases",
  releasesImport: "/api/releases/import",
  artists: "/api/artists",
  labels: "/api/labels",
  charts: "/api/charts",
  users: "/api/users",
  feed: "/api/feed",
  reviewsRecent: "/api/reviews/recent",
  auth: {
    register: "/api/auth/register",
    login: "/api/auth/login",
    refresh: "/api/auth/refresh",
    spotify: "/api/auth/spotify",
    google: "/api/auth/google",
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
