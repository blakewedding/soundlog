// Cover URLs are stored HTTPS-only. Two real failures depend on it: mixed
// content once the web app is on TLS (Phase 6), and iOS ATS blocking cleartext
// in release builds while Expo Go permits it.
import { describe, it, expect } from "vitest";
import { toSecureCovers, toSecureUrl } from "../../src/services/coverUrl.js";

describe("toSecureUrl", () => {
  it("upgrades the Cover Art Archive URLs the catalog actually stores", () => {
    // 77% of stored covers looked exactly like this.
    expect(
      toSecureUrl("http://coverartarchive.org/release/e685c54d/24820081496-500.jpg")
    ).toBe("https://coverartarchive.org/release/e685c54d/24820081496-500.jpg");
  });

  it("upgrades other third-party art hosts", () => {
    expect(toSecureUrl("http://i.discogs.com/abc/R-123.jpeg")).toBe(
      "https://i.discogs.com/abc/R-123.jpeg"
    );
    expect(toSecureUrl("http://i.scdn.co/image/ab67616d")).toBe(
      "https://i.scdn.co/image/ab67616d"
    );
  });

  it("preserves the path, query and fragment exactly", () => {
    expect(toSecureUrl("http://example.test/a/b.jpg?w=500&h=500#x")).toBe(
      "https://example.test/a/b.jpg?w=500&h=500#x"
    );
  });

  it("preserves an explicit port", () => {
    expect(toSecureUrl("http://cdn.example.test:8080/a.jpg")).toBe(
      "https://cdn.example.test:8080/a.jpg"
    );
  });

  it("leaves already-secure URLs untouched", () => {
    const url = "https://coverartarchive.org/release/x/front-500.jpg";
    expect(toSecureUrl(url)).toBe(url);
  });

  it("passes through null and undefined rather than inventing a URL", () => {
    expect(toSecureUrl(null)).toBeNull();
    expect(toSecureUrl(undefined)).toBeUndefined();
  });

  it("ignores non-http schemes", () => {
    expect(toSecureUrl("data:image/png;base64,iVBOR")).toBe("data:image/png;base64,iVBOR");
    expect(toSecureUrl("//cdn.example.test/a.jpg")).toBe("//cdn.example.test/a.jpg");
  });

  it("leaves local hosts alone — they have no TLS to upgrade to", () => {
    // Rewriting these would turn a working dev URL into a broken one.
    for (const url of [
      "http://localhost:4000/covers/1.jpg",
      "http://127.0.0.1:4000/covers/1.jpg",
      "http://192.168.1.151:4000/covers/1.jpg",
      "http://10.0.0.5/a.jpg",
      "http://172.16.0.9/a.jpg",
      "http://169.254.1.1/a.jpg",
    ]) {
      expect(toSecureUrl(url)).toBe(url);
    }
  });

  it("is case-insensitive about the scheme", () => {
    expect(toSecureUrl("HTTP://coverartarchive.org/a.jpg")).toBe(
      "https://coverartarchive.org/a.jpg"
    );
  });

  it("is idempotent", () => {
    const once = toSecureUrl("http://coverartarchive.org/a.jpg");
    expect(toSecureUrl(once)).toBe(once);
  });

  it("makes no network call — a transient upstream 500 must not lose artwork", () => {
    // CLAUDE.md §1: the Cover Art Archive returns intermittent 500s, so any
    // verify-then-discard approach would delete good covers. This is a pure
    // rewrite; if it ever starts fetching, this test's timing would not catch
    // it but the absence of async will.
    expect(toSecureUrl("http://coverartarchive.org/a.jpg")).not.toBeInstanceOf(Promise);
  });
});

describe("toSecureCovers", () => {
  it("secures both sides of the thumb/large pair", () => {
    expect(
      toSecureCovers({
        thumb: "http://coverartarchive.org/a-250.jpg",
        large: "http://coverartarchive.org/a-1200.jpg",
      })
    ).toEqual({
      thumb: "https://coverartarchive.org/a-250.jpg",
      large: "https://coverartarchive.org/a-1200.jpg",
    });
  });

  it("handles a partially-resolved pair", () => {
    expect(toSecureCovers({ thumb: "http://x.test/a.jpg", large: null })).toEqual({
      thumb: "https://x.test/a.jpg",
      large: null,
    });
  });

  it("keeps any extra fields on the object", () => {
    const covers = { thumb: "http://x.test/a.jpg", large: null, source: "caa" };
    expect(toSecureCovers(covers).source).toBe("caa");
  });
});
