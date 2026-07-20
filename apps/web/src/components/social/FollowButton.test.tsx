import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    render(<FollowButton username="sasha" initialFollowing={false} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Follow" }));
    await waitFor(() => expect(api.follow).toHaveBeenCalledWith("sasha"));
    expect(screen.getByRole("button", { name: "Following" })).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(true, 1);
  });

  it("unfollows when already following", async () => {
    const user = userEvent.setup();
    vi.mocked(api.unfollow).mockResolvedValue({ following: false, followerCount: 0 });
    render(<FollowButton username="sasha" initialFollowing={true} />);

    await user.click(screen.getByRole("button", { name: "Following" }));
    await waitFor(() => expect(api.unfollow).toHaveBeenCalledWith("sasha"));
    expect(screen.getByRole("button", { name: "Follow" })).toBeInTheDocument();
  });

  it("hides itself on your own card and when logged out", () => {
    const { rerender } = render(<FollowButton username="blake" initialFollowing={false} />);
    expect(screen.queryByRole("button")).toBeNull(); // own username

    currentUser = null;
    rerender(<FollowButton username="sasha" initialFollowing={false} />);
    expect(screen.queryByRole("button")).toBeNull(); // logged out
  });
});
