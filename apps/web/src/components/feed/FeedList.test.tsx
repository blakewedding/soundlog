// The feed must reuse ReviewCard / StarRating / release cards — no parallel
// review or rating presentations. These tests pin that: a REVIEW feed item is
// rendered by the very same ReviewCard used elsewhere, and a RATING item uses
// the shared StarRating glyphs.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { FeedItem } from "@soundlog/shared";
import { FeedList } from "./FeedList";

// Spy on ReviewCard to prove the feed delegates to it rather than reimplementing.
vi.mock("../review/ReviewCard", () => ({
  ReviewCard: ({ review }: { review: { content: string } }) => (
    <div data-testid="review-card">{review.content}</div>
  ),
}));

const user = { id: "u1", username: "sasha", displayName: "Sasha" };

function renderFeed(items: FeedItem[]) {
  return render(
    <MemoryRouter>
      <FeedList items={items} />
    </MemoryRouter>
  );
}

describe("FeedList", () => {
  it("renders a REVIEW item through the shared ReviewCard", () => {
    const items: FeedItem[] = [
      {
        id: "a1",
        type: "REVIEW",
        createdAt: "2026-07-18T00:00:00Z",
        user,
        review: {
          id: "r1",
          user,
          release: { id: "rel1", title: "Untrue", artistName: "Burial" },
          content: "A landmark.",
          rating: 5,
          containsSpoilers: false,
          likeCount: 3,
          commentCount: 1,
          likedByMe: false,
          createdAt: "2026-07-18T00:00:00Z",
        },
      },
    ];
    renderFeed(items);
    expect(screen.getByTestId("review-card")).toHaveTextContent("A landmark.");
  });

  it("renders a RATING item with the shared gold star glyphs", () => {
    const items: FeedItem[] = [
      {
        id: "a2",
        type: "RATING",
        createdAt: "2026-07-18T00:00:00Z",
        user,
        release: { id: "rel2", title: "Dynamo", artistName: "Soda Stereo", type: "ALBUM" },
        rating: 4.5,
      },
    ];
    renderFeed(items);
    // StarRating renders ★★★★½ for 4.5 and an accessible label.
    expect(screen.getByLabelText("Rated 4.5 out of 5")).toBeInTheDocument();
    expect(screen.getByText(/rated/i)).toBeInTheDocument();
    expect(screen.getByText("Dynamo")).toBeInTheDocument();
  });

  it("renders LOG, LIST and FOLLOW items with links to the right targets", () => {
    const items: FeedItem[] = [
      {
        id: "a3",
        type: "LOG",
        createdAt: "2026-07-18T00:00:00Z",
        user,
        release: { id: "rel3", title: "Loveless", artistName: "My Bloody Valentine", type: "ALBUM" },
      },
      {
        id: "a4",
        type: "LIST_CREATE",
        createdAt: "2026-07-18T00:00:00Z",
        user,
        list: { id: "l1", title: "Best of 92", itemCount: 5 },
      },
      {
        id: "a5",
        type: "FOLLOW",
        createdAt: "2026-07-18T00:00:00Z",
        user,
        targetUser: { id: "u2", username: "blake", displayName: "Blake" },
      },
    ];
    renderFeed(items);
    expect(screen.getByRole("link", { name: "Loveless" })).toHaveAttribute("href", "/release/rel3");
    expect(screen.getByRole("link", { name: "Best of 92" })).toHaveAttribute("href", "/list/l1");
    expect(screen.getByRole("link", { name: "Blake" })).toHaveAttribute("href", "/blake");
  });
});
