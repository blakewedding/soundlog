// What a user sees when a failure carries no readable message.
//
// A real phone photo surfaced as "API error 413" because nginx refused the body
// and answered with HTML — there was no `error` field to lift, so the status
// code went straight to the screen. Anything in front of the app (nginx,
// Varnish, Cloudflare) answers that way, so this fallback is not an edge case;
// it is what every proxy-level failure renders as.
import { describe, it, expect, afterEach, vi } from "vitest";
import { api, ApiError } from "./api";

afterEach(() => vi.restoreAllMocks());

/** A proxy-style failure: right status, HTML body, no JSON to parse. */
function htmlError(status: number) {
  return new Response("<html><head><title>413 Request Entity Too Large</title></head></html>", {
    status,
    headers: { "content-type": "text/html" },
  });
}

describe("error messages when the body is not JSON", () => {
  it("never shows a bare status code", async () => {
    for (const status of [400, 401, 403, 404, 413, 429, 500, 503]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlError(status));
      const err = (await api.myProfile().catch((e) => e)) as ApiError;
      expect(err.message, `status ${status}`).not.toMatch(/API error/);
      expect(err.message, `status ${status}`).not.toMatch(/^\d+$/);
      vi.restoreAllMocks();
    }
  });

  it("names the oversize case, which is the one that actually happened", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlError(413));
    const err = (await api.myProfile().catch((e) => e)) as ApiError;
    expect(err.status).toBe(413);
    expect(err.message).toMatch(/too large/i);
  });

  it("still prefers the server's own message when there is one", async () => {
    // The app's messages are more specific than any fallback — "That image is
    // 6.1 MB. The limit is 5 MB." beats "That file is too large to upload."
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "That image is 6.1 MB. The limit is 5 MB." }), {
        status: 413,
        headers: { "content-type": "application/json" },
      })
    );
    const err = (await api.myProfile().catch((e) => e)) as ApiError;
    expect(err.message).toMatch(/6\.1 MB/);
  });
});
