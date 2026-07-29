/**
 * A concurrency gate for cover requests, shared across every tile on the page.
 *
 * ## Why this replaced a lifetime budget
 *
 * 6.2d first rationed discovery covers with a page-wide budget of 48 spent in
 * render order. It killed the storm and failed the product: covers loaded
 * through Albums, EPs and the first row of Singles and then stopped at a clean
 * line, so tiles someone was looking at — *Just Like Heaven*, art that plainly
 * exists — stayed placeholders forever. Parking on them and waiting did
 * nothing, because a spent budget never refills.
 *
 * It was also not even a coherent lifetime cap. The allocation recomputed on
 * every render, so as groups expanded and the discography query settled the
 * granted SET shifted, and one artist made 147 requests against a budget of 48.
 *
 * The right insight, and it is the whole of this file: **once visibility gates
 * loading, visibility is already the rationing mechanism.** A tile only requests
 * artwork if someone scrolled it into view, so the total is bounded by what was
 * actually looked at rather than by an arbitrary number. What visibility does
 * NOT bound is the BURST — scrolling fast past two hundred tiles makes them all
 * visible within a second — and a burst is what produced the 778 requests that
 * queued for ~49s in the browser and were abandoned unsent.
 *
 * So the bound moved from lifetime count to in-flight concurrency: everything
 * visible loads eventually, and only a few are ever in flight.
 *
 * ## LIFO, deliberately
 *
 * Newest waiter first. During a fast scroll the most recently queued tiles are
 * the ones now on screen; FIFO would serve the tiles the user has already
 * scrolled past while the visible ones waited behind them. This is the same
 * reasoning as the server-side priority tiers (§7): the ordering is what matters
 * to the person, not the throughput.
 */

/**
 * How many cover requests may be in flight at once.
 *
 * Small on purpose. The browser already caps per-host connections and the origin
 * already bounds the Cover Art Archive at 12 concurrent; this exists so a scroll
 * cannot hand either of them a queue thousands deep. Six keeps a grid filling
 * visibly while leaving connections free for the API calls a page also needs —
 * the profile page's own requests were starved behind exactly this traffic.
 */
const MAX_IN_FLIGHT = 6;

/**
 * A slot is force-released after this long even if the image never reports.
 *
 * A safety valve, not a timeout on the request itself: the image keeps loading.
 * Without it, one <img> that never fires load or error — a connection the
 * browser silently stalls, which is precisely what the storm produced — would
 * hold a slot forever and eventually deadlock the whole grid.
 */
const SLOT_TIMEOUT_MS = 15_000;

interface Waiter {
  grant: () => void;
  settled: boolean;
}

const waiting: Waiter[] = [];
let inFlight = 0;

function pump(): void {
  while (inFlight < MAX_IN_FLIGHT && waiting.length > 0) {
    const next = waiting.pop(); // LIFO — see the header
    if (!next || next.settled) continue;
    next.settled = true;
    inFlight += 1;
    next.grant();
  }
}

/**
 * Ask for permission to start loading a cover.
 *
 * `grant` is called — synchronously if a slot is free — when the request may
 * start. The returned function MUST be called exactly once the image has
 * finished (loaded or errored) or the tile has gone away; calling it before the
 * grant cancels the request instead, which is what a tile unmounting mid-queue
 * needs.
 */
export function acquireCoverSlot(grant: () => void): () => void {
  const waiter: Waiter = { grant, settled: false };
  waiting.push(waiter);
  pump();

  let released = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const release = () => {
    if (released) return;
    released = true;
    if (timer) clearTimeout(timer);
    if (waiter.settled) {
      // It held a slot; hand it on.
      inFlight = Math.max(0, inFlight - 1);
      pump();
    } else {
      // Cancelled before it ever started — drop it from the queue.
      waiter.settled = true;
    }
  };

  if (waiter.settled) timer = setTimeout(release, SLOT_TIMEOUT_MS);
  else {
    // Granted later; arm the valve at grant time rather than now, or a tile that
    // waited a long time would start with its safety window already spent.
    const originalGrant = waiter.grant;
    waiter.grant = () => {
      timer = setTimeout(release, SLOT_TIMEOUT_MS);
      originalGrant();
    };
  }

  return release;
}

/** In-flight and queued counts. Test seam and diagnostics. */
export function coverQueueStats(): { inFlight: number; queued: number } {
  return { inFlight, queued: waiting.filter((w) => !w.settled).length };
}

/** Test seam: drop all state between cases. */
export function __resetCoverQueue(): void {
  waiting.length = 0;
  inFlight = 0;
}
