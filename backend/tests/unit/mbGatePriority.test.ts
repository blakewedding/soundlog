/**
 * 6.1.4 regression: a release someone is opening must not queue behind a
 * discography browse at the MusicBrainz gate.
 *
 * This drives the REAL exported service functions rather than the gate directly,
 * because the bug was never in the gate's mechanics — it was in which tier each
 * caller asks for. A test of `PriorityRateGate` alone would have passed happily
 * while `assembleDiscography` still queued as `interactive`. (6.1.3's lesson,
 * restated: exercise the path the product actually takes.)
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getArtistDiscography,
  lookupReleaseGroup,
  mbGateDepth,
} from "../../src/services/musicbrainzService.js";
import { redis } from "../../src/config/redis.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Unique per run, so every call misses the 7d Redis cache. */
let RUN = "";
let dispatched: string[] = [];
/**
 * Work started by a test, awaited in afterEach. A FAILING test throws before its
 * own `await`, and an assembly still in flight then dispatches into the NEXT
 * test's `dispatched` array — which is how the first draft of this file reported
 * a second, phantom failure caused entirely by the first one.
 */
let started: Array<Promise<unknown>> = [];

const PAGE_SIZE = 100;
const TOTAL_GROUPS = 250; // 3 browse pages — enough to interleave, quick enough to run

beforeEach(() => {
  RUN = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  dispatched = [];
  started = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const browse = /\/release-group\?artist=[^&]+&limit=\d+&offset=(\d+)/.exec(url);

      if (browse) {
        const offset = Number(browse[1]);
        dispatched.push(`browse:${offset}`);
        const n = Math.max(0, Math.min(PAGE_SIZE, TOTAL_GROUPS - offset));
        return new Response(
          JSON.stringify({
            "release-group-count": TOTAL_GROUPS,
            "release-groups": Array.from({ length: n }, (_, i) => ({
              id: `${RUN}-rg-${offset + i}`,
              title: `Group ${offset + i}`,
              "primary-type": "Album",
              "secondary-types": [],
            })),
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      dispatched.push("interactive-lookup");
      return new Response(
        JSON.stringify({
          id: `${RUN}-clicked`,
          title: "Clicked Release",
          "artist-credit": [{ name: "Someone", artist: { id: "a1", name: "Someone" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    })
  );
});

afterEach(async () => {
  // Drain before unstubbing, pass or fail, so nothing bleeds into the next test.
  await Promise.allSettled(started);
  vi.unstubAllGlobals();
  const keys = await redis.keys(`*${RUN}*`);
  if (keys.length) await redis.del(...keys);
});

afterAll(async () => {
  await redis.quit().catch(() => {});
});

describe("MusicBrainz gate priority", () => {
  it("gives an interactive lookup the very next slot, ahead of queued browse pages", async () => {
    const assembly = getArtistDiscography(`${RUN}-artist`);
    started.push(assembly);

    // Wait until the browse has taken a slot and is spacing before its next
    // page — i.e. reproduce a click landing mid-assembly.
    await vi.waitFor(() => expect(dispatched.length).toBeGreaterThanOrEqual(1), { timeout: 3000 });
    expect(dispatched).toEqual(["browse:0"]);

    await lookupReleaseGroup(`${RUN}-clicked-rg`);

    // THE ASSERTION THIS FILE EXISTS FOR. Page 0 was already in flight and could
    // not be recalled; everything after it was contested, and the click won.
    // Before 6.1.4 this read ["browse:0", "browse:100", "interactive-lookup"] —
    // the click waited out a page it had every right to precede.
    expect(dispatched).toEqual(["browse:0", "interactive-lookup"]);

    await assembly;
    // …and the browse still completed, in order, having merely been delayed.
    expect(dispatched).toEqual([
      "browse:0",
      "interactive-lookup",
      "browse:100",
      "browse:200",
    ]);
    expect(mbGateDepth()).toEqual({ interactive: 0, browse: 0, background: 0 });
  }, 20_000);

  it("still walks every browse page — priority reorders, it never drops work", async () => {
    const entries = await getArtistDiscography(`${RUN}-artist`);

    expect(entries).toHaveLength(TOTAL_GROUPS);
    expect(dispatched.filter((d) => d.startsWith("browse:"))).toEqual([
      "browse:0",
      "browse:100",
      "browse:200",
    ]);
  }, 20_000);

  it("holds the 1 req/s contract — priority buys order, never throughput", async () => {
    const startedAt = Date.now();
    await getArtistDiscography(`${RUN}-artist`);
    const elapsed = Date.now() - startedAt;

    // 3 pages cannot be faster than 2 inter-request gaps. If a future change
    // ever "optimises" the gate into parallelism, this is what catches it —
    // §7's 1 req/s is MusicBrainz's policy, not a knob we own.
    expect(elapsed).toBeGreaterThanOrEqual(2 * 1100 - 100);
  }, 20_000);
});
