// 6.2d — the cover-volume fix.
//
// The discography grid was the source of the storm: a Cure + Zappa session
// produced 1,647 cover requests, 778 of which never left the browser before
// being abandoned. Three bounds now compose — pagination limits the DOM, the
// observer limits the burst, and a hard budget limits the total.
//
// These test the BUDGET and the PAGINATION, which are pure render logic and so
// are genuinely assertable here. The observer is not: jsdom has no
// IntersectionObserver, and useInViewport deliberately falls back to
// "visible immediately" so a missing API can never be a missing image. That
// fallback is what makes the rest of the suite keep passing, and it is asserted
// explicitly below so the fallback itself cannot regress silently.
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

describe("DiscographyGroups — cover volume", () => {
  it("caps speculative discovery covers across the whole page, not per group", async () => {
    // 6 groups × 40 un-seeded entries = 240 candidates. Before the fix every one
    // of them rendered an <img>; the budget is 48 in render order.
    const groups = ["a", "bb", "ccc", "dddd", "eeeee", "ffffff"].map((k, i) =>
      group(k, `Group${i}`, 40)
    );
    renderGroups(groups);

    // Expand everything, so this measures the BUDGET rather than the pagination.
    for (const btn of screen.queryAllByRole("button", { name: /^Show all/ })) {
      await userEvent.click(btn);
    }

    expect(tilesWithArtwork()).toBe(48);
    // And the point of it being a page-wide budget: it is spent in render order,
    // so the FIRST group is fully rich rather than every group being equally thin.
    const first = document.querySelectorAll("section")[0];
    expect(within(first as HTMLElement).getAllByRole("img").length).toBe(40);
  });

  it("never rations a seeded release's own cover", () => {
    // A seeded cover is a lookup for a row we hold — cheap, retried, and not
    // part of the storm. Rationing it would blank artwork we already have.
    renderGroups([group("s", "Albums", 80, true)]);
    // Only the first PAGE_SIZE are mounted, but all of them carry artwork.
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
    expect(tilesWithArtwork()).toBe(3);
  });
});
