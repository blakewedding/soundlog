/**
 * What we actually ask MusicBrainz for, and what it actually says back.
 *
 * ## Why this exists before any gate retuning (6.3e follow-up #1)
 *
 * A single sequential, strictly rate-compliant run measured **MusicBrainz
 * returning 503 on 37 of 68 requests — 54%**. That number is alarming and
 * almost useless on its own: one window, one IP, one request shape. It cannot
 * distinguish "our pattern is wrong" from "MusicBrainz was unwell that hour",
 * and those two have opposite fixes. Retuning the gate on it would trade real
 * latency for a guess.
 *
 * It is also now known to have been measured against a load we were partly
 * generating ourselves — fused artist credits fired at the artist search — so
 * the baseline has to be re-taken with that junk gone before it means anything.
 *
 * So: measure first. The fields here are chosen to answer specific questions,
 * not to be comprehensive:
 *
 *  - **`gapMs` percentiles** answer "are we ACTUALLY under 1 req/s?", which the
 *    gate's configuration only promises. Configuration is an intention; this is
 *    the observation, and where they disagree the observation wins.
 *  - **`retryAfterSeconds`** is MusicBrainz telling us, in its own words,
 *    whether it considers us the problem. It is the single most direct signal
 *    available and we were previously discarding it unread.
 *  - **outcome × tier** shows WHICH work is failing. If 503s concentrate in
 *    `background`, that is a sweep problem; spread evenly, it is upstream.
 *  - **`retriedAndSucceeded`** separates a flaky upstream from a broken one: a
 *    503 that succeeds on attempt two is congestion, one that never succeeds is
 *    something else.
 *
 * ## Bounded by construction
 *
 * Per-minute buckets in a fixed ring (24h), plus a bounded reservoir of recent
 * gaps. Nothing grows without limit, nothing is written to disk, and the whole
 * thing is dropped on restart — this is a diagnostic, not a record. Per §7a the
 * API is single-instance, so in-memory is an accurate view rather than a shard
 * of one.
 */
import type { UpstreamTier } from "./upstreamPriority.js";

/** The §1 outcomes, as telemetry sees them. */
export type UpstreamOutcome =
  | "ok" // 2xx with a body
  | "absent" // definitive 4xx — a real "no such thing"
  | "retryable" // 429/5xx/timeout — we could not tell
  | "threw"; // attempts exhausted; the caller got an UpstreamUnavailableError

export interface UpstreamEvent {
  tier: UpstreamTier;
  outcome: UpstreamOutcome;
  /** HTTP status, when there was a response at all. */
  status?: number;
  /** `Retry-After`, in seconds, when upstream sent one. */
  retryAfterSeconds?: number;
  /** Milliseconds since the previous dispatch on this gate. */
  gapMs?: number;
  /** 1 for a first attempt; >1 means this followed a retryable failure. */
  attempt: number;
}

const MINUTE = 60_000;
const RING_MINUTES = 24 * 60;
/** Recent inter-request gaps, for percentiles. Bounded; oldest evicted. */
const GAP_SAMPLE = 512;

interface Bucket {
  /** Minute index (epoch ms / 60000) this bucket represents. */
  minute: number;
  ok: number;
  absent: number;
  retryable: number;
  threw: number;
  retries: number;
  retriedAndSucceeded: number;
  byStatus: Map<number, number>;
  byTier: Map<UpstreamTier, number>;
  retryAfterSum: number;
  retryAfterCount: number;
  retryAfterMax: number;
}

function emptyBucket(minute: number): Bucket {
  return {
    minute,
    ok: 0,
    absent: 0,
    retryable: 0,
    threw: 0,
    retries: 0,
    retriedAndSucceeded: 0,
    byStatus: new Map(),
    byTier: new Map(),
    retryAfterSum: 0,
    retryAfterCount: 0,
    retryAfterMax: 0,
  };
}

export class UpstreamTelemetry {
  private readonly ring: Array<Bucket | null> = new Array(RING_MINUTES).fill(null);
  private readonly gaps: number[] = [];
  private gapCursor = 0;

  constructor(private readonly name: string) {}

  private bucketFor(now: number): Bucket {
    const minute = Math.floor(now / MINUTE);
    const slot = minute % RING_MINUTES;
    const existing = this.ring[slot];
    // A stale bucket is one from a previous lap of the ring — reuse the slot.
    if (!existing || existing.minute !== minute) {
      const fresh = emptyBucket(minute);
      this.ring[slot] = fresh;
      return fresh;
    }
    return existing;
  }

  record(event: UpstreamEvent, now = Date.now()): void {
    const b = this.bucketFor(now);
    b[event.outcome] += 1;
    b.byTier.set(event.tier, (b.byTier.get(event.tier) ?? 0) + 1);
    if (event.status !== undefined) {
      b.byStatus.set(event.status, (b.byStatus.get(event.status) ?? 0) + 1);
    }
    if (event.attempt > 1) {
      b.retries += 1;
      if (event.outcome === "ok" || event.outcome === "absent") b.retriedAndSucceeded += 1;
    }
    if (event.retryAfterSeconds !== undefined) {
      b.retryAfterSum += event.retryAfterSeconds;
      b.retryAfterCount += 1;
      b.retryAfterMax = Math.max(b.retryAfterMax, event.retryAfterSeconds);
    }
    if (event.gapMs !== undefined && Number.isFinite(event.gapMs)) {
      if (this.gaps.length < GAP_SAMPLE) this.gaps.push(event.gapMs);
      else {
        this.gaps[this.gapCursor] = event.gapMs;
        this.gapCursor = (this.gapCursor + 1) % GAP_SAMPLE;
      }
    }
  }

  /** Aggregate the last `minutes` of buckets. */
  private window(minutes: number, now = Date.now()) {
    const cutoff = Math.floor(now / MINUTE) - minutes + 1;
    const acc = emptyBucket(0);
    for (const b of this.ring) {
      if (!b || b.minute < cutoff) continue;
      acc.ok += b.ok;
      acc.absent += b.absent;
      acc.retryable += b.retryable;
      acc.threw += b.threw;
      acc.retries += b.retries;
      acc.retriedAndSucceeded += b.retriedAndSucceeded;
      acc.retryAfterSum += b.retryAfterSum;
      acc.retryAfterCount += b.retryAfterCount;
      acc.retryAfterMax = Math.max(acc.retryAfterMax, b.retryAfterMax);
      for (const [s, n] of b.byStatus) acc.byStatus.set(s, (acc.byStatus.get(s) ?? 0) + n);
      for (const [t, n] of b.byTier) acc.byTier.set(t, (acc.byTier.get(t) ?? 0) + n);
    }
    const total = acc.ok + acc.absent + acc.retryable + acc.threw;
    return {
      requests: total,
      ok: acc.ok,
      absent: acc.absent,
      retryable: acc.retryable,
      threw: acc.threw,
      // The headline number, and the one the 54% has to be compared against
      // once the self-inflicted junk is gone.
      retryableRate: total ? Number((acc.retryable / total).toFixed(4)) : 0,
      retries: acc.retries,
      retriedAndSucceeded: acc.retriedAndSucceeded,
      byStatus: Object.fromEntries([...acc.byStatus].sort((a, b2) => a[0] - b2[0])),
      byTier: Object.fromEntries(acc.byTier),
      retryAfter: {
        seen: acc.retryAfterCount,
        maxSeconds: acc.retryAfterMax,
        meanSeconds: acc.retryAfterCount
          ? Number((acc.retryAfterSum / acc.retryAfterCount).toFixed(2))
          : 0,
      },
    };
  }

  private percentiles() {
    if (!this.gaps.length) return { samples: 0, p50Ms: 0, p99Ms: 0, minMs: 0 };
    const sorted = [...this.gaps].sort((a, b) => a - b);
    const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    return {
      samples: sorted.length,
      p50Ms: Math.round(at(0.5)),
      p99Ms: Math.round(at(0.99)),
      // The one that would prove a violation: if the SMALLEST observed gap is
      // under the configured minimum, something is bypassing the gate.
      minMs: Math.round(sorted[0]),
    };
  }

  snapshot(now = Date.now()) {
    return {
      gate: this.name,
      observedGap: this.percentiles(),
      last1m: this.window(1, now),
      last15m: this.window(15, now),
      last24h: this.window(RING_MINUTES, now),
    };
  }

  /** Test seam. */
  __reset(): void {
    this.ring.fill(null);
    this.gaps.length = 0;
    this.gapCursor = 0;
  }
}

export const mbTelemetry = new UpstreamTelemetry("mb");
