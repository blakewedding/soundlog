import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * The cookie-origin policy, made enforceable.
 *
 * Two rules that were previously prose in a README and a `NODE_ENV` check that
 * did not mean what it looked like:
 *
 *  1. `CLIENT_URL` is THE APP ORIGIN — one origin serves the SPA and /api, so
 *     the refresh cookie is same-origin by construction. Dev used 127.0.0.1
 *     while the app was actually browsed on localhost; browsers keep separate
 *     cookie jars per host, so the session was invisible where it mattered.
 *  2. The cookie's `Secure` flag follows the SCHEME THE APP IS SERVED OVER, not
 *     NODE_ENV. They disagree exactly where it hurts: this stack runs
 *     NODE_ENV=production over http locally, and a Secure cookie there is
 *     accepted by Chrome and dropped by Safari — an auth bug with no error.
 */
async function loadEnv(clientUrl: string, nodeEnv = "production") {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/db");
  vi.stubEnv("JWT_SECRET", "test-secret-at-least-16-chars");
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.stubEnv("CLIENT_URL", clientUrl);
  return import("../../src/config/env.js");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("app origin and cookie policy", () => {
  it("marks the refresh cookie Secure when the app is served over https", async () => {
    const { cookieSecure, appOrigin } = await loadEnv("https://soundlog.example.com");
    expect(cookieSecure).toBe(true);
    expect(appOrigin.hostname).toBe("soundlog.example.com");
  });

  it("does NOT mark it Secure when the app is served over http, production or not", async () => {
    // The production stack proving itself locally. Secure here would be dropped
    // by Safari and the session would vanish on every reload.
    expect((await loadEnv("http://localhost:8081", "production")).cookieSecure).toBe(false);
    expect((await loadEnv("http://localhost:3000", "development")).cookieSecure).toBe(false);
  });

  it("warns when a real production deployment is served over plain http", async () => {
    const { warnIfInsecureOrigin } = await loadEnv("http://soundlog.example.com", "production");
    const log = vi.fn();
    warnIfInsecureOrigin(log);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/not be marked Secure/i);
  });

  it("stays quiet for loopback, which is the local production stack", async () => {
    for (const origin of ["http://localhost:8081", "http://127.0.0.1:8081"]) {
      const { warnIfInsecureOrigin } = await loadEnv(origin, "production");
      const log = vi.fn();
      warnIfInsecureOrigin(log);
      expect(log).not.toHaveBeenCalled();
    }
  });

  it("defaults to the origin the app is actually browsed on, not the loopback IP", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/db");
    vi.stubEnv("JWT_SECRET", "test-secret-at-least-16-chars");
    vi.stubEnv("CLIENT_URL", undefined); // absent, so the default applies
    const { env } = await import("../../src/config/env.js");
    expect(env.CLIENT_URL).toBe("http://localhost:3000");
  });

  it("refuses to boot on a host:port that only looks like a URL", async () => {
    // `new URL("localhost:3000")` PARSES — scheme "localhost:", path "3000" —
    // so z.string().url() accepts it and the cookie policy would then be
    // derived from a protocol of "localhost:". The scheme check is what
    // actually rejects the typo.
    await expect(loadEnv("localhost:3000")).rejects.toThrow(/absolute http/i);
    await expect(loadEnv("ftp://soundlog.example.com")).rejects.toThrow(/absolute http/i);
  });
});
