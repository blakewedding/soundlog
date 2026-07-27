/**
 * Root config. The `include` patterns and pool settings live in
 * `vitest.workspace.ts`, which splits this suite into a parallel `unit` project
 * and a single-fork `integration` one — see that file for why.
 *
 * What stays here is what is genuinely global: `globalSetup` runs once for the
 * whole run rather than once per project, which is exactly what a
 * leaked-fixture backstop needs to be.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Runs after the whole suite, pass or fail — the backstop that catches
    // fixtures a per-suite afterAll missed, and fails the run if any survive.
    globalSetup: ["./tests/support/globalTeardown.ts"],
    // Mock state must not leak between files (the 5.6.1 systemic fix).
    // Also set per-project, since a workspace project does not inherit this.
    clearMocks: true,
  },
});
