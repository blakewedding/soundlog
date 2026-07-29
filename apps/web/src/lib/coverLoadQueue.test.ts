// The cover concurrency gate.
//
// It replaced a lifetime budget that measurably worked and was wrong: it killed
// the storm (1,647 requests → 273, 778 abandoned → 0) while leaving tiles
// someone was actively looking at as permanent placeholders, because a spent
// budget never refills.
//
// So the property that matters here is not "how many" but "eventually all, a
// few at a time". Every test below is about that distinction.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { acquireCoverSlot, coverQueueStats, __resetCoverQueue } from "./coverLoadQueue";

beforeEach(() => {
  __resetCoverQueue();
  vi.useRealTimers();
});

describe("coverLoadQueue", () => {
  it("grants up to the limit immediately and queues the rest", () => {
    const granted: number[] = [];
    const releases = Array.from({ length: 10 }, (_, i) =>
      acquireCoverSlot(() => granted.push(i))
    );

    expect(granted).toEqual([0, 1, 2, 3, 4, 5]);
    expect(coverQueueStats()).toEqual({ inFlight: 6, queued: 4 });
    releases.forEach((r) => r());
  });

  it("REFILLS as requests complete — the whole point of the change", () => {
    const granted: number[] = [];
    const releases = Array.from({ length: 10 }, (_, i) =>
      acquireCoverSlot(() => granted.push(i))
    );
    expect(granted).toHaveLength(6);

    // Finish three. Three more must start — a budget would have stayed spent,
    // which is exactly the placeholder-forever failure.
    releases[0]();
    releases[1]();
    releases[2]();
    expect(granted).toHaveLength(9);

    releases.forEach((r) => r());
    expect(granted).toHaveLength(10);
    expect(coverQueueStats()).toEqual({ inFlight: 0, queued: 0 });
  });

  it("serves the NEWEST waiter first, because that is what is on screen", () => {
    // Fill every slot so the next arrivals must queue.
    const holding = Array.from({ length: 6 }, () => acquireCoverSlot(() => {}));

    const order: string[] = [];
    acquireCoverSlot(() => order.push("scrolled-past"));
    acquireCoverSlot(() => order.push("also-past"));
    acquireCoverSlot(() => order.push("on-screen-now"));

    holding[0]();
    // LIFO: during a fast scroll the last tile to ask is the one being looked
    // at. FIFO would spend the freed slot on a tile already off screen.
    expect(order).toEqual(["on-screen-now"]);
    holding.slice(1).forEach((r) => r());
  });

  it("a tile that goes away before its turn gives up its place", () => {
    const holding = Array.from({ length: 6 }, () => acquireCoverSlot(() => {}));
    const granted: string[] = [];

    const cancelled = acquireCoverSlot(() => granted.push("gone"));
    acquireCoverSlot(() => granted.push("still-here"));

    cancelled(); // unmounted while queued
    expect(coverQueueStats().queued).toBe(1);

    holding[0]();
    expect(granted).toEqual(["still-here"]);
    holding.slice(1).forEach((r) => r());
  });

  it("releasing twice does not invent a slot", () => {
    const holding = Array.from({ length: 6 }, () => acquireCoverSlot(() => {}));
    const granted: string[] = [];
    acquireCoverSlot(() => granted.push("next"));

    holding[0]();
    holding[0](); // double release — onLoad AND the effect cleanup can both fire
    expect(granted).toEqual(["next"]);
    // If the double release had decremented twice, inFlight would be 5 and a
    // seventh request could run concurrently.
    expect(coverQueueStats().inFlight).toBe(6);
    holding.slice(1).forEach((r) => r());
  });

  it("force-releases a slot whose image never reports, rather than deadlocking", () => {
    vi.useFakeTimers();
    __resetCoverQueue();
    const granted: string[] = [];
    // Six that will never call back — a stalled connection, which is exactly
    // what the storm produced.
    Array.from({ length: 6 }, (_, i) => acquireCoverSlot(() => granted.push(`stalled${i}`)));
    acquireCoverSlot(() => granted.push("waiting"));

    expect(granted).toHaveLength(6);
    vi.advanceTimersByTime(15_001);
    // The valve opened and the queue moved on.
    expect(granted).toContain("waiting");
    vi.useRealTimers();
  });
});
