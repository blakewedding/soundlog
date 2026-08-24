/**
 * 6.3e follow-up #1 — measure before retuning.
 *
 * These pin the fields the retuning decision will actually rest on, because a
 * counter that is subtly wrong is worse than no counter: it produces a
 * confident decision from a false premise, which is how the 54% nearly became
 * a gate change.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { UpstreamTelemetry } from "../../src/services/upstreamTelemetry.js";

let t: UpstreamTelemetry;
const T0 = 1_760_000_000_000; // fixed clock: no Date.now() in assertions
beforeEach(() => {
  t = new UpstreamTelemetry("test");
});

describe("outcome accounting", () => {
  it("separates the three §1 outcomes, and 'threw' from a retryable attempt", () => {
    t.record({ tier: "interactive", outcome: "ok", status: 200, attempt: 1 }, T0);
    t.record({ tier: "interactive", outcome: "absent", status: 404, attempt: 1 }, T0);
    t.record({ tier: "background", outcome: "retryable", status: 503, attempt: 1 }, T0);
    t.record({ tier: "background", outcome: "threw", attempt: 4 }, T0);

    const w = t.snapshot(T0).last1m;
    expect(w).toMatchObject({ requests: 4, ok: 1, absent: 1, retryable: 1, threw: 1 });
    // A per-attempt 503 and a caller actually being told "we could not tell"
    // are different facts and must not be summed into one.
    expect(w.byStatus).toEqual({ 200: 1, 404: 1, 503: 1 });
  });

  it("computes the retryable RATE — the number the 54% is compared against", () => {
    for (let i = 0; i < 37; i++)
      t.record({ tier: "background", outcome: "retryable", status: 503, attempt: 1 }, T0);
    for (let i = 0; i < 31; i++)
      t.record({ tier: "background", outcome: "ok", status: 200, attempt: 1 }, T0);

    expect(t.snapshot(T0).last1m.retryableRate).toBeCloseTo(37 / 68, 4);
  });

  it("distinguishes a flaky upstream from a broken one", () => {
    // A 503 that succeeds on attempt two is congestion.
    t.record({ tier: "browse", outcome: "retryable", status: 503, attempt: 1 }, T0);
    t.record({ tier: "browse", outcome: "ok", status: 200, attempt: 2 }, T0);

    const w = t.snapshot(T0).last1m;
    expect(w.retries).toBe(1);
    expect(w.retriedAndSucceeded).toBe(1);
  });

  it("records what MusicBrainz asks of us in its own words", () => {
    t.record({ tier: "browse", outcome: "retryable", status: 503, retryAfterSeconds: 1, attempt: 1 }, T0);
    t.record({ tier: "browse", outcome: "retryable", status: 503, retryAfterSeconds: 5, attempt: 1 }, T0);

    expect(t.snapshot(T0).last1m.retryAfter).toEqual({ seen: 2, maxSeconds: 5, meanSeconds: 3 });
  });

  it("attributes by tier, so a sweep problem is distinguishable from an upstream one", () => {
    t.record({ tier: "background", outcome: "retryable", status: 503, attempt: 1 }, T0);
    t.record({ tier: "background", outcome: "retryable", status: 503, attempt: 1 }, T0);
    t.record({ tier: "interactive", outcome: "ok", status: 200, attempt: 1 }, T0);

    expect(t.snapshot(T0).last1m.byTier).toEqual({ background: 2, interactive: 1 });
  });
});

describe("observed inter-request gap — the compliance evidence", () => {
  it("reports percentiles and the MINIMUM, which is what would prove a violation", () => {
    for (const gapMs of [1100, 1150, 1200, 1101, 1105]) {
      t.record({ tier: "browse", outcome: "ok", status: 200, gapMs, attempt: 1 }, T0);
    }
    const g = t.snapshot(T0).observedGap;
    expect(g.samples).toBe(5);
    expect(g.minMs).toBe(1100);
    expect(g.p50Ms).toBeGreaterThanOrEqual(1100);
  });

  it("surfaces a gap UNDER the configured minimum — something bypassing the gate", () => {
    t.record({ tier: "browse", outcome: "ok", gapMs: 1100, attempt: 1 }, T0);
    t.record({ tier: "browse", outcome: "ok", gapMs: 40, attempt: 1 }, T0);
    expect(t.snapshot(T0).observedGap.minMs).toBe(40);
  });
});

describe("windows are bounded and time-scoped", () => {
  it("ages events out of the 1m window while keeping them in 24h", () => {
    t.record({ tier: "browse", outcome: "ok", status: 200, attempt: 1 }, T0);
    const later = T0 + 5 * 60_000; // five minutes on

    expect(t.snapshot(later).last1m.requests).toBe(0);
    expect(t.snapshot(later).last15m.requests).toBe(1);
    expect(t.snapshot(later).last24h.requests).toBe(1);
  });

  it("reuses a ring slot rather than growing, a full day later", () => {
    t.record({ tier: "browse", outcome: "ok", status: 200, attempt: 1 }, T0);
    const nextDay = T0 + 24 * 60 * 60_000;
    t.record({ tier: "browse", outcome: "ok", status: 200, attempt: 1 }, nextDay);

    // The old event occupied the same slot and must not still be counted.
    expect(t.snapshot(nextDay).last24h.requests).toBe(1);
  });
});
