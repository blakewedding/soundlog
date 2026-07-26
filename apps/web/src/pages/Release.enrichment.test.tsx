// 6.1.1 — a release that is still being filled in must SAY so, and must finish
// filling in on its own.
//
// The defect, reported from production on mobile Safari: a newly seeded release
// rendered with no label, no genres and no cover, drawn exactly like a finished
// record. It stayed that way through scrolling, tapping, resizing and zooming.
// Rating the album repaired it — not because rating does anything special, but
// because the rating mutation's cache invalidation was the only refetch trigger
// anywhere on the page.
//
// So the contract these tests hold:
//   1. pending is VISIBLE — a gap being fetched never looks like a settled gap
//   2. the finished record arrives with NO mutation, NO interaction at all
//   3. a broken enrichment ends in a visible, retryable failure, never in a
//      spinner that turns forever
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Release from "./Release";
import { api, ApiError } from "../services/api";

vi.mock("../services/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../services/api")>();
  return {
    ...mod,
    api: {
      ...mod.api,
      getRelease: vi.fn(),
      reviewsFor: vi.fn(),
      lists: vi.fn(),
      rate: vi.fn(),
      unrate: vi.fn(),
      logListen: vi.fn(),
      refreshRelease: vi.fn(),
    },
  };
});

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

/** What the server answers while enrichment is still running: the skeleton. */
const SKELETON = {
  id: "r1",
  title: "Sky Blue Sky",
  artistName: "Wilco",
  artist: null,
  label: null,
  releaseDate: "2007-05-11T00:00:00.000Z",
  genres: [],
  coverUrl: null,
  coverUrlLarge: null,
  coverColor: null,
  type: "ALBUM" as const,
  trackCount: null,
  similarArtists: [],
  enrichment: "pending" as const,
};

/** The same release once enrichment lands. */
const ENRICHED = {
  ...SKELETON,
  label: { id: "l1", name: "Nonesuch" },
  genres: ["indie", "alt-country"],
  coverUrl: "/covers/w400/aHR0cHM6Ly9jb3ZlcmFydGFyY2hpdmUub3JnL2EuanBn.webp",
  coverColor: "#d2d2d2",
  enrichment: "ready" as const,
};

/** MemoryRouter never touches window.location, so surface the path in the DOM. */
function CurrentPath() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

function renderRelease(route = "/release/r1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <CurrentPath />
        <Routes>
          <Route path="/release/:id" element={<Release />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.mocked(api.reviewsFor).mockResolvedValue({ reviews: [] } as never);
  vi.mocked(api.lists).mockResolvedValue({ lists: [] } as never);
});

describe("a release still being enriched", () => {
  it("says it is still fetching, rather than presenting the gaps as final", async () => {
    vi.mocked(api.getRelease).mockResolvedValue({ release: SKELETON } as never);
    renderRelease();

    expect(await screen.findByText("Sky Blue Sky")).toBeInTheDocument();
    expect(screen.getByText(/still fetching details/i)).toBeInTheDocument();
    // The status is announced, not just drawn.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("completes on its own — no rating, no click, no interaction", async () => {
    // Pending first, enriched on the next poll.
    vi.mocked(api.getRelease)
      .mockResolvedValueOnce({ release: SKELETON } as never)
      .mockResolvedValue({ release: ENRICHED } as never);

    renderRelease();
    expect(await screen.findByText(/still fetching details/i)).toBeInTheDocument();

    // Nothing is clicked, nothing is mutated. The page repairs itself.
    expect(await screen.findByText("Nonesuch")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText(/still fetching details/i)).not.toBeInTheDocument()
    );
    expect(api.rate).not.toHaveBeenCalled();
    expect(api.getRelease).toHaveBeenCalledTimes(2);
  });

  it("stops polling once the server says it is done", async () => {
    vi.mocked(api.getRelease).mockResolvedValue({ release: ENRICHED } as never);
    renderRelease();

    expect(await screen.findByText("Nonesuch")).toBeInTheDocument();
    const afterSettle = vi.mocked(api.getRelease).mock.calls.length;
    await new Promise((r) => setTimeout(r, 1200));
    expect(vi.mocked(api.getRelease).mock.calls.length).toBe(afterSettle);
  });
});

describe("a release whose enrichment broke", () => {
  it("shows a visible, retryable failure instead of loading forever", async () => {
    vi.mocked(api.getRelease).mockResolvedValue({
      release: { ...SKELETON, enrichment: "failed" as const },
    } as never);

    renderRelease();

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't be loaded/i);
    expect(screen.queryByText(/still fetching details/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("asks the SERVER to re-run enrichment — not merely refetch", async () => {
    // CONTRACT CHANGE (6.1.3): this case previously asserted that retry
    // refetched, and it passed while the product was broken. Refetching is
    // exactly what Movement (New Order) did 39 times without recovering: a GET
    // by internal id is a database read, so nothing re-executes the failed
    // stage. The retry has to be a mutation against the server.
    vi.mocked(api.getRelease)
      .mockResolvedValueOnce({ release: { ...SKELETON, enrichment: "failed" as const } } as never)
      .mockResolvedValue({ release: ENRICHED } as never);
    vi.mocked(api.refreshRelease).mockResolvedValue({ status: "pending" } as never);

    renderRelease();
    await userEvent.click(await screen.findByRole("button", { name: /try again/i }));

    expect(api.refreshRelease).toHaveBeenCalledWith("r1");
    expect(await screen.findByText("Nonesuch")).toBeInTheDocument();
  });

  it("surfaces a refused retry instead of appearing to do nothing", async () => {
    // A rate-limited retry that silently no-ops would be the same class of bug
    // one layer up.
    vi.mocked(api.getRelease).mockResolvedValue({
      release: { ...SKELETON, enrichment: "failed" as const },
    } as never);
    vi.mocked(api.refreshRelease).mockRejectedValue(
      new ApiError(429, "Just tried that — give it 42 more second(s).")
    );

    renderRelease();
    await userEvent.click(await screen.findByRole("button", { name: /try again/i }));

    expect(await screen.findByText(/give it 42 more second/i)).toBeInTheDocument();
  });

  it("does not poll a failed release", async () => {
    vi.mocked(api.getRelease).mockResolvedValue({
      release: { ...SKELETON, enrichment: "failed" as const },
    } as never);

    renderRelease();
    await screen.findByRole("alert");
    const calls = vi.mocked(api.getRelease).mock.calls.length;
    await new Promise((r) => setTimeout(r, 1200));
    expect(vi.mocked(api.getRelease).mock.calls.length).toBe(calls);
  });
});

describe("a release the server knows nothing new about", () => {
  it("says nothing when enrichment is ready", async () => {
    vi.mocked(api.getRelease).mockResolvedValue({ release: ENRICHED } as never);
    renderRelease();

    expect(await screen.findByText("Sky Blue Sky")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stays silent for a server that doesn't report enrichment at all", async () => {
    // Forward compatibility in reverse: an older payload has no `enrichment`,
    // and must behave exactly as it did before this shipped.
    const { enrichment, ...legacy } = ENRICHED;
    vi.mocked(api.getRelease).mockResolvedValue({ release: legacy } as never);
    renderRelease();

    expect(await screen.findByText("Sky Blue Sky")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("cache identity", () => {
  it("rewrites a source-ref URL to the resolved release id", async () => {
    // The stale-skeleton path: a page opened as /release/mb:<mbid> cached its
    // half-record under the REF, so a return visit re-served that skeleton in
    // preference to the enriched entry stored under the release's real id.
    vi.mocked(api.getRelease).mockResolvedValue({ release: ENRICHED } as never);
    renderRelease("/release/mb:1aa7ce82-1b74-3f83-b426-531edf4d4284");

    expect(await screen.findByText("Sky Blue Sky")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/release/r1"));
  });
});
