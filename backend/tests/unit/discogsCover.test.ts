// Cover policy: strict same-pressing art. The best-matching pressing's own
// artwork always wins — even a non-square J-card spread (the client
// letterboxes those) — and sibling pressings' prettier scans must never
// override it. Unrelated search hits must never supply art at all.
import { describe, it, expect, afterEach, afterAll, vi } from "vitest";
import { findDiscogsCover } from "../../src/services/discogsService.js";
import { redis } from "../../src/config/redis.js";

const RUN = Date.now().toString(36);
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await redis.quit().catch(() => {});
});

describe("findDiscogsCover — strict same-pressing policy", () => {
  it("keeps the exact pressing's spread over a sibling pressing's square cover", async () => {
    const TITLE = `End Of The World ${RUN}`;
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/database/search")) {
        return Promise.resolve(
          json({
            results: [
              { id: 1, type: "release", title: `Tron ${RUN} - ${TITLE}`, cover_image: "https://img/spread.jpg" },
              { id: 2, type: "release", title: `Tron ${RUN} - The ${TITLE}`, cover_image: "https://img/square.jpg" },
              // Unrelated hit with a lovely square cover — must never be chosen.
              { id: 3, type: "release", title: `Zenith ${RUN} - Evolution Seven`, cover_image: "https://img/wrong.jpg" },
            ],
          })
        );
      }
      if (url.includes("/releases/1")) {
        // The exact pressing's only image is a 600×368 J-card spread.
        return Promise.resolve(
          json({ id: 1, title: TITLE, images: [{ uri: "https://img/spread-full.jpg", type: "secondary", width: 600, height: 368 }] })
        );
      }
      if (url.includes("/releases/2")) {
        return Promise.resolve(
          json({ id: 2, title: `The ${TITLE}`, images: [{ uri: "https://img/square-full.jpg", type: "primary", width: 553, height: 600 }] })
        );
      }
      return Promise.resolve(json({}));
    });

    const cover = await findDiscogsCover(`Tron ${RUN}`, TITLE);
    expect(cover).toBe("https://img/spread-full.jpg"); // same pressing, not the sibling's square
  });

  it("falls through to a sibling pressing only when the exact one has no images", async () => {
    const TITLE = `Imageless Tape ${RUN}`;
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/database/search")) {
        return Promise.resolve(
          json({
            results: [
              // thumb-only hit whose detail turns out to have no images array
              { id: 11, type: "release", title: `Tron ${RUN} - ${TITLE}`, thumb: "https://img/thumb11.jpg" },
              { id: 12, type: "release", title: `Tron ${RUN} - ${TITLE}`, cover_image: "https://img/sibling.jpg" },
            ],
          })
        );
      }
      if (url.includes("/releases/11")) return Promise.resolve(json({ id: 11, title: TITLE, images: [] }));
      if (url.includes("/releases/12")) {
        return Promise.resolve(
          json({ id: 12, title: TITLE, images: [{ uri: "https://img/sibling-full.jpg", type: "primary", width: 500, height: 500 }] })
        );
      }
      return Promise.resolve(json({}));
    });

    const cover = await findDiscogsCover(`Tron ${RUN}`, TITLE);
    // The imageless pressing still owns its search thumb — same-pressing art first.
    expect(cover).toBe("https://img/thumb11.jpg");
  });
});
