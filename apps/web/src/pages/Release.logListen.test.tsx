// Phase 5.6.1 regression — "Log listen" showed success then the log didn't stick.
//
// Two defects compounded:
//   1. logListen was a bare `await` with no error handling, so a failed request
//      became an unhandled rejection and the click looked like it did nothing.
//   2. request() had no 401 -> refresh -> retry, so once the 15-minute access
//      token aged out EVERY write silently failed.
//
// Contract now: successes are durable (and survive a stale access token),
// failures are visible with a retry affordance.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
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
      logListen: vi.fn(),
      myDiary: vi.fn(),
    },
  };
});

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "me", username: "blake" }, loading: false }),
}));

const RELEASE = {
  id: "r1",
  title: "Anti EP",
  artistName: "Autechre",
  artist: null,
  label: null,
  releaseDate: "1994-01-01T00:00:00.000Z",
  genres: [],
  coverUrl: null,
  coverUrlLarge: null,
  type: "EP" as const,
  trackCount: null,
  avgRating: undefined,
  ratingCount: 0,
  similarArtists: [],
};

/** Observes the diary query so we can prove a logged listen actually lands. */
function DiaryProbe() {
  const { data } = useQuery({ queryKey: ["diary"], queryFn: () => api.myDiary() });
  return <div data-testid="diary-count">{data?.logs.length ?? 0}</div>;
}

function renderRelease() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/release/r1"]}>
        <Routes>
          <Route
            path="/release/:id"
            element={
              <>
                <Release />
                <DiaryProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  // Call counts and per-test implementations must not leak between cases —
  // toHaveBeenCalledTimes assertions are cumulative otherwise.
  vi.clearAllMocks();
  vi.mocked(api.getRelease).mockResolvedValue({ release: { ...RELEASE } as never });
  vi.mocked(api.reviewsFor).mockResolvedValue({ reviews: [] });
  vi.mocked(api.lists).mockResolvedValue({ lists: [] });
  vi.mocked(api.myDiary).mockResolvedValue({ logs: [], nextCursor: null });
});

describe("Release — log listen", () => {
  it("persists the listen and refreshes the diary", async () => {
    vi.mocked(api.logListen).mockResolvedValue({ log: {} });
    // Empty diary first, then one entry once the listen lands.
    vi.mocked(api.myDiary)
      .mockResolvedValueOnce({ logs: [], nextCursor: null })
      .mockResolvedValue({ logs: [{ id: "l1" } as never], nextCursor: null });

    renderRelease();
    const btn = await screen.findByRole("button", { name: /log listen/i });
    await waitFor(() => expect(screen.getByTestId("diary-count")).toHaveTextContent("0"));

    await userEvent.click(btn);

    await waitFor(() => expect(api.logListen).toHaveBeenCalledWith("r1"));
    // Success is shown...
    expect(await screen.findByRole("button", { name: /logged/i })).toBeInTheDocument();
    // ...and the log actually stuck.
    await waitFor(() => expect(screen.getByTestId("diary-count")).toHaveTextContent("1"));
  });

  it("surfaces a failure with a retry affordance instead of failing silently", async () => {
    vi.mocked(api.logListen).mockRejectedValue(new Error("network down"));

    renderRelease();
    await userEvent.click(await screen.findByRole("button", { name: /log listen/i }));

    // The old behaviour was an unhandled rejection and NO visible change.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't log that listen/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    // It must not claim success.
    expect(screen.queryByRole("button", { name: /logged ✓/i })).not.toBeInTheDocument();
  });

  it("explains an expired session rather than a generic error", async () => {
    vi.mocked(api.logListen).mockRejectedValue(new ApiError(401, "Invalid or expired access token"));

    renderRelease();
    await userEvent.click(await screen.findByRole("button", { name: /log listen/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/session expired/i);
  });

  it("retry succeeds after a transient failure", async () => {
    vi.mocked(api.logListen)
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValue({ log: {} });

    renderRelease();
    await userEvent.click(await screen.findByRole("button", { name: /log listen/i }));
    await screen.findByRole("alert");

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(api.logListen).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: /logged/i })).toBeInTheDocument();
  });
});
