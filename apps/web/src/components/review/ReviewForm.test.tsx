import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewForm } from "./ReviewForm";
import { api, ApiError } from "../../services/api";

vi.mock("../../services/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../services/api")>();
  return {
    ...mod,
    api: { ...mod.api, createReview: vi.fn(), updateReview: vi.fn() },
  };
});

const mockedCreate = vi.mocked(api.createReview);

beforeEach(() => {
  mockedCreate.mockReset();
});

describe("ReviewForm", () => {
  it("surfaces the one-review-per-release 409 message inline", async () => {
    const user = userEvent.setup();
    mockedCreate.mockRejectedValue(
      new ApiError(409, "You've already reviewed this release — edit your existing review instead")
    );
    render(<ReviewForm releaseId="rel1" onSaved={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(/what did this record do/i), "Twice as good");
    await user.click(screen.getByRole("button", { name: /post review/i }));

    expect(
      await screen.findByText(/already reviewed this release — edit your existing review/i)
    ).toBeInTheDocument();
  });

  it("submits content + rating + spoilers and resets on success", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    mockedCreate.mockResolvedValue({ review: { id: "r1" } as never });
    render(<ReviewForm releaseId="rel1" onSaved={onSaved} />);

    await user.type(screen.getByPlaceholderText(/what did this record do/i), "Essential.");
    await user.click(screen.getByTestId("rate-4.5"));
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /post review/i }));

    expect(mockedCreate).toHaveBeenCalledWith({
      releaseId: "rel1",
      content: "Essential.",
      rating: 4.5,
      containsSpoilers: true,
    });
    expect(onSaved).toHaveBeenCalled();
    expect(screen.getByPlaceholderText(/what did this record do/i)).toHaveValue("");
  });
});
