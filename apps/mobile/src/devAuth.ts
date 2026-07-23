import * as SecureStore from "expo-secure-store";

/**
 * A development-only credential holder, so a real device can be tested against
 * an authenticated API before Phase 7 builds actual mobile auth.
 *
 * Why this exists: `/api/feed` is `requireAuth` by design (the personal feed is
 * private; `/api/feed/popular` is the public one). Until mobile has sign-in,
 * the only way to see a populated feed on a phone was to bake a token in via
 * `EXPO_PUBLIC_DEV_TOKEN`. Those variables are inlined by Babel **at bundle
 * time**, so restarting Metro without the variable silently produces a build
 * that sends no Authorization header at all — which is exactly how a working
 * device session turned into "Sign in to see your feed" overnight.
 *
 * The token is therefore kept in SecureStore, not in the bundle: it survives
 * Metro restarts, cache clears and app reloads, and it is entered once on the
 * device rather than threaded through the shell environment.
 *
 * PRODUCTION SAFETY. Every function here is hard-gated on `__DEV__` and returns
 * a no-op/null in a release build, so even if a screen were to call one by
 * mistake it cannot read, write, or authenticate anything. The dev sign-in UI
 * is additionally not rendered outside `__DEV__`. Nothing here is a substitute
 * for real auth — it is scaffolding with an expiry date.
 */

const KEY = "soundlog.dev.accessToken";

/**
 * In-memory mirror of the stored token. Reads happen on every API call, and a
 * SecureStore read is async — this keeps `getDevToken()` synchronous so the
 * request path stays simple.
 */
let cached: string | null = null;
let loaded = false;

/** Environment fallback, for anyone still starting Metro the old way. */
const fromEnv = process.env.EXPO_PUBLIC_DEV_TOKEN ?? null;

/** Load the persisted token once at startup. Safe to call repeatedly. */
export async function loadDevToken(): Promise<string | null> {
  if (!__DEV__) return null;
  if (loaded) return cached;
  try {
    cached = (await SecureStore.getItemAsync(KEY)) ?? null;
  } catch {
    // Simulator keychain quirks must not break the app; fall through to env.
    cached = null;
  }
  loaded = true;
  return cached ?? fromEnv;
}

/**
 * The token to send, if any. Runtime-set wins over the build-time environment
 * variable, so signing in on the device overrides a stale inlined token.
 */
export function getDevToken(): string | null {
  if (!__DEV__) return null;
  return cached ?? fromEnv;
}

/** Persist a token (or clear it with null). */
export async function setDevToken(token: string | null): Promise<void> {
  if (!__DEV__) return;
  cached = token;
  loaded = true;
  try {
    if (token) await SecureStore.setItemAsync(KEY, token);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Persistence is best-effort — the in-memory value still works this session.
  }
}

/** Where the current token came from, for the dev status line. */
export function devTokenSource(): "device" | "env" | "none" {
  if (!__DEV__) return "none";
  if (cached) return "device";
  if (fromEnv) return "env";
  return "none";
}
