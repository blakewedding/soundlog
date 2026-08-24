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
 * ## Starvation: ageing, because production voted (6.3e)
 *
 * This module used to say starvation was stated rather than engineered around —
 * that starving a discography needed sustained clicks the site did not have, so
 * measuring the wait was enough. **That bet lost.** Bob Dylan's artist page
 * (1,192 release-groups = 12 browse pages) wedged at "200 of 1192" and stayed
 * there: the `browse` assembly never won a third slot, `onProgress` never fired
 * again, and every poll answered `assembling` forever.
 *
 * Two things were wrong, and only one of them was the policy.
 *
 *  - **The policy.** Strict priority with no ageing means a low tier's wait is
 *    unbounded, and "unbounded" is not a latency figure — it is a hang. Ageing
 *    (below) bounds it: a waiter older than `agePromotionMs` is dispatched ahead
 *    of higher tiers. Priority is preserved for every wait shorter than that,
 *    which is essentially all of them; what changes is only that the tail is now
 *    finite. **The rate is untouched** — ageing reorders, it never dispatches
 *    faster, so §7's 1 req/s contract is exactly as it was.
 *
 *  - **The tripwire, which was worse.** `starvationWarnMs` computed its wait
 *    inside `take()`, i.e. at the moment a waiter was DISPATCHED. A waiter that
 *    is never dispatched is never measured, so the warning could only ever
 *    report starvation that had already **ended**. During the Dylan wedge it
 *    emitted nothing at all, and its silence read as health. A tripwire that
 *    fires on recovery rather than on the fault is worse than no tripwire,
 *    because it is trusted. It is now sampled from `pump()` while the waiter is
 *    still queued, and routed through {@link onStarvation} so it can page
 *    instead of whisper.
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

/**
 * How long INTERACTIVE work may wait for a slot before we say so.
 *
 * ## Why this exists, and why it is not the same number as starvation
 *
 * Both gates already warn when `browse`/`background` work waits too long. That
 * warning answers a FAIRNESS question — "is the low tier making progress?" — and
 * its threshold is 30s because background work waiting half a minute is fine.
 *
 * It cannot answer the question a performance report actually asks, which is
 * "was a person waiting?", and the 6.2b performance investigation ran straight
 * into that: asked whether interactive priority held during a discography burst,
 * the logs had nothing to say, because the only instrumented direction was the
 * one nobody was worried about. Zero warnings looked like evidence of health and
 * was in fact evidence of nothing.
 *
 * 2s rather than 30s because the tiers exist to protect a person who is blocked
 * on a response, and a person blocked for two seconds has already noticed. A
 * line here means the priority system did not deliver what it promises — either
 * the tier was assigned wrongly at the call site, or the gate is genuinely
 * oversubscribed. Both are worth a log line; neither should be silent.
 */
/**
 * How long a lower-tier waiter may wait before it is dispatched ahead of higher
 * tiers regardless of priority.
 *
 * This is the bound that makes starvation impossible rather than merely
 * unlikely. 15s is chosen against what the tiers are FOR: `interactive` exists
 * to keep a blocked person under a couple of seconds, and a promotion costs the
 * next interactive caller exactly one slot (~1.1s on the MusicBrainz gate). So
 * the worst case a click can suffer is one extra gap, while the best case a
 * wedged discography gains is the difference between finishing and never
 * finishing.
 */
const AGE_PROMOTION_MS = 15_000;

/** A low tier has been waiting long enough that someone should know. */
export interface StarvationEvent {
  gate: string;
  tier: UpstreamTier;
  waitedMs: number;
  depth: Record<UpstreamTier, number>;
}

/**
 * Where starvation reports go.
 *
 * Deliberately a sink rather than a bare `console.warn`. The Dylan wedge was
 * invisible for as long as it was because the only signal this system could
 * produce was a warn line in a log nobody reads during an incident — and it
 * could not even produce that one. An operator asked for this class to page,
 * so it is routable: `server.ts` can point it at whatever alerting exists.
 *
 * The default writes to `console.error`, not `console.warn`, with a stable
 * `[ALERT]` prefix that a log-based alert rule can match on.
 */
let starvationSink: (event: StarvationEvent) => void = (e) => {
  console.error(
    `[ALERT][${e.gate}] ${e.tier} work has been waiting ${e.waitedMs}ms for a slot — ` +
      `starving (queued: interactive=${e.depth.interactive} browse=${e.depth.browse} ` +
      `background=${e.depth.background})`
  );
};

/** Route starvation reports somewhere they will be seen. Returns the previous sink. */
export function onStarvation(
  sink: (event: StarvationEvent) => void
): (event: StarvationEvent) => void {
  const previous = starvationSink;
  starvationSink = sink;
  return previous;
}

/**
 * Counters for `/api/health`, so a wedge is visible to a probe and not only to
 * whoever is tailing logs. Cumulative since boot; `promotions` climbing steadily
 * means the gate is genuinely oversubscribed rather than momentarily unlucky.
 */
const starvationCounters = { events: 0, promotions: 0, lastEventAt: null as number | null };
export function starvationStats(): Readonly<typeof starvationCounters> {
  return { ...starvationCounters };
}
/** Test seam. */
export function __resetStarvationStats(): void {
  starvationCounters.events = 0;
  starvationCounters.promotions = 0;
  starvationCounters.lastEventAt = null;
}

function reportStarvation(event: StarvationEvent): void {
  starvationCounters.events++;
  starvationCounters.lastEventAt = Date.now();
  starvationSink(event);
}

const INTERACTIVE_WAIT_WARN_MS = 2_000;

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
    private readonly starvationWarnMs = 30_000,
    private readonly interactiveWarnMs = INTERACTIVE_WAIT_WARN_MS,
    private readonly agePromotionMs = AGE_PROMOTION_MS
  ) {}

  /** Last time each tier was reported starving, so one wedge is not one line per gap. */
  private readonly lastStarvationReportAt: Record<UpstreamTier, number> = {
    interactive: 0,
    browse: 0,
    background: 0,
  };

  /** Wait for this caller's turn. Resolves when it may issue its request. */
  acquire(tier: UpstreamTier): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queues[tier].push({ resolve, queuedAt: Date.now() });
      void this.pump();
    });
  }

  /**
   * The oldest waiter that has aged past `agePromotionMs`, or undefined.
   *
   * This is what makes the low tiers' wait BOUNDED rather than merely unlikely.
   * Interactive is skipped because strict priority already puts it first — there
   * is nothing for ageing to promote it past.
   */
  private takeAged(): Waiter | undefined {
    const now = Date.now();
    let chosen: UpstreamTier | undefined;
    let longest = -1;

    for (const tier of TIER_ORDER) {
      if (tier === "interactive") continue;
      const head = this.queues[tier][0];
      if (!head) continue;
      const waited = now - head.queuedAt;
      if (waited >= this.agePromotionMs && waited > longest) {
        chosen = tier;
        longest = waited;
      }
    }
    if (!chosen) return undefined;

    // Only a promotion if something higher-priority was actually ahead of it;
    // otherwise strict priority would have picked it anyway and counting it
    // would overstate how often the gate is oversubscribed.
    const jumped = TIER_ORDER.slice(0, TIER_ORDER.indexOf(chosen)).some(
      (t) => this.queues[t].length > 0
    );
    const waiter = this.queues[chosen].shift();
    if (!waiter) return undefined;
    if (jumped) starvationCounters.promotions++;
    return waiter;
  }

  /**
   * Report any tier that is starving RIGHT NOW.
   *
   * Sampled here, from the pump loop, rather than in `take()` — see the module
   * header. `pump()` runs continuously for as long as anything is queued, so a
   * wedged waiter is observed every `minGapMs` whether or not it is ever
   * dispatched, which is the entire point.
   */
  private reportStarving(): void {
    const now = Date.now();
    for (const tier of TIER_ORDER) {
      if (tier === "interactive") continue;
      const head = this.queues[tier][0];
      if (!head) continue;
      const waited = now - head.queuedAt;
      if (waited < this.starvationWarnMs) continue;
      // Re-report no more than once per threshold, so a long wedge is a
      // heartbeat rather than a flood.
      if (now - this.lastStarvationReportAt[tier] < this.starvationWarnMs) continue;
      this.lastStarvationReportAt[tier] = now;
      reportStarvation({ gate: this.name, tier, waitedMs: waited, depth: this.depth() });
    }
  }

  /** Highest-priority waiter, or undefined when every queue is empty. */
  private take(): Waiter | undefined {
    // Ageing outranks priority, and only ageing does.
    const aged = this.takeAged();
    if (aged) return aged;

    for (const tier of TIER_ORDER) {
      const waiter = this.queues[tier].shift();
      if (!waiter) continue;
      const waited = Date.now() - waiter.queuedAt;
      // NB: the low-tier starvation line used to be emitted HERE, at dispatch.
      // That is precisely what made it useless — see the module header. It is
      // now sampled in `reportStarving()` while the waiter is still queued, so
      // emitting it again here would only double-count a wedge that has ended.
      // The other direction: a person was blocked on this. Queue depths are in
      // the line because "interactive waited 4s" and "interactive waited 4s
      // behind 300 queued browse items" are different diagnoses — the first
      // suggests a mis-assigned tier, the second an oversubscribed gate.
      if (tier === "interactive" && waited >= this.interactiveWarnMs) {
        const d = this.depth();
        console.warn(
          `[${this.name}] INTERACTIVE waited ${waited}ms for a slot ` +
            `(queued: interactive=${d.interactive} browse=${d.browse} background=${d.background})`
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

        // Observe BEFORE dispatching: a waiter that is about to be starved
        // again must still be counted, and the one being dispatched is by
        // definition no longer starving.
        this.reportStarving();

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

  /**
   * Depth AND the age of the oldest waiter in each tier.
   *
   * Depth alone cannot distinguish a busy gate from a wedged one: a queue of 40
   * that drains in a second is healthy, and a queue of 1 that has been waiting
   * four minutes is an incident. Age is the number that separates them, which is
   * why it is what `/api/health/upstream` reports.
   */
  waitStats(): {
    queued: Record<UpstreamTier, number>;
    oldestWaitMs: Record<UpstreamTier, number>;
  } {
    const now = Date.now();
    const oldest = (tier: UpstreamTier) => {
      const head = this.queues[tier][0];
      return head ? now - head.queuedAt : 0;
    };
    return {
      queued: this.depth(),
      oldestWaitMs: {
        interactive: oldest("interactive"),
        browse: oldest("browse"),
        background: oldest("background"),
      },
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
    private readonly name: string,
    private readonly interactiveWarnMs = INTERACTIVE_WAIT_WARN_MS,
    private readonly starvationWarnMs = 30_000,
    private readonly agePromotionMs = AGE_PROMOTION_MS
  ) {}

  private readonly lastStarvationReportAt: Record<UpstreamTier, number> = {
    interactive: 0,
    browse: 0,
    background: 0,
  };

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

  /**
   * The oldest waiter past `agePromotionMs` that may legally take a slot.
   *
   * Same anti-starvation bound as the rate gate — but it still respects
   * `limitFor`, so ageing can never promote speculative work into the capacity
   * reserved for interactive requests. Bounding a browse tile's wait must not
   * be paid for by making a person queue behind a grid, which is the whole
   * reason the reservation exists.
   */
  private takeAged(): Waiter | undefined {
    const now = Date.now();
    let chosen: UpstreamTier | undefined;
    let longest = -1;
    for (const tier of TIER_ORDER) {
      if (tier === "interactive") continue;
      if (this.active >= this.limitFor(tier)) continue;
      const head = this.queues[tier][0];
      if (!head) continue;
      const waited = now - head.queuedAt;
      if (waited >= this.agePromotionMs && waited > longest) {
        chosen = tier;
        longest = waited;
      }
    }
    if (!chosen) return undefined;
    const jumped = TIER_ORDER.slice(0, TIER_ORDER.indexOf(chosen)).some(
      (t) => this.queues[t].length > 0
    );
    const waiter = this.queues[chosen].shift();
    if (!waiter) return undefined;
    if (jumped) starvationCounters.promotions++;
    return waiter;
  }

  /**
   * Report any tier starving right now.
   *
   * Called from `dispatch()` AND from `stats()`, and the second one is not
   * redundant. This gate is event-driven — `dispatch()` only runs when a slot
   * frees — so if every slot is held by a request that never returns, the one
   * moment it could observe a wedge is the one moment it never reaches.
   * `stats()` is what `/api/health/upstream` calls, which makes a probe an
   * observer rather than only a reader.
   *
   * 6.3e shipped starvation reporting on the RATE gate and not this one, and a
   * production health check then showed `starvation.events: 0` beside 103
   * queued cover requests. Zero was true and meant nothing: it described a gate
   * that was idle while the saturated one had no way to speak.
   */
  private reportStarving(): void {
    const now = Date.now();
    for (const tier of TIER_ORDER) {
      if (tier === "interactive") continue;
      const head = this.queues[tier][0];
      if (!head) continue;
      const waited = now - head.queuedAt;
      if (waited < this.starvationWarnMs) continue;
      if (now - this.lastStarvationReportAt[tier] < this.starvationWarnMs) continue;
      this.lastStarvationReportAt[tier] = now;
      reportStarvation({
        gate: this.name,
        tier,
        waitedMs: waited,
        depth: {
          interactive: this.queues.interactive.length,
          browse: this.queues.browse.length,
          background: this.queues.background.length,
        },
      });
    }
  }

  /** Give the freed slot to the highest-priority waiter that may use it. */
  private dispatch(): void {
    this.reportStarving();

    const aged = this.takeAged();
    if (aged) {
      this.active++;
      aged.resolve();
      return;
    }

    for (const tier of TIER_ORDER) {
      if (this.active >= this.limitFor(tier)) continue;
      const waiter = this.queues[tier].shift();
      if (!waiter) continue;
      this.active++;
      // See INTERACTIVE_WAIT_WARN_MS. This is the gate that the discography
      // burst actually pressures — `reservedForInteractive` is supposed to mean
      // a person never queues behind a grid, and until now nothing said whether
      // that held. An `active` count at or above `total` alongside a long
      // interactive wait means the reservation was not enough; a long wait with
      // slots free would mean the tier never reached this gate at all.
      if (tier === "interactive") {
        const waited = Date.now() - waiter.queuedAt;
        if (waited >= this.interactiveWarnMs) {
          const q = this.queues;
          console.warn(
            `[${this.name}] INTERACTIVE waited ${waited}ms for a slot ` +
              `(active=${this.active}/${this.total}, reserved=${this.reservedForInteractive}, ` +
              `queued: interactive=${q.interactive.length} browse=${q.browse.length} background=${q.background.length})`
          );
        }
      }
      waiter.resolve();
      return;
    }
  }

  /** Reset to idle. Test seam only. */
  __reset(): void {
    this.active = 0;
    for (const tier of TIER_ORDER) this.queues[tier].length = 0;
  }

  /**
   * In-flight count, queue depths, and how long the oldest waiter in each tier
   * has been waiting.
   *
   * `oldestWaitMs` is the field that distinguishes a busy gate from a wedged
   * one. `active: 12, queued: 103` describes both, and only age tells them
   * apart. Reading this also SAMPLES the starvation tripwire — see
   * `reportStarving`.
   */
  stats(): {
    active: number;
    queued: Record<UpstreamTier, number>;
    oldestWaitMs: Record<UpstreamTier, number>;
  } {
    this.reportStarving();
    const now = Date.now();
    const oldest = (tier: UpstreamTier) => {
      const head = this.queues[tier][0];
      return head ? now - head.queuedAt : 0;
    };
    return {
      active: this.active,
      queued: {
        interactive: this.queues.interactive.length,
        browse: this.queues.browse.length,
        background: this.queues.background.length,
      },
      oldestWaitMs: {
        interactive: oldest("interactive"),
        browse: oldest("browse"),
        background: oldest("background"),
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
