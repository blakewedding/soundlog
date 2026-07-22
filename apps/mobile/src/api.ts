import Constants from "expo-constants";
import type { FeedItem, Paginated } from "@soundlog/shared";
import { describeApiHostProblem, resolveApiBaseUrl } from "./apiHost";

// Where the API lives. See apiHost.ts for the resolution order — briefly:
// an explicit setting wins, otherwise development reuses the Expo bundler's own
// LAN host so the app follows the machine it was launched from.
const resolved = resolveApiBaseUrl({
  // `extra.apiUrl` is untyped and passes through Expo's config serialiser —
  // resolveApiBaseUrl accepts it as `unknown` and validates. Phase 6 sets it
  // for production builds; it is absent in development.
  configuredUrl: process.env.EXPO_PUBLIC_API_URL ?? Constants.expoConfig?.extra?.apiUrl,
  expoHostUri: Constants.expoConfig?.hostUri ?? null,
  apiPort: process.env.EXPO_PUBLIC_API_PORT ?? "4000",
  isDev: __DEV__,
});

export const API_BASE_URL = resolved.baseUrl;
export const API_BASE_SOURCE = resolved.source;

const hostProblem = describeApiHostProblem(resolved, __DEV__);
if (hostProblem) console.warn(`[api] ${hostProblem}`);

// Mobile auth (expo-auth-session) is a later deliverable; until then a dev token
// can be supplied via env so the feed can be exercised against a real account.
const DEV_TOKEN = process.env.EXPO_PUBLIC_DEV_TOKEN;

export class UnauthenticatedError extends Error {}

/**
 * A request that never reached the server. Distinguished from an HTTP error
 * because the two have completely different causes on a device — unreachable
 * host versus a rejected request — and the fix for the first is almost always
 * the API base URL, so the message names it.
 */
export class ApiUnreachableError extends Error {
  constructor(public readonly url: string, cause: unknown) {
    super(
      `Couldn't reach the API at ${url}. ` +
        (__DEV__
          ? "Check the API is running and that this device is on the same network as your Mac."
          : "Check your connection.")
    );
    this.name = "ApiUnreachableError";
    this.cause = cause;
  }
}

async function get<T>(path: string): Promise<T> {
  const url = `${API_BASE_URL}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: DEV_TOKEN ? { Authorization: `Bearer ${DEV_TOKEN}` } : {},
    });
  } catch (err) {
    // fetch rejects (rather than resolving non-2xx) only when the request never
    // completed: DNS, refused connection, wrong network, TLS.
    throw new ApiUnreachableError(url, err);
  }

  if (res.status === 401) throw new UnauthenticatedError("Sign in to see your feed");
  if (!res.ok) throw new Error(`Request failed (${res.status}) for ${path}`);
  return (await res.json()) as T;
}

export async function getFeed(cursor?: string): Promise<Paginated<FeedItem>> {
  return get<Paginated<FeedItem>>(
    `/api/feed?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
  );
}
