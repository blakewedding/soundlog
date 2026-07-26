/**
 * Ordering and concurrency for third-party work — Phase 6.1.4.
 *
 * ## The bug this exists to close
 *
 * The MusicBrainz gate was strictly FIFO, so a release someone was looking at
 * queued behind speculative discography work. Measured on Miles Davis (794
 * release-groups = 8 browse pages): an interactive seed's MusicBrainz work took
 * **2,294ms with an idle gate and 9,034ms mid-assembly** — 3.9×, all of it
 * queueing. Nothing distinguished the person from the background job.
 *
 * The Cover Art Archive had no gate of any kind. A cold Miles Davis discography
 * put **792 tiles in the DOM and 37 simultaneous cover requests** on the wire,
 * measured in a real browser at p50 9,406ms / max 18,332ms per tile. Under that
 * self-inflicted congestion `getCoverArtUrls`' 2,500ms timeout trips, the covers
 * stage records a failure, and the release reports `failed` with no artwork —
 * which is exactly the *On the Corner* / *Get Up With It* report. Production
 * logs from the same session caught it: `stage covers failed: Cover Art Archive
 * unreachable … aborted due to timeout`.
 *
 * (Those browser figures include the browser's own HTTP/1.1 connection queueing
 * against the dev server. The clean server-side A/B is in the table further
 * down, and it is the one the constants were tuned against — production is
 * HTTP/2 behind Cloudflare, where the browser does not throttle itself and every
 * request really does arrive at once.)
 *
 * ## Why ordering rather than rate
 *
 * MusicBrainz's 1 req/s is THEIR policy, not our knob (§7). Nothing here changes
 * how many requests we make; it changes **which one goes first**. The Cover Art
 * Archive publishes no rate limit, but 37-at-once is how 6.1.1 earned an
 * `HTTP 429` from it — the concurrency cap here is our own politeness, and it is
 * what stops us creating the congestion we then time out against.
 *
 * ## The tiers
 *
 * `interactive` — a person is blocked on this response right now (a release
 *                 seed, the retry button, search).
 * `browse`      — a person is watching a progress indicator, but is not blocked
 *                 on any single call (a discography assembly).
 * `background`  — nobody is waiting at all (the pre-warmer).
 *
 * Priority is strict, FIFO within a tier. `browse` is deliberately its own tier
 * rather than being lumped in with `background`: someone IS looking at the
 * artist page's "Fetching from MusicBrainz…" line, so a discography must keep
 * progressing whenever no click is outstanding.
 *
 * ## Starvation, stated rather than engineered around
 *
 * Strict priority means sustained `interactive` load can starve `browse`. A
 * click costs 2–4 MusicBrainz calls, so starving a discography needs more than
 * one click per second, continuously — at which point the 1 req/s gate is the
 * binding constraint on the whole product and pre-warming is the answer, not a
 * fairness tweak. Rather than build ageing for a load this site does not have,
 * the wait is **measured and logged**: `starvationWarnMs` turns a hypothetical
 * into a log line the day it stops being hypothetical.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type UpstreamTier = "interactive" | "browse" | "background";

/** Strict dispatch order. Index 0 goes first. */
const TIER_ORDER: readonly UpstreamTier[] = ["interactive", "browse", "background"] as const;

/**
 * The tier that applies to work in the current async context.
 *
 * Enrichment reaches upstream through eight-odd functions in `catalogService`
 * (`resolveArtistId`, `resolveLabelId`, `resolveCovers`, `groupLevelReleaseDate`
 * …). Threading a tier parameter through all of them, for the benefit of one
 * caller, would be a large diff whose only purpose is to carry a constant. An
 * async context carries it for free and — the part that matters — keeps
 * carrying it into the DETACHED enrichment promise that outlives the request,
 * which a parameter would have to be re-passed to by hand at every hop.
 *
 * Unset means `interactive`: code that never opts in gets the user-facing tier,
 * so forgetting to declare a tier is the harmless kind of wrong.
 */
const tierContext = new AsyncLocalStorage<UpstreamTier>();

/** Run `fn`, and everything it awaits, at `tier` unless something opts out. */
export function runAtTier<T>(tier: UpstreamTier, fn: () => Promise<T>): Promise<T> {
  return tierContext.run(tier, fn);
}

/** The ambient tier, defaulting to `interactive`. */
export function ambientTier(): UpstreamTier {
  return tierContext.getStore() ?? "interactive";
}

/**
 * The LOWER-priority of two tiers.
 *
 * Used where a call site knows something about the work (a speculative cover URL
 * shape) but must not use that to claim a HIGHER tier than its context allows —
 * the pre-warmer fetching a stored `coverUrl` is still the pre-warmer, and must
 * not take an interactive slot just because the URL looks like a lookup.
 */
export function lowerPriorityOf(a: UpstreamTier, b: UpstreamTier): UpstreamTier {
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b;
}

interface Waiter {
  resolve: () => void;
  queuedAt: number;
}

function emptyQueues(): Record<UpstreamTier, Waiter[]> {
  return { interactive: [], browse: [], background: [] };
}

/**
 * A minimum-gap rate gate with priority tiers.
 *
 * Replaces the promise-chain throttle. The spacing invariant is unchanged and is
 * the whole contract with MusicBrainz: consecutive dispatches are at least
 * `minGapMs` apart, no matter how many callers fan out. What changes is only the
 * ORDER in which waiters are handed those slots.
 */
export class PriorityRateGate {
  private readonly queues = emptyQueues();
  private lastDispatchAt = 0;
  private pumping = false;

  constructor(
    private readonly minGapMs: number,
    private readonly name: string,
    private readonly starvationWarnMs = 30_000
  ) {}

  /** Wait for this caller's turn. Resolves when it may issue its request. */
  acquire(tier: UpstreamTier): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queues[tier].push({ resolve, queuedAt: Date.now() });
      void this.pump();
    });
  }

  /** Highest-priority waiter, or undefined when every queue is empty. */
  private take(): Waiter | undefined {
    for (const tier of TIER_ORDER) {
      const waiter = this.queues[tier].shift();
      if (!waiter) continue;
      const waited = Date.now() - waiter.queuedAt;
      if (tier !== "interactive" && waited >= this.starvationWarnMs) {
        console.warn(
          `[${this.name}] ${tier} work waited ${waited}ms for a slot — interactive load is starving it`
        );
      }
      return waiter;
    }
    return undefined;
  }

  private get isEmpty(): boolean {
    return TIER_ORDER.every((tier) => this.queues[tier].length === 0);
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        if (this.isEmpty) break;

        // Wait out the gap FIRST, then choose. Choosing before the wait would
        // commit the slot to whoever happened to be queued when it opened, so an
        // interactive call arriving during the ~1.1s wait — the overwhelmingly
        // likely case, since that wait is most of the gate's life — would still
        // lose a full slot to a speculative one. Selecting at dispatch time uses
        // the freshest queue state, which is the whole point of having tiers.
        const gap = Date.now() - this.lastDispatchAt;
        if (gap < this.minGapMs) await sleep(this.minGapMs - gap);

        const next = this.take();
        if (!next) break;
        this.lastDispatchAt = Date.now();
        next.resolve();
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Queue depths, for tests and diagnostics. */
  depth(): Record<UpstreamTier, number> {
    return {
      interactive: this.queues.interactive.length,
      browse: this.queues.browse.length,
      background: this.queues.background.length,
    };
  }
}

/**
 * A bounded-concurrency gate with priority tiers and capacity reserved for
 * interactive work.
 *
 * `reservedForInteractive` is the load-bearing part: without it, 37 speculative
 * grid tiles fill every slot and the hero cover of the release a person just
 * opened queues behind all of them. With it, speculative work can never occupy
 * the last few slots, so an interactive cover waits for a slot to free rather
 * than for the whole grid to drain.
 */
export class PriorityConcurrencyGate {
  private readonly queues = emptyQueues();
  private active = 0;

  constructor(
    private readonly total: number,
    private readonly reservedForInteractive: number,
    private readonly name: string
  ) {}

  /** How many slots this tier may occupy at once. */
  private limitFor(tier: UpstreamTier): number {
    return tier === "interactive" ? this.total : this.total - this.reservedForInteractive;
  }

  /** Run `fn` once a slot is available to this tier. */
  async run<T>(tier: UpstreamTier, fn: () => Promise<T>): Promise<T> {
    await this.acquire(tier);
    try {
      return await fn();
    } finally {
      this.active--;
      this.dispatch();
    }
  }

  private acquire(tier: UpstreamTier): Promise<void> {
    if (this.active < this.limitFor(tier)) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queues[tier].push({ resolve, queuedAt: Date.now() });
    });
  }

  /** Give the freed slot to the highest-priority waiter that may use it. */
  private dispatch(): void {
    for (const tier of TIER_ORDER) {
      if (this.active >= this.limitFor(tier)) continue;
      const waiter = this.queues[tier].shift();
      if (!waiter) continue;
      this.active++;
      waiter.resolve();
      return;
    }
  }

  /** Reset to idle. Test seam only. */
  __reset(): void {
    this.active = 0;
    for (const tier of TIER_ORDER) this.queues[tier].length = 0;
  }

  /** In-flight count and queue depths, for tests and diagnostics. */
  stats(): { active: number; queued: Record<UpstreamTier, number> } {
    return {
      active: this.active,
      queued: {
        interactive: this.queues.interactive.length,
        browse: this.queues.browse.length,
        background: this.queues.background.length,
      },
    };
  }
}

/**
 * How hard we lean on the Cover Art Archive, in total, across BOTH the JSON
 * lookup (`getCoverArtUrls`) and the image bytes (`fetchUpstreamImage`). One
 * host, one budget — splitting it per call type would just be 2× the number.
 *
 * This is OUR politeness, not a published limit. The archive publishes no rate,
 * but 6.1.1 earned an HTTP 429 from it by fanning out exactly like this.
 *
 * ## Why 12 and 3, measured rather than guessed
 *
 * A Miles Davis discography grid firing 37 tiles at once, plus one interactive
 * hero cover 150ms behind them, against the live archive:
 *
 * | gate            | hero    | tiles p50 | grid fill | tile failures |
 * |-----------------|---------|-----------|-----------|---------------|
 * | none (was)      | 5,469ms | 3,098ms   | 5.6s      | **8 of 37**   |
 * | 6 total / 2 res | 1,969ms | 7,101ms   | 13.4s     | 1 of 37       |
 * | **12 / 3**      | 1,706ms | 4,588ms   | 7.3s      | **0 of 37**   |
 *
 * The unbounded column is the one to read twice: **eight of thirty-seven
 * speculative tiles failed outright**, because 37 simultaneous requests is how
 * you make an archive answer 503 — and a 503 tile is a blank one. We were
 * generating the failure we then blamed upstream for.
 *
 * 6/2 fixed the failures but starved the grid, taking 13.4s to fill what had
 * taken 5.6s. 12/3 is the better point on the curve: the hero is 3.2× faster
 * than unbounded, every tile arrived, and the grid costs 1.7s more than a fan-out
 * that was failing a fifth of its requests.
 *
 * Run-to-run variance against a live third party is real, and the failure counts
 * especially should be read as "unbounded fails a lot, bounded rarely does"
 * rather than as exact rates.
 */
const COVER_ART_CONCURRENCY = 12;
const COVER_ART_RESERVED_FOR_INTERACTIVE = 3;

export const coverArtGate = new PriorityConcurrencyGate(
  COVER_ART_CONCURRENCY,
  COVER_ART_RESERVED_FOR_INTERACTIVE,
  "caa"
);
