// The three-outcome law (CLAUDE.md §1) applied to sending mail.
//
// The expensive version of this bug in this project was a rate-limited upstream
// becoming "not found". The mail equivalent is a busy provider becoming "your
// email address is invalid" — shown to a user whose address is fine, on the one
// screen where being told your address is wrong makes you give up.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "../../src/config/env.js";
import { sendEmail, emailConfigured } from "../../src/services/emailService.js";
import { UpstreamUnavailableError } from "../../src/services/musicbrainzService.js";

const MESSAGE = {
  to: "someone@example.com",
  subject: "Test",
  html: "<p>Test</p>",
  text: "Test",
};

const originalKey = env.RESEND_API_KEY;

function mockFetch(impl: () => Promise<Response> | never) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  env.RESEND_API_KEY = "re_test_key";
});

afterEach(() => {
  env.RESEND_API_KEY = originalKey;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("configuration guard", () => {
  it("reports unconfigured when no key is set", () => {
    env.RESEND_API_KEY = undefined;
    expect(emailConfigured()).toBe(false);
  });

  it("does not call out at all when unconfigured, and does not throw", async () => {
    env.RESEND_API_KEY = undefined;
    const fetchSpy = mockFetch(async () => jsonResponse(200, { id: "should-not-happen" }));

    const result = await sendEmail(MESSAGE);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: false, reason: "not-configured" });
  });
});

describe("successful send", () => {
  it("returns delivered with the provider's message id", async () => {
    mockFetch(async () => jsonResponse(200, { id: "msg_abc123" }));

    const result = await sendEmail(MESSAGE);

    expect(result).toEqual({ delivered: true, id: "msg_abc123" });
  });

  it("sends the key in an Authorization HEADER and never in the URL (§7)", async () => {
    const fetchSpy = mockFetch(async () => jsonResponse(200, { id: "msg_1" }));

    await sendEmail(MESSAGE);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(url).not.toContain("re_test_key");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
  });

  it("sends a text part alongside the html part", async () => {
    const fetchSpy = mockFetch(async () => jsonResponse(200, { id: "msg_1" }));

    await sendEmail(MESSAGE);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.text).toBeTruthy();
    expect(body.html).toBeTruthy();
    expect(body.from).toBe(env.EMAIL_FROM);
    expect(body.to).toEqual(["someone@example.com"]);
  });
});

describe("retry-able conditions THROW — they are never reported as permanent", () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    it(`throws UpstreamUnavailableError on HTTP ${status}`, async () => {
      mockFetch(async () => jsonResponse(status, { error: "busy" }));

      await expect(sendEmail(MESSAGE)).rejects.toBeInstanceOf(UpstreamUnavailableError);
    });
  }

  it("throws on a dropped socket", async () => {
    // The exact shape that 500'd an already-seeded release when an unguarded
    // Cover Art Archive fetch threw.
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(sendEmail(MESSAGE)).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });

  it("throws on a timeout", async () => {
    mockFetch(async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    });

    await expect(sendEmail(MESSAGE)).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });
});

describe("definitive rejections do NOT throw — retrying would give the same answer", () => {
  it("reports an unverified sending domain as undelivered, not unavailable", async () => {
    // Resend's answer when EMAIL_FROM is on a domain that has not finished DNS
    // verification. This is a config error, and it must not masquerade as an
    // outage that someone will wait out.
    mockFetch(async () => jsonResponse(403, { message: "domain is not verified" }));

    const result = await sendEmail(MESSAGE);

    expect(result.delivered).toBe(false);
    expect(result.reason).toContain("403");
  });

  it("reports an invalid address as undelivered", async () => {
    mockFetch(async () => jsonResponse(422, { message: "invalid to field" }));

    const result = await sendEmail(MESSAGE);

    expect(result.delivered).toBe(false);
    expect(result.reason).toContain("422");
  });
});
