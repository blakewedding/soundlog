import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  ELASTICSEARCH_NODE: z.string().default("http://localhost:9200"),
  JWT_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  // Where web OAuth flows redirect the browser back to once a code is issued.
  CLIENT_URL: z.string().default("http://127.0.0.1:3000"),
  // Custom URL scheme the mobile app registers, used to whitelist the deep-link
  // redirect target for the expo-auth-session OAuth flow (e.g. soundlog://auth).
  MOBILE_APP_SCHEME: z.string().default("soundlog"),
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
  SPOTIFY_REDIRECT_URI: z.string().default("http://127.0.0.1:4000/api/auth/spotify/callback"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().default("http://127.0.0.1:4000/api/auth/google/callback"),
  LASTFM_API_KEY: z.string().optional(),
  // Discogs personal access token, sent as `Authorization: Discogs token=<value>`.
  DISCOGS_TOKEN: z.string().optional(),
  MUSICBRAINZ_USER_AGENT: z.string().default("Soundlog/0.1.0 (dev)"),
});

export const env = schema.parse(process.env);
