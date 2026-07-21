// Phase 5.5 — follow/unfollow joins the optimistic contract (CLAUDE.md §6):
// the label flips before the server answers, and a failure rolls back visibly
// with a retry rather than silently doing nothing.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FollowButton } from "./FollowButton";
import { api } from "../../services/api";

vi.mock("../../services/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../services/api")>();
  return { ...mod, api: { ...mod.api, follow: vi.fn(), unfollow: vi.fn() } };
});

let currentUser: { id: string; username: string } | null = { id: "me", username: "blake" };
vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: currentUser, loading: false }),
}));

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

function renderButton(props: Partial<Parameters<typeof FollowButton>[0]> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FollowButton username="sasha" initialFollowing={false} {...props} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  currentUser = { id: "me", username: "blake" };
  vi.mocked(api.follow).mockReset();
  vi.mocked(api.unfollow).mockReset();
});

describe("FollowButton", () => {
  it("follows on click and flips to Following", async () => {
    const user = userEvent.setup();
    vi.mocked(api.follow).mockResolvedValue({ following: true, followerCount: 1 });
    const onChange = vi.fn();
    renderButton({ onChange });

    await user.click(screen.getByRole("button", { name: "Follow" }));
    await waitFor(() => expect(api.follow).toHaveBeenCalledWith("sasha"));
    expect(screen.getByRole("button", { name: "Following" })).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(true, 1);
  });

  it("unfollows when already following", async () => {
    const user = userEvent.setup();
    vi.mocked(api.unfollow).mockResolvedValue({ following: false, followerCount: 0 });
    renderButton({ initialFollowing: true });

    await user.click(screen.getByRole("button", { name: "Following" }));
    await waitFor(() => expect(api.unfollow).toHaveBeenCalledWith("sasha"));
    expect(screen.getByRole("button", { name: "Follow" })).toBeInTheDocument();
  });

  it("flips optimistically, before the server responds", async () => {
    const user = userEvent.setup();
    const d = deferred<{ following: boolean; followerCount: number }>();
    vi.mocked(api.follow).mockReturnValue(d.promise);
    renderButton();

    await user.click(screen.getByRole("button", { name: "Follow" }));

    // Still in flight — the label has already moved.
    expect(screen.getByRole("button", { name: "Following" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Following" })).toHaveAttribute("aria-pressed", "true");

    d.resolve({ following: true, followerCount: 9 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Following" })).toBeEnabled());
  });

  it("rolls back and offers a retry when the write fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.follow).mockRejectedValue(new Error("network"));
    renderButton();

    await user.click(screen.getByRole("button", { name: "Follow" }));

    // Rolled back to Follow, and the failure is visible rather than silent.
    await waitFor(() => expect(screen.getByRole("button", { name: "Follow" })).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't follow.");

    // Retry re-issues the write.
    vi.mocked(api.follow).mockResolvedValue({ following: true, followerCount: 1 });
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Following" })).toBeInTheDocument());
    expect(api.follow).toHaveBeenCalledTimes(2);
  });

  it("hides itself on your own card and when logged out", () => {
    const { rerender } = renderButton({ username: "blake" });
    expect(screen.queryByRole("button")).toBeNull(); // own username

    currentUser = null;
    const client = new QueryClient();
    rerender(
      <QueryClientProvider client={client}>
        <FollowButton username="sasha" initialFollowing={false} />
      </QueryClientProvider>
    );
    expect(screen.queryByRole("button")).toBeNull(); // logged out
  });
});
