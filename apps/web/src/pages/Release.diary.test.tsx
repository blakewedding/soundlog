// Regression: logging a listen didn't invalidate the diary query, so new diary
// entries took ages to appear. This drives the real Release page's "Log listen"
// button and asserts a diary observer refetches immediately.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import Release from "./Release";
import { api } from "../services/api";

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
  title: "Dynamo",
  artistName: "Soda Stereo",
  artist: { id: "a1", name: "Soda Stereo" },
  releaseDate: "1992-01-01T00:00:00.000Z",
  genres: ["rock"],
  coverUrl: null,
  coverUrlLarge: null,
  type: "ALBUM" as const,
  trackCount: null,
  avgRating: undefined,
  ratingCount: 0,
  similarArtists: [],
};

// A sibling that observes the diary query, so invalidation forces a live refetch.
function DiaryProbe() {
  const { data } = useQuery({ queryKey: ["diary"], queryFn: () => api.myDiary() });
  return <div data-testid="diary-count">{data?.logs.length ?? 0}</div>;
}

beforeEach(() => {
  vi.mocked(api.getRelease).mockResolvedValue({ release: RELEASE as never });
  vi.mocked(api.reviewsFor).mockResolvedValue({ reviews: [] });
  vi.mocked(api.lists).mockResolvedValue({ lists: [] });
  vi.mocked(api.logListen).mockResolvedValue({ log: {} });
  // Empty diary first, then one entry after the listen is logged.
  vi.mocked(api.myDiary)
    .mockResolvedValueOnce({ logs: [], nextCursor: null })
    .mockResolvedValue({ logs: [{ id: "l1" } as never], nextCursor: null });
});

describe("Release → Log listen", () => {
  it("invalidates the diary so a new listen appears immediately", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
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

    // Wait for the release to load (skeleton → real page) and the diary probe.
    const logBtn = await screen.findByRole("button", { name: /log listen/i });
    await waitFor(() => expect(screen.getByTestId("diary-count")).toHaveTextContent("0"));
    expect(api.myDiary).toHaveBeenCalledTimes(1);

    await userEvent.click(logBtn);

    // The log mutation fired and the diary refetched (now shows the new entry).
    await waitFor(() => expect(api.logListen).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(screen.getByTestId("diary-count")).toHaveTextContent("1"));
    expect(api.myDiary).toHaveBeenCalledTimes(2);
  });
});
