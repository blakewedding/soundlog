/**
 * Two projects, because the two kinds of test here have incompatible needs.
 *
 * ## Why integration runs in ONE fork, sequentially
 *
 * Integration tests share Postgres, Redis and Elasticsearch — one database, one
 * index, one keyspace. Vitest's default is to run test FILES in parallel across
 * workers, so any assertion about global state is really an assertion about
 * "global state plus whatever every other file happened to be doing at that
 * instant". Those tests pass alone and fail together, and which one fails
 * depends on scheduling, so the failure moves every run and never reproduces
 * where you're looking.
 *
 * This is the THIRD documented instance of the class, which is why it is now
 * fixed as a class rather than per-instance:
 *
 *   * the RUN-collision teardown,
 *   * tabbedSearch,
 *   * and in 6.2a, `prewarm`'s `prisma.release.count()` before/after a sweep,
 *     which read a release seeded by `discography.test.ts` as the pre-warmer
 *     creating a row. That one was reproduced on a clean tree at a4d8ae6 with
 *     none of the 6.2 work present — it was latent, and adding two unrelated
 *     unit files was enough to shuffle the scheduling and surface it.
 *
 * `singleFork` costs wall-clock and buys determinism. That is the right trade
 * for a suite whose job is to tell you whether something is broken: a suite
 * that is red for reasons unrelated to the change in front of you is a suite
 * people learn to re-run instead of read, and at that point it has stopped
 * working as a signal.
 *
 * Note this does NOT make the tests order-independent — it makes them
 * order-DETERMINISTIC. A test that leaks state still poisons its successors;
 * it now just does so reproducibly, which is the difference between a bug you
 * can chase and one you can only argue about.
 *
 * ## Why unit tests stay parallel
 *
 * They touch nothing shared — pure functions, and a couple that write to their
 * own `mkdtemp` directory. There is no reason to make them slow.
 */
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "unit",
      include: ["tests/unit/**/*.test.ts"],
      // Mock state must not leak between files (the 5.6.1 systemic fix).
      clearMocks: true,
    },
  },
  {
    test: {
      name: "integration",
      include: ["tests/integration/**/*.test.ts"],
      clearMocks: true,
      // One fork, one file at a time. See the header.
      pool: "forks",
      poolOptions: { forks: { singleFork: true } },
      // Sequential integration tests take longer end to end than the same work
      // spread across workers; the per-test default was tuned when they ran
      // concurrently and several are already at 60s individually.
      testTimeout: 120_000,
      hookTimeout: 120_000,
    },
  },
]);
