import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommentThread } from "./CommentThread";
import { api, type CommentDTO } from "../../services/api";

vi.mock("../../services/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../services/api")>();
  return {
    ...mod,
    api: {
      ...mod.api,
      commentsFor: vi.fn(),
      addComment: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
    },
  };
});

const ME = { id: "me", username: "blake", displayName: null, avatarUrl: null };
vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: ME, loading: false }),
}));

const mockedComments = vi.mocked(api.commentsFor);
const mockedUpdate = vi.mocked(api.updateComment);

function renderThread() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CommentThread reviewId="rev1" />
    </QueryClientProvider>
  );
}

const OTHER = { id: "u2", username: "sasha", displayName: null, avatarUrl: null };

function thread(): { comments: CommentDTO[] } {
  return {
    comments: [
      {
        id: "c1",
        parentId: null,
        content: "Completely agree.",
        deleted: false,
        user: OTHER,
        createdAt: "2026-07-01T00:00:00Z",
        replies: [
          {
            id: "c2",
            parentId: "c1",
            content: "Me too.",
            deleted: false,
            user: ME,
            createdAt: "2026-07-02T00:00:00Z",
          },
        ],
      },
      {
        id: "c3",
        parentId: null,
        content: null,
        deleted: true,
        user: null,
        createdAt: "2026-07-03T00:00:00Z",
        replies: [
          {
            id: "c4",
            parentId: "c3",
            content: "Orphaned but alive.",
            deleted: false,
            user: OTHER,
            createdAt: "2026-07-04T00:00:00Z",
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  vi.mocked(api.commentsFor).mockReset();
  mockedUpdate.mockReset();
});

describe("CommentThread", () => {
  it("offers Reply only on top-level comments (one nesting level)", async () => {
    mockedComments.mockResolvedValue(thread());
    renderThread();
    await screen.findByText("Completely agree.");

    // Two top-level comments, but the deleted one gets no Reply either — so
    // exactly one Reply affordance, and none on the reply itself.
    expect(screen.getAllByRole("button", { name: "Reply" })).toHaveLength(1);
    expect(screen.getByText("Me too.")).toBeInTheDocument(); // reply rendered flat
  });

  it("renders soft-deleted parents as placeholders with replies intact", async () => {
    mockedComments.mockResolvedValue(thread());
    renderThread();

    expect(await screen.findByText("[comment deleted]")).toBeInTheDocument();
    expect(screen.getByText("Orphaned but alive.")).toBeInTheDocument();
  });

  it("lets me edit my own comment via the PATCH endpoint", async () => {
    const user = userEvent.setup();
    mockedComments.mockResolvedValue(thread());
    mockedUpdate.mockResolvedValue({ comment: {} as CommentDTO });
    renderThread();
    await screen.findByText("Me too.");

    // Only my comment (c2) carries an Edit control.
    const edits = screen.getAllByRole("button", { name: "Edit" });
    expect(edits).toHaveLength(1);
    await user.click(edits[0]);

    const box = screen.getByRole("textbox", { name: "Edit comment" });
    await user.clear(box);
    await user.type(box, "Me too — edited.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledWith("c2", "Me too — edited."));
  });
});
