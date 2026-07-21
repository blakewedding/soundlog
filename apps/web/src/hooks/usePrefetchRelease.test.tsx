// Phase 5.5 — hover prefetch must never seed the catalog.
//
// GET /api/releases/<source>:<id> is seed-on-first-access: it creates a Release
// row and spends a slot on the process-wide 1 req/s MusicBrainz throttle. A
// mouse crossing a search grid must not do that, so the guard is the part of
// this feature worth testing.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isPrefetchableRef, usePrefetchRelease } from "./usePrefetchRelease";
import { api } from "../services/api";

vi.mock("../services/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../services/api")>();
  return { ...mod, api: { ...mod.api, getRelease: vi.fn() } };
});

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "me", username: "blake" }, loading: false }),
}));

function Probe({ refs }: { refs: string[] }) {
  const prefetch = usePrefetchRelease();
  return (
    <>
      {refs.map((r) => (
        <button key={r} onMouseEnter={() => prefetch(r)}>
          {r}
        </button>
      ))}
    </>
  );
}

function renderProbe(refs: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Probe refs={refs} />
    </QueryClientProvider>
  );
  return client;
}

beforeEach(() => {
  vi.mocked(api.getRelease).mockReset();
  vi.mocked(api.getRelease).mockResolvedValue({ release: { id: "seeded" } } as never);
});

describe("isPrefetchableRef", () => {
  it("accepts internal catalog ids", () => {
    expect(isPrefetchableRef("cmrtfhkbb0001ydwosn17xikz")).toBe(true);
  });

  it("refuses every un-seeded source ref", () => {
    // Each of these WRITES on GET. None may be triggered by a hover.
    expect(isPrefetchableRef("mb:f9e5bad8-72fc-45c9-8fe6-d9b7826b3771")).toBe(false);
    expect(isPrefetchableRef("master:12345")).toBe(false);
    expect(isPrefetchableRef("release:12345")).toBe(false);
    expect(isPrefetchableRef("spotify:4aawyAB9vmqN3uQ7FjRGTy")).toBe(false);
    expect(isPrefetchableRef("discogs:98765")).toBe(false);
  });

  it("refuses an empty ref", () => {
    expect(isPrefetchableRef("")).toBe(false);
  });
});

describe("usePrefetchRelease", () => {
  it("warms the cache for a seeded release on hover", async () => {
    const user = userEvent.setup();
    renderProbe(["cmrtfhkbb0001ydwosn17xikz"]);

    await user.hover(screen.getByRole("button", { name: "cmrtfhkbb0001ydwosn17xikz" }));
    await waitFor(() => expect(api.getRelease).toHaveBeenCalledWith("cmrtfhkbb0001ydwosn17xikz"));
  });

  it("issues no request at all for an un-seeded ref", async () => {
    const user = userEvent.setup();
    renderProbe(["mb:f9e5bad8-72fc-45c9-8fe6-d9b7826b3771"]);

    await user.hover(screen.getByRole("button", { name: "mb:f9e5bad8-72fc-45c9-8fe6-d9b7826b3771" }));
    // Give any stray async work a chance to fire before asserting the absence.
    await new Promise((r) => setTimeout(r, 20));
    expect(api.getRelease).not.toHaveBeenCalled();
  });

  it("caches under the key the release page reads", async () => {
    const user = userEvent.setup();
    const client = renderProbe(["abc123"]);

    await user.hover(screen.getByRole("button", { name: "abc123" }));
    await waitFor(() =>
      expect(client.getQueryData(["release", "abc123", "me"])).toEqual({ release: { id: "seeded" } })
    );
  });

  it("does not re-request while the prefetched data is still fresh", async () => {
    const user = userEvent.setup();
    renderProbe(["abc123"]);
    const btn = screen.getByRole("button", { name: "abc123" });

    await user.hover(btn);
    await waitFor(() => expect(api.getRelease).toHaveBeenCalledTimes(1));
    await user.unhover(btn);
    await user.hover(btn);
    await new Promise((r) => setTimeout(r, 20));
    expect(api.getRelease).toHaveBeenCalledTimes(1);
  });
});
