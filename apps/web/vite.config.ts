/// <reference types="vitest/config" />
import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import type { Plugin, ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Cloudflare Web Analytics, in our own markup instead of injected at the edge.
 *
 * Cloudflare can add this script itself, but that means the edge parses and
 * rewrites every HTML response, and the one script we serve that isn't in the
 * repo is invisible to anyone reading the source. In source it is reviewable,
 * versioned, and survives a change of CDN.
 *
 * THE TOKEN IS NOT A SECRET. It is a public site identifier — Cloudflare ships
 * it in the markup of every page it serves, so it is readable by anyone with
 * View Source. §7 governs credentials; this is not one, and putting it in .env
 * would imply a confidentiality it does not have.
 *
 * `apply: "build"` is load-bearing: a dev server that loaded the beacon would
 * report localhost page views into the production analytics and add a
 * third-party request to every hot reload.
 *
 * The src is deliberately UNVERSIONED. Edge injection points at a pinned
 * `/v<hash>` build and rotates that hash; a pinned copy in our HTML would
 * quietly serve a stale beacon that nobody remembers to bump.
 */
function cloudflareAnalytics(): Plugin {
  const token = "3fcb36cb89124455b95b7900e9d9cafd";

  // Raw markup, NOT transformIndexHtml's `attrs` map. Vite serializes those
  // values with JSON.stringify, and `data-cf-beacon` is itself a JSON document,
  // so passing it there double-encodes it:
  //
  //     data-cf-beacon="{\"token\":\"3fcb…\"}"
  //
  // An HTML parser ends that attribute at the first inner quote, so the beacon
  // loads, finds no token, and reports nothing — while View Source looks
  // roughly right. Single-quoting the attribute (Cloudflare's own documented
  // form) keeps the JSON's double quotes intact with no escaping at all.
  const snippet =
    `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" ` +
    `data-cf-beacon='{"token": "${token}"}'></script>`;

  return {
    name: "soundlog-cloudflare-analytics",
    apply: "build",
    transformIndexHtml(html) {
      // Last thing before </body> and deferred, so analytics can never delay
      // first paint or the app bundle.
      return html.replace("</body>", `    ${snippet}\n  </body>`);
    },
  };
}

/**
 * The commit the running bundle was built from, stamped in at config load.
 *
 * Exists because a device kept reproducing a bug that two real-browser
 * verifications said was fixed. Before diagnosing anything like that again, the
 * first question has to be answerable by eye: is the phone even running this
 * code? The dev build renders this in a corner (see BuildStamp).
 */
function buildStamp(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
    return `${sha}${dirty ? "+dirty" : ""}`;
  } catch {
    return "unknown";
  }
}

// While the backend hot-reloads (tsx watch restarts it on every source edit),
// port 4000 is unreachable for ~1s. Vite's default proxy reports that upstream
// ECONNREFUSED as a bare HTTP 500 — indistinguishable from a real application
// error, which makes a mid-reload login look like a server bug. Surface it as an
// explicit, transient 503 + Retry-After so it reads as "backend restarting."
const apiProxy: ProxyOptions = {
  target: "http://localhost:4000",
  changeOrigin: true,
  configure: (proxy) => {
    proxy.on("error", (_err, _req, res) => {
      // res is a ServerResponse for HTTP (has writeHead); for a WS upgrade it's
      // a raw Socket — only the HTTP case can send a status.
      if (res && "writeHead" in res && !res.headersSent) {
        res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "2" });
        res.end(JSON.stringify({ error: "Backend is restarting — retry in a moment." }));
      }
    });
  },
};

export default defineConfig({
  plugins: [react(), cloudflareAnalytics()],
  define: {
    // Read at config load, so restarting the dev server re-stamps it.
    __BUILD_STAMP__: JSON.stringify(buildStamp()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: false,
    // Zero every spy's call history between tests. Without this,
    // toHaveBeenCalledTimes() counts accumulate across cases in a file and a
    // test that passes alone fails in-suite (hit while writing the 5.6.1 log
    // listen tests). Only history is cleared — implementations survive, so
    // mocks configured in beforeEach still apply.
    clearMocks: true,
  },
  server: {
    // Listen on all interfaces so the OAuth callback landing is reachable at
    // http://127.0.0.1:3000 (CLIENT_URL) as well as localhost.
    host: true,
    port: 3000,
    proxy: {
      // Server-side hop to the backend; the browser never sees this host, and
      // Express listens on all interfaces, so localhost is fine here.
      "/api": apiProxy,
    },
  },
});
