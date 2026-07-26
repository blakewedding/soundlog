import "dotenv/config";
import path from "node:path";
import { z } from "zod";

/**
 * An absolute http(s) URL.
 *
 * `z.string().url()` alone is not enough: it delegates to `new URL()`, which
 * happily parses `localhost:3000` as scheme `localhost:` with path `3000`. That
 * is precisely the typo this validation exists to catch, and it would sail
 * through — then produce a cookie policy derived from a protocol of
 * "localhost:". The scheme check is the part that does the work.
 */
const httpUrl = z
  .string()
  .url()
  .refine((v) => ["http:", "https:"].includes(new URL(v).protocol), {
    message: "must be an absolute http(s) URL, e.g. https://soundlog.example.com",
  });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  ELASTICSEARCH_NODE: z.string().default("http://localhost:9200"),
  JWT_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  // THE APP ORIGIN — scheme + host + port the browser actually uses. One origin
  // serves the SPA and /api (Vite proxies in dev, nginx proxies in production),
  // so the refresh cookie is same-origin by construction. Also where web OAuth
  // flows hand the browser back once a code is issued.
  //
  // `localhost`, not `127.0.0.1`: browsers treat those as different cookie
  // origins, so a session established under one is invisible on the other, and
  // the app is used on localhost. The OAuth *provider* callbacks below may
  // legitimately stay on 127.0.0.1 — see the note there.
  CLIENT_URL: httpUrl.default("http://localhost:3000"),
  // Custom URL scheme the mobile app registers, used to whitelist the deep-link
  // redirect target for the expo-auth-session OAuth flow (e.g. soundlog://auth).
  MOBILE_APP_SCHEME: z.string().default("soundlog"),
  // The provider callbacks are the ONE place 127.0.0.1 is still correct in dev:
  // Spotify's dashboard rejects `localhost` and requires a literal loopback IP.
  // That is safe despite CLIENT_URL being localhost, because this leg sets no
  // cookie — the callback consumes the OAuth state, mints a one-time code and
  // redirects to CLIENT_URL, where the SPA exchanges it same-origin. The
  // session is therefore always established on the app origin, never here.
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
  SPOTIFY_REDIRECT_URI: z.string().default("http://127.0.0.1:4000/api/auth/spotify/callback"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().default("http://127.0.0.1:4000/api/auth/google/callback"),
  // ---------- Resend (transactional email) ----------
  // Optional on purpose, exactly like Last.fm and Discogs: with no key the app
  // boots and simply does not send. Verification and password-reset degrade to
  // a logged no-op rather than a failed registration — which is what lets the
  // stack be deployed and proven before the sending domain has finished
  // verifying its DNS.
  RESEND_API_KEY: z.string().optional(),
  // The From: address. Must be on a domain verified in Resend, or every send is
  // rejected with a definitive 403 — which is a configuration error, not an
  // outage, and is reported as such.
  EMAIL_FROM: z.string().default("Soundlog <hello@soundlog.app>"),
  // ---------- Cover art proxy (see services/coverCache.ts) ----------
  // Where re-encoded cover renditions live. Regenerable from Release.coverUrl,
  // so it is deliberately NOT part of the backup strategy — same reasoning as
  // Elasticsearch under §5. The production stack mounts a named volume here;
  // the dev default is a gitignored directory under the backend package.
  // Resolved to an absolute path so a log line or an error message names a
  // directory the reader can actually go and look at.
  COVER_CACHE_DIR: z
    .string()
    .default(".cache/covers")
    .transform((v) => path.resolve(v)),
  // Hard ceiling, swept LRU-style. 1 GiB holds thousands of covers at five
  // widths; the point is that a crawler cannot fill the disk Postgres is on.
  COVER_CACHE_MAX_BYTES: z.coerce.number().int().positive().default(1024 * 1024 * 1024),
  LASTFM_API_KEY: z.string().optional(),
  // Discogs personal access token, sent as `Authorization: Discogs token=<value>`.
  DISCOGS_TOKEN: z.string().optional(),
  MUSICBRAINZ_USER_AGENT: z.string().default("Soundlog/0.1.0 (dev)"),
  // Catalog pre-warming (6.1.4). Minutes between sweeps; 0 disables it entirely,
  // which is the default so that tests, CI and a developer's laptop never make
  // unattended upstream calls. Production opts in.
  PREWARM_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(0),
  // Releases healed per sweep. Each costs a handful of throttled MusicBrainz
  // calls at the lowest tier, so this is a politeness budget, not a throughput
  // target — the point is to be finished before anyone asks, not to be fast.
  PREWARM_BATCH_SIZE: z.coerce.number().int().positive().default(5),
});

export const env = schema.parse(process.env);

/** The app origin, parsed once. */
export const appOrigin = new URL(env.CLIENT_URL);

/**
 * Whether the refresh cookie carries `Secure`.
 *
 * Derived from the scheme the app is actually served over, NOT from NODE_ENV.
 * The two disagree exactly where it hurts: the production stack running locally
 * over http is NODE_ENV=production, and a `Secure` cookie there is accepted by
 * Chrome (which treats localhost as trustworthy) and silently dropped by Safari
 * — a "works on my machine" auth bug with no error anywhere. Tying the flag to
 * the scheme makes it correct in both places by construction.
 */
export const cookieSecure = appOrigin.protocol === "https:";

/**
 * A production deployment served over plain http is a downgrade, not a
 * configuration choice — the refresh cookie loses `Secure` and rides the wire in
 * clear. Loopback is exempt: that is this stack, proving itself locally.
 */
export function warnIfInsecureOrigin(log: (msg: string) => void = console.warn): void {
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(appOrigin.hostname);
  if (env.NODE_ENV === "production" && !cookieSecure && !loopback) {
    log(
      `[boot] CLIENT_URL is ${env.CLIENT_URL} — production over plain http. ` +
        "The refresh cookie will NOT be marked Secure. Serve the app over https."
    );
  }
}
