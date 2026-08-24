import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import {
  PriorityRateGate,
  onStarvation,
  starvationStats,
  __resetStarvationStats,
  type StarvationEvent,
} from "../../src/services/upstreamPriority.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => __resetStarvationStats());
afterEach(() => vi.restoreAllMocks());

/**
 * The Dylan wedge, in miniature.
 *
 * A `browse` discography page queues; interactive clicks keep arriving. Under
 * strict priority with no ageing the browse waiter never reaches the front, the
 * progress line freezes at "200 of 1192", and every poll answers `assembling`.
 */
async function starve(gate: PriorityRateGate, ms: number) {
  // Consume the gate's one immediately-available slot, so everything after this
  // is genuinely spacing-limited and therefore genuinely queued.
  await gate.acquire("interactive");

  let dispatched = false;
  const browse = gate.acquire("browse").then(() => {
    dispatched = true;
  });

  const clicks: Array<Promise<void>> = [];
  const until = Date.now() + ms;
  while (Date.now() < until) {
    clicks.push(gate.acquire("interactive"));
    await sleep(5);
  }
  return { browse, clicks, wasDispatched: () => dispatched };
}

describe("starvation tripwire", () => {
  it("reports a browse waiter WHILE it is starving, not only once it recovers", async () => {
    const events: StarvationEvent[] = [];
    const previous = onStarvation((e) => events.push(e));
    try {
      // 50ms threshold; ageing left at its default so nothing rescues the
      // waiter and it stays genuinely wedged for the whole window.
      const gate = new PriorityRateGate(10, "test", 50);
      const { browse, clicks, wasDispatched } = await starve(gate, 600);
      await Promise.all(clicks);

      // Precondition: it really was starved, for 12x the threshold.
      expect(wasDispatched()).toBe(false);

      // Before 6.3e this was zero: `waited` was computed in take(), so a waiter
      // that is never dispatched was never measured.
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].tier).toBe("browse");
      expect(events[0].waitedMs).toBeGreaterThanOrEqual(50);
      expect(starvationStats().events).toBe(events.length);

      // Drain: leaving a live gate with a queued waiter would let it report
      // into the NEXT test's sink, which is a flake waiting to happen.
      await browse;
    } finally {
      onStarvation(previous);
    }
  });

  it("does not report a tier that is merely queued briefly", async () => {
    const events: StarvationEvent[] = [];
    const previous = onStarvation((e) => events.push(e));
    try {
      const gate = new PriorityRateGate(10, "test", 5_000);
      const { clicks } = await starve(gate, 200);
      await Promise.all(clicks);
      expect(events).toHaveLength(0);
    } finally {
      onStarvation(previous);
    }
  });
});

describe("priority ageing", () => {
  it("dispatches a starved browse waiter once it ages past the threshold", async () => {
    // 60ms promotion threshold against sustained interactive load.
    const gate = new PriorityRateGate(10, "test", 5_000, 2_000, 60);
    const { browse, clicks, wasDispatched } = await starve(gate, 400);

    // Without ageing this promise never settles while clicks keep arriving.
    await browse;
    await Promise.all(clicks);

    expect(wasDispatched()).toBe(true);
    // It jumped a queue that had interactive work in it — that is the promotion.
    expect(starvationStats().promotions).toBeGreaterThan(0);
  });

  it("still buys ORDER and never throughput — the 1 req/s contract is untouched", async () => {
    const gate = new PriorityRateGate(60, "test", 5_000, 2_000, 60);
    const at: number[] = [];
    await gate.acquire("browse");
    at.push(Date.now());

    const all = [
      gate.acquire("browse").then(() => at.push(Date.now())),
      gate.acquire("interactive").then(() => at.push(Date.now())),
      gate.acquire("background").then(() => at.push(Date.now())),
    ];
    await Promise.all(all);

    for (let i = 1; i < at.length; i++) {
      expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(55);
    }
  });
});
