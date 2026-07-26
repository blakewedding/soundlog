import { describe, expect, it } from "vitest";
import {
  ambientTier,
  lowerPriorityOf,
  PriorityConcurrencyGate,
  PriorityRateGate,
  runAtTier,
  type UpstreamTier,
} from "../../src/services/upstreamPriority.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("PriorityRateGate", () => {
  it("keeps consecutive dispatches at least minGap apart", async () => {
    const gate = new PriorityRateGate(60, "test");
    const at: number[] = [];

    for (let i = 0; i < 4; i++) {
      await gate.acquire("interactive");
      at.push(Date.now());
    }

    // The rate is MusicBrainz's policy, not our knob — priority must never buy
    // extra throughput, only a different order.
    for (let i = 1; i < at.length; i++) {
      expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(55); // 60ms, minus timer slop
    }
  });

  it("dispatches an interactive caller ahead of already-queued browse work", async () => {
    const gate = new PriorityRateGate(60, "test");
    const order: string[] = [];

    // Take the immediately-available slot so the gate is spacing from here on.
    await gate.acquire("browse");

    const queued = [
      gate.acquire("browse").then(() => order.push("browse-1")),
      gate.acquire("browse").then(() => order.push("browse-2")),
      gate.acquire("background").then(() => order.push("background")),
    ];
    // Arrives last, goes first: this is the whole of 6.1.4.
    queued.push(gate.acquire("interactive").then(() => order.push("interactive")));

    await Promise.all(queued);

    expect(order[0]).toBe("interactive");
    // browse outranks background, and is FIFO within its own tier.
    expect(order).toEqual(["interactive", "browse-1", "browse-2", "background"]);
  });

  it("selects at dispatch time, so a click arriving mid-wait does not lose a slot", async () => {
    const gate = new PriorityRateGate(80, "test");
    const order: string[] = [];

    await gate.acquire("browse"); // gate is now spacing for 80ms
    const browse = gate.acquire("browse").then(() => order.push("browse"));

    // Land the interactive call partway through that wait — the common case in
    // production, since the gate spends nearly all its time waiting.
    await sleep(30);
    const interactive = gate.acquire("interactive").then(() => order.push("interactive"));

    await Promise.all([browse, interactive]);
    expect(order).toEqual(["interactive", "browse"]);
  });

  it("reports queue depth per tier", async () => {
    const gate = new PriorityRateGate(60, "test");
    await gate.acquire("interactive");

    const pending = [gate.acquire("browse"), gate.acquire("browse"), gate.acquire("interactive")];
    expect(gate.depth()).toEqual({ interactive: 1, browse: 2, background: 0 });

    await Promise.all(pending);
    expect(gate.depth()).toEqual({ interactive: 0, browse: 0, background: 0 });
  });
});

describe("PriorityConcurrencyGate", () => {
  it("never exceeds its total concurrency", async () => {
    const gate = new PriorityConcurrencyGate(3, 1, "test");
    let active = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 12 }, () =>
        gate.run("browse", async () => {
          active++;
          peak = Math.max(peak, active);
          await sleep(10);
          active--;
        })
      )
    );

    // Speculative work is additionally capped at total - reserved.
    expect(peak).toBeLessThanOrEqual(2);
    expect(gate.stats().active).toBe(0);
  });

  it("reserves capacity so interactive work never waits for a full speculative grid", async () => {
    const gate = new PriorityConcurrencyGate(6, 2, "test");
    const finished: string[] = [];
    let releaseSpeculative: (() => void) | null = null;
    const held = new Promise<void>((r) => (releaseSpeculative = r));

    // 37 speculative tiles — the measured before — all wanting slots at once.
    const speculative = Array.from({ length: 37 }, (_, i) =>
      gate.run("browse", async () => {
        await held;
        finished.push(`tile-${i}`);
      })
    );

    await sleep(10); // let them fill everything they are allowed to fill

    // The cover of the release someone just opened must not be stuck behind them.
    const interactive = gate.run("interactive", async () => {
      finished.push("hero-cover");
    });
    await interactive;

    expect(finished).toEqual(["hero-cover"]);

    releaseSpeculative!();
    await Promise.all(speculative);
    expect(finished.length).toBe(38);
  });

  it("releases its slot when the work throws", async () => {
    const gate = new PriorityConcurrencyGate(1, 0, "test");
    await expect(
      gate.run("interactive", async () => {
        throw new Error("upstream died");
      })
    ).rejects.toThrow("upstream died");

    // A leaked slot on the error path would wedge the gate permanently — the
    // failure mode that matters, since upstream errors are the normal case here.
    expect(gate.stats().active).toBe(0);
    await expect(gate.run("interactive", async () => "recovered")).resolves.toBe("recovered");
  });
});

describe("tier context", () => {
  it("defaults to interactive when nothing set one", () => {
    expect(ambientTier()).toBe("interactive");
  });

  it("propagates through awaits and into detached promises", async () => {
    let seenAfterAwait: UpstreamTier | null = null;
    let seenInDetached: UpstreamTier | null = null;

    await runAtTier("background", async () => {
      await sleep(5);
      seenAfterAwait = ambientTier();

      // Enrichment is detached from the request that started it — the context
      // has to survive that, which is why this is an async context and not a
      // parameter threaded by hand.
      const detached = (async () => {
        await sleep(5);
        seenInDetached = ambientTier();
      })();
      await detached;
    });

    expect(seenAfterAwait).toBe("background");
    expect(seenInDetached).toBe("background");
    expect(ambientTier()).toBe("interactive"); // and does not leak back out
  });

  it("lowerPriorityOf never lets context be upgraded", () => {
    expect(lowerPriorityOf("background", "interactive")).toBe("background");
    expect(lowerPriorityOf("interactive", "browse")).toBe("browse");
    expect(lowerPriorityOf("browse", "browse")).toBe("browse");
    expect(lowerPriorityOf("interactive", "interactive")).toBe("interactive");
  });
});
