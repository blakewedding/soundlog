// Phase 5.7 — the star input must respond instantly, reconcile with the server,
// and roll back on failure (the same contract as the 4.1 like button).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Release from "./Release";
import { api } from "../services/api";

vi.mock("../services/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../services/api")>();
  return {
    ...mod,
    api: { ...mod.api, getRelease: vi.fn(), reviewsFor: vi.fn(), lists: vi.fn(), rate: vi.fn(), unrate: vi.fn() },
  };
});

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "me", username: "blake" }, loading: false }),
}));

const RELEASE = {
  id: "r1",
  title: "Dynamo",
  artistName: "Soda Stereo",
  artist: null,
  label: null,
  releaseDate: "1992-01-01T00:00:00.000Z",
  genres: [],
  coverUrl: null,
  coverUrlLarge: null,
  type: "ALBUM" as const,
  trackCount: null,
  avgRating: 4,
  ratingCount: 2,
  similarArtists: [],
  myRating: undefined as number | undefined,
};

/** A promise we can resolve/reject by hand, to observe the pending window. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderRelease() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/release/r1"]}>
        <Routes>
          <Route path="/release/:id" element={<Release />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// The server's stored rating. getRelease reads it, so the refetch triggered by
// onSettled reconciles against real persisted state rather than a frozen stub.
let serverRating: number | null = null;

beforeEach(() => {
  serverRating = null;
  vi.mocked(api.getRelease).mockImplementation(async () => ({
    release: { ...RELEASE, myRating: serverRating ?? undefined } as never,
  }));
  vi.mocked(api.reviewsFor).mockResolvedValue({ reviews: [] });
  vi.mocked(api.lists).mockResolvedValue({ lists: [] });
});

describe("Release — optimistic rating", () => {
  it("shows the new rating immediately, before the server responds", async () => {
    const pending = deferred<{ rating: { value: number } }>();
    vi.mocked(api.rate).mockReturnValue(pending.promise as never);

    renderRelease();
    const slider = await screen.findByRole("slider", { name: /your rating/i });
    expect(slider).toHaveAttribute("aria-valuetext", "Not rated");

    await userEvent.click(within(slider).getByTestId("rate-4"));

    // Still in flight — but the stars have already moved.
    await waitFor(() =>
      expect(screen.getByRole("slider", { name: /your rating/i })).toHaveAttribute(
        "aria-valuenow",
        "4"
      )
    );
    expect(api.rate).toHaveBeenCalledWith("r1", 4);

    serverRating = 4; // the write lands
    pending.resolve({ rating: { value: 4 } });
    await waitFor(() =>
      expect(screen.getByRole("slider", { name: /your rating/i })).toHaveAttribute(
        "aria-valuenow",
        "4"
      )
    );
  });

  it("reconciles to the value the server returns", async () => {
    // Server stores 3.5 even though 4 was requested — the UI must follow the server.
    vi.mocked(api.rate).mockImplementation(async () => {
      serverRating = 3.5;
      return { rating: { value: 3.5 } } as never;
    });

    renderRelease();
    const slider = await screen.findByRole("slider", { name: /your rating/i });
    await userEvent.click(within(slider).getByTestId("rate-4"));

    await waitFor(() =>
      expect(screen.getByRole("slider", { name: /your rating/i })).toHaveAttribute(
        "aria-valuenow",
        "3.5"
      )
    );
  });

  it("rolls back when the request fails", async () => {
    vi.mocked(api.rate).mockRejectedValue(new Error("network down"));

    renderRelease();
    const slider = await screen.findByRole("slider", { name: /your rating/i });
    expect(slider).toHaveAttribute("aria-valuetext", "Not rated");

    await userEvent.click(within(slider).getByTestId("rate-5"));

    // Rolled back to unrated rather than stranding an optimistic 5.
    await waitFor(() =>
      expect(screen.getByRole("slider", { name: /your rating/i })).toHaveAttribute(
        "aria-valuetext",
        "Not rated"
      )
    );
  });
});
