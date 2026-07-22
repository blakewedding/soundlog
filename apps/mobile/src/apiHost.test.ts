// The bug this file guards: on a phone, `localhost` is the phone. A dev build
// that resolves to localhost reaches nothing, and the failure looks like a
// server outage rather than a routing mistake.
import { describe, it, expect } from "vitest";
import { describeApiHostProblem, hostFromExpoHostUri, resolveApiBaseUrl } from "./apiHost";

const dev = (over: Partial<Parameters<typeof resolveApiBaseUrl>[0]> = {}) =>
  resolveApiBaseUrl({ apiPort: "4000", isDev: true, ...over });

describe("hostFromExpoHostUri", () => {
  it("takes the host from a LAN host:port pair", () => {
    expect(hostFromExpoHostUri("192.168.1.151:8081")).toBe("192.168.1.151");
  });

  it("tolerates a scheme and a trailing path", () => {
    expect(hostFromExpoHostUri("http://192.168.1.151:8081")).toBe("192.168.1.151");
    expect(hostFromExpoHostUri("192.168.1.151:8081/_expo/loading")).toBe("192.168.1.151");
  });

  it("keeps IPv6 bracketed so it can be re-used in a URL", () => {
    expect(hostFromExpoHostUri("[fe80::1]:8081")).toBe("[fe80::1]");
  });

  it("rejects every loopback spelling — these are the bug", () => {
    for (const uri of ["localhost:8081", "127.0.0.1:8081", "[::1]:8081", "0.0.0.0:8081"]) {
      expect(hostFromExpoHostUri(uri)).toBeNull();
    }
  });

  it("rejects tunnel hosts, which proxy the bundler port only", () => {
    // Appending :4000 to a tunnel host resolves but refuses — a worse failure
    // than admitting the host is unknown.
    expect(hostFromExpoHostUri("abc-anonymous-8081.exp.direct")).toBeNull();
    expect(hostFromExpoHostUri("random-name.ngrok-free.app")).toBeNull();
  });

  it("is null for missing input", () => {
    expect(hostFromExpoHostUri(undefined)).toBeNull();
    expect(hostFromExpoHostUri(null)).toBeNull();
    expect(hostFromExpoHostUri("")).toBeNull();
  });
});

describe("resolveApiBaseUrl", () => {
  it("derives the API host from the Expo bundler in development", () => {
    expect(dev({ expoHostUri: "192.168.1.151:8081" })).toEqual({
      baseUrl: "http://192.168.1.151:4000",
      source: "expo-lan",
    });
  });

  it("follows the bundler when the LAN address changes", () => {
    // The point of deriving rather than hardcoding: a new lease just works.
    expect(dev({ expoHostUri: "10.0.0.42:8081" }).baseUrl).toBe("http://10.0.0.42:4000");
  });

  it("honours an explicit URL over the bundler host", () => {
    expect(
      dev({ configuredUrl: "https://api.soundlog.app", expoHostUri: "192.168.1.151:8081" })
    ).toEqual({ baseUrl: "https://api.soundlog.app", source: "configured" });
  });

  it("trims a trailing slash so paths don't double up", () => {
    expect(dev({ configuredUrl: "https://api.soundlog.app/" }).baseUrl).toBe(
      "https://api.soundlog.app"
    );
  });

  it("ignores a blank configured value rather than producing '/api/feed'", () => {
    expect(dev({ configuredUrl: "   ", expoHostUri: "192.168.1.151:8081" }).source).toBe("expo-lan");
  });

  it("ignores non-string config, which Expo's serialiser really does produce", () => {
    // `"apiUrl": null` in app.json arrives as `{}` — truthy. Trusting it threw
    // "configuredUrl.trim is not a function" at module load, crashing the app
    // before the first render. Anything that isn't a string is ignored.
    for (const junk of [{}, null, undefined, 42, [], true]) {
      expect(dev({ configuredUrl: junk, expoHostUri: "192.168.1.151:8081" })).toEqual({
        baseUrl: "http://192.168.1.151:4000",
        source: "expo-lan",
      });
    }
  });

  it("respects a custom API port", () => {
    expect(dev({ expoHostUri: "192.168.1.151:8081", apiPort: "5000" }).baseUrl).toBe(
      "http://192.168.1.151:5000"
    );
  });

  it("falls back to localhost when Expo reports no usable host", () => {
    // Correct for a simulator sharing the host machine; a last resort elsewhere.
    expect(dev({ expoHostUri: "localhost:8081" })).toEqual({
      baseUrl: "http://localhost:4000",
      source: "fallback",
    });
  });

  it("never derives a LAN host in production, only uses configuration", () => {
    const prod = resolveApiBaseUrl({
      apiPort: "4000",
      isDev: false,
      expoHostUri: "192.168.1.151:8081",
    });
    expect(prod.source).toBe("fallback");

    const configured = resolveApiBaseUrl({
      apiPort: "4000",
      isDev: false,
      configuredUrl: "https://api.soundlog.app",
    });
    expect(configured).toEqual({ baseUrl: "https://api.soundlog.app", source: "configured" });
  });
});

describe("describeApiHostProblem", () => {
  it("says nothing when the host was configured or derived", () => {
    expect(describeApiHostProblem({ baseUrl: "https://x", source: "configured" }, false)).toBeNull();
    expect(
      describeApiHostProblem({ baseUrl: "http://192.168.1.151:4000", source: "expo-lan" }, true)
    ).toBeNull();
  });

  it("warns in development that localhost is the phone", () => {
    const msg = describeApiHostProblem({ baseUrl: "http://localhost:4000", source: "fallback" }, true);
    expect(msg).toContain("the phone itself");
    expect(msg).toContain("EXPO_PUBLIC_API_URL");
  });

  it("warns in production that the build is misconfigured", () => {
    const msg = describeApiHostProblem({ baseUrl: "http://localhost:4000", source: "fallback" }, false);
    expect(msg).toContain("extra.apiUrl");
  });
});
