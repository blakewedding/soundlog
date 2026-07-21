// Phase 5.6.1b — log-listen FEEDBACK states.
//
// The logs were persisting all along; the bug was that you couldn't tell. After
// a success the button flashed a confirmation and then settled back to the same
// "Log listen" label as never-having-logged — visually identical to a failure,
// which is why it read as data loss.
//
// Contract now, three distinguishable outcomes:
//   pending   → "Logging…"
//   succeeded → transient "Logged ✓", then settles to "Log again" (relistens are
//               valid, so the button stays usable) + a durable "In your diary" count
//   failed    → an alert with a retry, NO confirmation, and the count rolled back
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  myLogCount: 0,
};

/** Server-side log count, so the refetch in onSettled reconciles against real state. */
let serverLogCount = 0;

/** Observes the diary query — proves a logged listen reaches the same data. */
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

const logButton = () => screen.getByRole("button", { name: /^(log listen|log again|logged|logging)/i });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true }); // the confirmation is time-boxed
  serverLogCount = 0;
  vi.mocked(api.getRelease).mockImplementation(async () => ({
    release: { ...RELEASE, myLogCount: serverLogCount } as never,
  }));
  vi.mocked(api.reviewsFor).mockResolvedValue({ reviews: [] });
  vi.mocked(api.lists).mockResolvedValue({ lists: [] });
  vi.mocked(api.myDiary).mockResolvedValue({ logs: [], nextCursor: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("log listen — success feedback", () => {
  it("confirms with 'Logged ✓', then settles to a still-usable 'Log again'", async () => {
    vi.mocked(api.logListen).mockImplementation(async () => {
      serverLogCount += 1;
      return { log: {} };
    });

    renderRelease();
    expect(await screen.findByRole("button", { name: /log listen/i })).toBeInTheDocument();

    await userEvent.click(logButton());

    // 1. Success is explicitly confirmed — not silent.
    expect(await screen.findByRole("button", { name: /logged ✓/i })).toBeInTheDocument();

    // 2. After the confirmation elapses it must NOT revert to the never-logged
    //    label; it settles into a loggable "Log again" (relistens are valid).
    await vi.advanceTimersByTimeAsync(2600);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /log again/i })).toBeInTheDocument()
    );
    expect(screen.queryByRole("button", { name: /^log listen$/i })).not.toBeInTheDocument();
    // And it stays clickable.
    expect(screen.getByRole("button", { name: /log again/i })).toBeEnabled();
  });

  it("shows the listen count at a glance, and increments it on a relisten", async () => {
    vi.mocked(api.logListen).mockImplementation(async () => {
      serverLogCount += 1;
      return { log: {} };
    });

    renderRelease();
    await screen.findByRole("button", { name: /log listen/i });
    // Nothing logged yet → no count shown.
    expect(screen.queryByText(/in your diary/i)).not.toBeInTheDocument();

    await userEvent.click(logButton());
    // First log: present, but no "×1" noise.
    const badge = await screen.findByText(/in your diary/i);
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).not.toMatch(/×/);

    await vi.advanceTimersByTimeAsync(2600);
    await userEvent.click(screen.getByRole("button", { name: /log again/i }));

    // Second log (a relisten) → ×2.
    await waitFor(() => expect(screen.getByText(/in your diary ×2/i)).toBeInTheDocument());
  });

  it("updates the count optimistically, before the server responds", async () => {
    let release!: () => void;
    vi.mocked(api.logListen).mockImplementation(
      () => new Promise((res) => { release = () => res({ log: {} } as never); })
    );

    renderRelease();
    await screen.findByRole("button", { name: /log listen/i });
    await userEvent.click(logButton());

    // Still in flight, yet the count already reads.
    expect(await screen.findByText(/in your diary/i)).toBeInTheDocument();
    serverLogCount = 1;
    release();
  });
});

describe("log listen — failure feedback is visually distinct", () => {
  it("shows an alert with retry, no confirmation, and rolls the count back", async () => {
    vi.mocked(api.logListen).mockRejectedValue(new Error("network down"));

    renderRelease();
    await screen.findByRole("button", { name: /log listen/i });
    await userEvent.click(logButton());

    // The failure is stated...
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't log that listen/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();

    // ...and is unmistakably NOT a success: no confirmation, no count, and the
    // button is still the never-logged label.
    expect(screen.queryByRole("button", { name: /logged ✓/i })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/in your diary/i)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^log listen$/i })).toBeInTheDocument();
  });

  it("distinguishes an expired session from a generic failure", async () => {
    vi.mocked(api.logListen).mockRejectedValue(new ApiError(401, "Invalid or expired access token"));

    renderRelease();
    await screen.findByRole("button", { name: /log listen/i });
    await userEvent.click(logButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/session expired/i);
  });

  it("recovers to the success story when a retry succeeds", async () => {
    vi.mocked(api.logListen)
      .mockRejectedValueOnce(new Error("blip"))
      .mockImplementation(async () => {
        serverLogCount += 1;
        return { log: {} };
      });

    renderRelease();
    await screen.findByRole("button", { name: /log listen/i });
    await userEvent.click(logButton());
    await screen.findByRole("alert");

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByRole("button", { name: /logged ✓/i })).toBeInTheDocument();
    expect(await screen.findByText(/in your diary/i)).toBeInTheDocument();
  });
});
