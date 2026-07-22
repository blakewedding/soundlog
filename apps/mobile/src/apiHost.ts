/**
 * Where the mobile app's API lives.
 *
 * The problem this solves: on a phone, `localhost` is the phone. A dev build
 * pointed at `http://localhost:4000` reaches nothing, and the feed fails with a
 * network error that looks like a server problem but is a routing one.
 *
 * The dev machine's LAN address is *already known to the app* — Expo's bundler
 * told the device where to fetch JavaScript from, and Expo surfaces that as
 * `Constants.expoConfig.hostUri` ("192.168.1.151:8081"). Reusing that host with
 * the API's port means the app follows the machine it was launched from, with
 * no hardcoded IP to update when the network changes, the router reassigns a
 * lease, or someone else runs it on their own laptop.
 *
 * Resolution order, highest priority first:
 *
 *   1. `configuredUrl` — EXPO_PUBLIC_API_URL, or `extra.apiUrl` from app config.
 *      An explicit setting always wins; this is also how production gets a real
 *      API domain (Phase 6 supplies it).
 *   2. The Expo bundler's host, in development only.
 *   3. localhost — correct for a simulator sharing the host machine, and a
 *      deliberate last resort everywhere else.
 *
 * Kept free of Expo and React Native imports so the decision can be unit
 * tested directly; `api.ts` supplies the real runtime values.
 */

export type ApiHostSource = "configured" | "expo-lan" | "fallback";

export interface ResolveApiInput {
  /**
   * EXPO_PUBLIC_API_URL or app config `extra.apiUrl`.
   *
   * Deliberately `unknown`: `extra` is untyped JSON that has been through
   * Expo's config serialiser, and it does not round-trip faithfully — a
   * `"apiUrl": null` in app.json arrives as `{}`, which is truthy. Taking this
   * as `string` and trusting it crashed the app at module load on the first
   * attempt. Only an actual string is accepted.
   */
  configuredUrl?: unknown;
  /** `Constants.expoConfig.hostUri` — present only under `expo start`. */
  expoHostUri?: string | null;
  /** Port the backend listens on. */
  apiPort: string;
  /** React Native's `__DEV__`. */
  isDev: boolean;
}

export interface ResolvedApi {
  baseUrl: string;
  source: ApiHostSource;
}

/** Hosts that mean "this device", which is exactly the bug being fixed. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", ""]);

/**
 * Tunnel hostnames proxy the *bundler* port only. Appending the API port to one
 * produces a URL that resolves but refuses the connection — a worse failure
 * than admitting we don't know, because it looks like the server is down.
 */
const TUNNEL_SUFFIXES = [".exp.direct", ".ngrok.io", ".ngrok-free.app", ".trycloudflare.com"];

/** Strip the bundler port from a `host:port` pair, handling bracketed IPv6. */
export function hostFromExpoHostUri(hostUri?: string | null): string | null {
  if (!hostUri) return null;

  // hostUri is occasionally handed over with a scheme; tolerate both.
  const withoutScheme = hostUri.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const authority = withoutScheme.split("/")[0];

  let host: string;
  if (authority.startsWith("[")) {
    host = authority.slice(0, authority.indexOf("]") + 1); // keep [::1] bracketed
  } else {
    host = authority.split(":")[0];
  }

  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (LOOPBACK.has(bare)) return null;
  if (TUNNEL_SUFFIXES.some((suffix) => bare.endsWith(suffix))) return null;

  return host;
}

const stripTrailingSlash = (url: string) => url.replace(/\/+$/, "");

export function resolveApiBaseUrl(input: ResolveApiInput): ResolvedApi {
  const configured = typeof input.configuredUrl === "string" ? input.configuredUrl.trim() : "";
  if (configured) {
    return { baseUrl: stripTrailingSlash(configured), source: "configured" };
  }

  if (input.isDev) {
    const host = hostFromExpoHostUri(input.expoHostUri);
    if (host) {
      return { baseUrl: `http://${host}:${input.apiPort}`, source: "expo-lan" };
    }
  }

  return { baseUrl: `http://localhost:${input.apiPort}`, source: "fallback" };
}

/**
 * Explains an unusable resolution, or null when the result is fine.
 * A production build falling back to localhost is a misconfiguration that would
 * otherwise surface only as an unexplained network error on a user's phone.
 */
export function describeApiHostProblem(resolved: ResolvedApi, isDev: boolean): string | null {
  if (resolved.source !== "fallback") return null;

  return isDev
    ? `API base URL fell back to ${resolved.baseUrl}. On a physical device this is the phone itself, ` +
        `not your Mac. Expo did not report a usable LAN host — if you are running with --tunnel, ` +
        `set EXPO_PUBLIC_API_URL to your machine's LAN address (e.g. http://192.168.1.20:4000).`
    : `No API URL configured for this build; falling back to ${resolved.baseUrl}, which will not work. ` +
        `Set "extra.apiUrl" in the app config (or EXPO_PUBLIC_API_URL at build time).`;
}
