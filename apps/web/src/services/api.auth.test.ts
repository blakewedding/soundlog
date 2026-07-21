// Phase 5.6.1 regression — a session older than the 15-minute access-token TTL
// silently failed every write ("Log listen" appeared to do nothing). request()
// now redeems the httpOnly refresh cookie once on a 401 and replays the request.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, setAccessToken } from "./api";

const realFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => setAccessToken("stale-token"));
afterEach(() => {
  globalThis.fetch = realFetch;
  setAccessToken(null);
});

describe("request() 401 handling", () => {
  it("refreshes the access token and replays the request", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get("Authorization");
      calls.push(`${url} :: ${auth ?? "none"}`);

      if (url.includes("/api/auth/refresh")) return jsonResponse({ accessToken: "fresh-token" });
      // The stale token is rejected; the fresh one is accepted.
      if (auth === "Bearer stale-token") return jsonResponse({ error: "expired" }, 401);
      return jsonResponse({ log: { id: "l1" } }, 201);
    }) as typeof fetch;

    await expect(api.logListen("r1")).resolves.toEqual({ log: { id: "l1" } });

    // Original attempt → refresh → replay with the new token.
    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain("stale-token");
    expect(calls[1]).toContain("/api/auth/refresh");
    expect(calls[2]).toContain("fresh-token");
  });

  it("gives up cleanly when the refresh token is also dead", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/refresh")) return jsonResponse({ error: "no" }, 401);
      return jsonResponse({ error: "Invalid or expired access token" }, 401);
    }) as typeof fetch;

    // Surfaces as a real 401 the UI can explain — not an infinite refresh loop.
    await expect(api.logListen("r1")).rejects.toMatchObject({ status: 401 });
  });

  it("does not try to refresh on an auth endpoint's own 401", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return jsonResponse({ error: "bad credentials" }, 401);
    }) as typeof fetch;

    await expect(api.login({ email: "a@b.c", password: "nope" })).rejects.toMatchObject({
      status: 401,
    });
    // Exactly one call: the login itself. No refresh recursion.
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/api/auth/login");
  });
});
