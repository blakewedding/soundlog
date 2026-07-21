/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import type { ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

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
  plugins: [react()],
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
