import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StarRatingInput } from "./StarRatingInput";

describe("StarRatingInput", () => {
  it("commits half-star values from the left hit zone and full from the right", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StarRatingInput value={null} onChange={onChange} />);

    await user.click(screen.getByTestId("rate-3.5")); // left half of star 4
    expect(onChange).toHaveBeenLastCalledWith(3.5);

    await user.click(screen.getByTestId("rate-5")); // right half of star 5
    expect(onChange).toHaveBeenLastCalledWith(5);
  });

  it("adjusts by half a star with arrow keys", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StarRatingInput value={3} onChange={onChange} />);

    const slider = screen.getByRole("slider", { name: "Your rating" });
    slider.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(3.5);
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith(2.5);
  });

  it("caps at 5 and clears below 0.5 / on Delete", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClear = vi.fn();

    const { rerender } = render(<StarRatingInput value={5} onChange={onChange} onClear={onClear} />);
    const slider = screen.getByRole("slider", { name: "Your rating" });
    slider.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(5); // capped

    rerender(<StarRatingInput value={0.5} onChange={onChange} onClear={onClear} />);
    slider.focus();
    await user.keyboard("{ArrowLeft}"); // below the floor → clear
    expect(onClear).toHaveBeenCalledTimes(1);

    await user.keyboard("{Delete}");
    expect(onClear).toHaveBeenCalledTimes(2);
  });

  it("clicking the current value clears it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<StarRatingInput value={4} onChange={onChange} onClear={onClear} />);

    await user.click(screen.getByTestId("rate-4"));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("exposes the value to assistive tech", () => {
    render(<StarRatingInput value={4.5} onChange={() => {}} />);
    const slider = screen.getByRole("slider", { name: "Your rating" });
    expect(slider).toHaveAttribute("aria-valuenow", "4.5");
    expect(slider).toHaveAttribute("aria-valuetext", "4.5 out of 5");
  });
});
