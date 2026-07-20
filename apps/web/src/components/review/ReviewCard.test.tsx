// ReviewCard is interactive wherever it mounts: optimistic like (with rollback
// on server error) and a lazily-expanded comment thread. Rendered through a real
// QueryClient with the review seeded in a query, mirroring how surfaces feed it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { FeedReview } from "@soundlog/shared";
import { ReviewCard } from "./ReviewCard";
import { api } from "../../services/api";

vi.mock("../../services/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../services/api")>();
  return {
    ...mod,
    api: { ...mod.api, likeReview: vi.fn(), unlikeReview: vi.fn(), commentsFor: vi.fn() },
  };
});

let currentUser: { id: string; username: string } | null = { id: "me", username: "blake" };
vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: currentUser, loading: false }),
}));

const baseReview: FeedReview = {
  id: "rev1",
  user: { id: "u2", username: "sasha", displayName: "Sasha" },
  release: { id: "rel1", title: "Untrue", artistName: "Burial" },
  content: "A landmark.",
  rating: 5,
  containsSpoilers: false,
  likeCount: 2,
  commentCount: 0,
  likedByMe: false,
  createdAt: "2026-07-18T00:00:00Z",
};

// Drive ReviewCard from a query (["reviews"]) so cache patches flow to props,
// exactly like the real surfaces.
function Harness() {
  const { data } = useQuery({
    queryKey: ["reviews", "rel1"],
    queryFn: async () => ({ reviews: [baseReview] }),
  });
  const review = data?.reviews[0];
  return review ? <ReviewCard review={review} /> : null;
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return client;
}

beforeEach(() => {
  currentUser = { id: "me", username: "blake" };
  vi.mocked(api.likeReview).mockReset();
  vi.mocked(api.unlikeReview).mockReset();
  vi.mocked(api.commentsFor).mockReset();
});

describe("ReviewCard — optimistic like", () => {
  it("updates count/fill immediately and reconciles with the server", async () => {
    const user = userEvent.setup();
    // Server confirms with the authoritative count.
    vi.mocked(api.likeReview).mockResolvedValue({ likeCount: 3, likedByMe: true });
    renderCard();

    const likeBtn = await screen.findByRole("button", { name: "Like" });
    expect(likeBtn).toHaveTextContent("♥ 2");

    await user.click(likeBtn);
    // Optimistic: flips to liked + count 3 before the server would even respond.
    await waitFor(() => expect(screen.getByRole("button", { name: "Unlike" })).toHaveTextContent("♥ 3"));
    expect(api.likeReview).toHaveBeenCalledWith("rev1");
  });

  it("rolls back the optimistic update when the server errors", async () => {
    const user = userEvent.setup();
    vi.mocked(api.likeReview).mockRejectedValue(new Error("500"));
    renderCard();

    const likeBtn = await screen.findByRole("button", { name: "Like" });
    await user.click(likeBtn);

    // Briefly optimistic, then reverts to the original 2 / unliked.
    await waitFor(() => expect(screen.getByRole("button", { name: "Like" })).toHaveTextContent("♥ 2"));
  });

  it("prompts login instead of liking when logged out", async () => {
    currentUser = null;
    const user = userEvent.setup();
    renderCard();
    const likeBtn = await screen.findByRole("button", { name: "Like" });
    await user.click(likeBtn);
    expect(api.likeReview).not.toHaveBeenCalled();
  });
});

describe("ReviewCard — lazy comment thread", () => {
  it("does not fetch comments until the 💬 button is tapped, then loads inline", async () => {
    const user = userEvent.setup();
    vi.mocked(api.commentsFor).mockResolvedValue({ comments: [] });
    renderCard();

    await screen.findByRole("button", { name: "Like" });
    // Not fetched on mount.
    expect(api.commentsFor).not.toHaveBeenCalled();

    const commentBtn = screen.getByRole("button", { expanded: false });
    await user.click(commentBtn);

    // Now the thread mounts and fetches once.
    await waitFor(() => expect(api.commentsFor).toHaveBeenCalledWith("rev1"));
    expect(await screen.findByText("No comments yet.")).toBeInTheDocument();
  });
});
