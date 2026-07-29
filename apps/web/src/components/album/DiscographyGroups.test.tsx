// 6.2d — the cover-volume fix.
//
// The discography grid was the source of the storm: a Cure + Zappa session
// produced 1,647 cover requests, 778 of which never left the browser before
// being abandoned.
//
// FLAGGED TEST-CONTRACT CHANGE (§9). An earlier revision of this file asserted a
// page-wide lifetime budget of 48 discovery covers. Those assertions are gone
// because the behaviour they pinned was deliberately removed, not because they
// became inconvenient: the budget measurably killed the storm and measurably
// broke browsing, leaving tiles someone was looking at as permanent
// placeholders. Rationing is now visibility (here) plus in-flight concurrency
// (lib/coverLoadQueue.test.ts) — so what this file pins is that EVERY shown
// entry gets artwork, which is the opposite of what it used to assert.
//
// The observer itself is not testable here: jsdom has no IntersectionObserver,
// and useInViewport deliberately falls back to "visible immediately" so a
// missing API can never be a missing image. That fallback is asserted below so
// it cannot regress silently.
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DiscographyGroup, DiscographyEntry } from "@soundlog/shared";
import { DiscographyGroups } from "./DiscographyGroups";

// EntryCard uses usePrefetchRelease, which reads auth for its query key.
vi.mock("../../contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

function entry(i: number, seeded = false): DiscographyEntry {
  return {
    mbid: `mbid-${i}-0000-4000-8000-000000000000`,
    title: `Release ${i}`,
    type: "ALBUM",
    year: String(1970 + (i % 40)),
    seeded,
    releaseId: seeded ? `rel-${i}` : null,
    coverUrl: seeded ? `/covers/w400/seeded-${i}.webp` : null,
    coverColor: null,
    avgRating: null,
    ratingCount: 0,
    myRating: null,
  } as DiscographyEntry;
}

function group(key: string, label: string, n: number, seeded = false): DiscographyGroup {
  return {
    key,
    label,
    entries: Array.from({ length: n }, (_, i) => entry(Number(`${key.length}${i}`), seeded)),
  } as DiscographyGroup;
}

function renderGroups(groups: DiscographyGroup[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DiscographyGroups groups={groups} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Tiles that actually carry an <img>, i.e. that will make a request. */
function tilesWithArtwork(): number {
  return document.querySelectorAll(".cover img").length;
}

/**
 * Fire `load` on every mounted image until no new ones appear.
 *
 * jsdom performs no network, so an <img> never reports and the concurrency gate
 * never refills on its own — only MAX_IN_FLIGHT tiles would ever have artwork.
 * Driving the loads is what makes the REFILL observable, and the refill is the
 * property whose absence made the previous design leave visible tiles blank
 * forever. Without this the test would assert the bound and miss the bug.
 */
function drainCoverQueue(maxRounds = 200): void {
  const seen = new WeakSet<Element>();
  for (let round = 0; round < maxRounds; round++) {
    const fresh = [...document.querySelectorAll(".cover img")].filter((img) => !seen.has(img));
    if (fresh.length === 0) return;
    act(() => {
      for (const img of fresh) {
        seen.add(img);
        fireEvent.load(img);
      }
    });
  }
}

describe("DiscographyGroups — cover volume", () => {
  it("gives every SHOWN entry artwork — no tile is rationed out by count", async () => {
    // The regression this replaces: with a lifetime budget, expanding groups ran
    // past the cap and left later tiles permanently blank even while on screen.
    const groups = ["a", "bb", "ccc", "dddd", "eeeee", "ffffff"].map((k, i) =>
      group(k, `Group${i}`, 40)
    );
    renderGroups(groups);

    for (const btn of screen.queryAllByRole("button", { name: /^Show all/ })) {
      await userEvent.click(btn);
    }
    drainCoverQueue();

    // 6 × 40, all of them, once expanded. Under the old budget this was 48 and
    // the remaining 192 stayed blank no matter how long anyone waited.
    expect(tilesWithArtwork()).toBe(240);
    const first = document.querySelectorAll("section")[0];
    expect(within(first as HTMLElement).getAllByRole("img").length).toBe(40);
  });

  it("gives a seeded release its own cover too", () => {
    renderGroups([group("s", "Albums", 80, true)]);
    drainCoverQueue();
    // Only the first PAGE_SIZE are mounted; all of them carry artwork.
    expect(tilesWithArtwork()).toBe(24);
    expect(screen.queryAllByRole("button", { name: /^Show all/ })).toHaveLength(1);
  });

  it("paginates each group, and expanding reveals the rest", async () => {
    renderGroups([group("p", "Albums", 60)]);
    expect(screen.getAllByRole("listitem")).toHaveLength(24);

    const button = screen.getByRole("button", { name: /Show all 60 albums/i });
    await userEvent.click(button);

    expect(screen.getAllByRole("listitem")).toHaveLength(60);
    // The control is gone once there is nothing left to reveal.
    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();
  });

  it("shows no Show-all control for a group that fits", () => {
    renderGroups([group("t", "Albums", 5)]);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();
  });

  it("still renders artwork when IntersectionObserver is unavailable", () => {
    // The fallback that keeps a missing browser API from becoming a missing
    // image. jsdom provides no IntersectionObserver, so this is the real path
    // here — and asserting it means the fallback cannot be dropped silently.
    expect(typeof IntersectionObserver).toBe("undefined");
    renderGroups([group("f", "Albums", 3)]);
    drainCoverQueue();
    expect(tilesWithArtwork()).toBe(3);
  });
});
