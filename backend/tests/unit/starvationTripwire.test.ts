import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import {
  PriorityConcurrencyGate,
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

describe("the CAA concurrency gate reports and ages too", () => {
  /**
   * 6.3e shipped starvation reporting on the RATE gate only. A production
   * health check then read `starvation.events: 0` beside `coverArt` holding
   * `active: 12, queued: {interactive: 45, browse: 58}` — zero was true and
   * described the wrong gate entirely. Silence read as health, again.
   */
  it("reports a starving browse waiter, and stats() is an observer", async () => {
    const events: StarvationEvent[] = [];
    const previous = onStarvation((e) => events.push(e));
    try {
      // 1 slot, 0 reserved, 40ms starvation threshold.
      const gate = new PriorityConcurrencyGate(1, 0, "caa-test", 2_000, 40);

      // Occupy the only slot with work that does not finish while we look.
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      void gate.run("interactive", () => held);

      // A browse tile queues behind it and cannot proceed.
      let dispatched = false;
      const queued = gate.run("browse", async () => {
        dispatched = true;
      });

      await sleep(120);
      expect(dispatched).toBe(false);

      // dispatch() cannot have run — no slot has freed. stats() is the only
      // observer available, and it must be one.
      const s = gate.stats();
      expect(s.active).toBe(1);
      expect(s.queued.browse).toBe(1);
      expect(s.oldestWaitMs.browse).toBeGreaterThanOrEqual(40);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].gate).toBe("caa-test");

      release();
      await queued;
    } finally {
      onStarvation(previous);
    }
  });

  it("ageing never promotes speculative work into the interactive reservation", async () => {
    // 2 slots, 1 reserved for interactive => browse may use at most 1.
    const gate = new PriorityConcurrencyGate(2, 1, "caa-res", 5_000, 10);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));

    void gate.run("browse", () => held); // browse takes its single allowed slot
    let secondBrowseRan = false;
    const second = gate.run("browse", async () => {
      secondBrowseRan = true;
    });

    // Well past the 10ms ageing threshold: the reservation must still hold.
    await sleep(80);
    expect(secondBrowseRan).toBe(false);

    release();
    await second;
    expect(secondBrowseRan).toBe(true);
  });
});
