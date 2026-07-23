import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Runs after the whole suite, pass or fail — the backstop that catches
    // fixtures a per-suite afterAll missed, and fails the run if any survive.
    globalSetup: ["./tests/support/globalTeardown.ts"],
    // Mock state must not leak between files (the 5.6.1 systemic fix).
    clearMocks: true,
  },
});
