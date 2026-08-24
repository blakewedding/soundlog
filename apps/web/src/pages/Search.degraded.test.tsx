/**
 * 6.3e — the three outcomes, at the surface.
 *
 * The backend now answers an unreachable MusicBrainz with 503 instead of an
 * empty 200. That is only worth doing if the DIFFERENCE survives to what a
 * person reads: an empty result and a failed request rendering as the same grey
 * line would keep the original bug alive at the last layer, where it is least
 * visible and most consequential.
 *
 * So these assert the distinction directly — different role, different text,
 * different affordances — rather than asserting that some error appeared.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Search from "./Search";
import { api, ApiError } from "../services/api";

vi.mock("../services/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../services/api")>();
  return { ...mod, api: { ...mod.api, search: vi.fn() } };
});

const EMPTY = { results: [], artists: [], members: [], lists: [], labels: [] };

function renderSearch() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Search />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe("an upstream outage is not 'no results'", () => {
  it("shows a degraded banner with a retry, not the empty-state copy", async () => {
    vi.mocked(api.search).mockRejectedValue(
      new ApiError(503, "Upstream metadata source is busy — please retry in a moment.", undefined, 2)
    );

    renderSearch();
    await userEvent.type(screen.getByLabelText("Search Soundlog"), "chromatics");

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(/catalog upstream is busy/i);
    // A retry affordance is required for a visible failure (§6).
    expect(screen.getByRole("button", { name: /try now/i })).toBeInTheDocument();

    // The distinction that matters: it must NOT claim there is nothing.
    expect(screen.queryByText(/Nothing found/i)).not.toBeInTheDocument();
  });

  it("shows the empty state — and no alert — when the search genuinely succeeds with nothing", async () => {
    vi.mocked(api.search).mockResolvedValue({ ...EMPTY } as never);

    renderSearch();
    await userEvent.type(screen.getByLabelText("Search Soundlog"), "zzzzznotathing");

    await waitFor(() => expect(screen.getByText(/Nothing found/i)).toBeInTheDocument());
    // The other half of the distinction: an empty result is not an alarm.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("retries on the server's schedule, and recovers", async () => {
    vi.mocked(api.search)
      .mockRejectedValueOnce(new ApiError(503, "busy", undefined, 0))
      .mockResolvedValue({ ...EMPTY, artists: [
        { ref: "a1", id: "a1", name: "Chromatics", latinName: null, type: null, area: null, releaseCount: 1 },
      ] } as never);

    renderSearch();
    await userEvent.type(screen.getByLabelText("Search Soundlog"), "chromatics");

    // The 503 is retried (Retry-After: 0) and the recovery replaces the banner.
    await waitFor(() => expect(screen.getByText("Chromatics")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does NOT retry a non-503 failure — retrying a bug just fails slower", async () => {
    vi.mocked(api.search).mockRejectedValue(new ApiError(400, "Bad query"));

    renderSearch();
    await userEvent.type(screen.getByLabelText("Search Soundlog"), "chromatics");

    await waitFor(() =>
      expect(screen.getByText(/Search is unavailable right now/i)).toBeInTheDocument()
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(vi.mocked(api.search)).toHaveBeenCalledTimes(1);
  });
});
