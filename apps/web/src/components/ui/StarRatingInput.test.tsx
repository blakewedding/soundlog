import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StarRatingInput } from "./StarRatingInput";

/**
 * jsdom lays nothing out, so the pointer path has nothing to measure.
 *
 * This stubs the individual STAR BOXES, not one rect for the whole row. The
 * earlier version stubbed only the row, which meant these tests could not see
 * geometry at all: they kept passing while a quarter of the control mapped to
 * the wrong half-star on a real phone. Exhaustive coordinate coverage lives in
 * lib/starGeometry.test.ts; what matters here is that the component reads the
 * boxes it actually renders.
 *
 * Geometry is the real 380px release-card measurement: five 57.2px boxes
 * starting at x=29, so a half-star is 28.6px.
 */
const ROW_LEFT = 29;
const CELL_WIDTH = 57.2;

const rect = (left: number, width: number): DOMRect =>
  ({ left, width, right: left + width, top: 0, bottom: 44, height: 44, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;

function stubStarGeometry() {
  Element.prototype.getBoundingClientRect = function () {
    const el = this as HTMLElement;
    if (el.classList?.contains("star-cell")) {
      const index = Array.prototype.indexOf.call(el.parentElement?.children ?? [], el);
      return rect(ROW_LEFT + index * CELL_WIDTH, CELL_WIDTH);
    }
    if (el.classList?.contains("star-input")) {
      return rect(ROW_LEFT, CELL_WIDTH * 5);
    }
    return rect(0, 0);
  };
}

/** x coordinate inside the given half-star step (0.5 … 5), from the boxes. */
function xFor(step: number): number {
  const starIndex = Math.ceil(step) - 1;
  const left = ROW_LEFT + starIndex * CELL_WIDTH;
  const isHalf = step % 1 !== 0;
  // Middle of the left half for x.5, middle of the right half for whole stars.
  return left + (isHalf ? CELL_WIDTH * 0.25 : CELL_WIDTH * 0.75);
}

beforeEach(stubStarGeometry);

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

// The 5.5 bug: on a phone there is no hover, so before this the only way to
// rate was a precise tap on a ~22px zone — and a half-star meant hitting the
// left sliver of a glyph. Pressing and dragging now previews live and commits
// on release, matching what a mouse does with hover + click.
describe("StarRatingInput — touch and pointer drag", () => {
  function setup(props: Partial<Parameters<typeof StarRatingInput>[0]> = {}) {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<StarRatingInput value={null} onChange={onChange} onClear={onClear} {...props} />);
    return { onChange, onClear, slider: screen.getByRole("slider") };
  }

  /** A finger: press, move across the row, release. */
  function drag(slider: HTMLElement, from: number, to: number, pointerType = "touch") {
    fireEvent.pointerDown(slider, { clientX: from, pointerId: 1, pointerType });
    fireEvent.pointerMove(slider, { clientX: to, pointerId: 1, pointerType });
    fireEvent.pointerUp(slider, { clientX: to, pointerId: 1, pointerType });
  }

  it("commits the value the finger is released on", () => {
    const { onChange, slider } = setup();
    drag(slider, xFor(0.5), xFor(3.5));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(3.5);
  });

  it("previews live while dragging, before any commit", () => {
    const { onChange, slider } = setup();
    fireEvent.pointerDown(slider, { clientX: xFor(0.5), pointerId: 1, pointerType: "touch" });
    fireEvent.pointerMove(slider, { clientX: xFor(4), pointerId: 1, pointerType: "touch" });

    // The readout follows the finger…
    expect(screen.getByText("4.0")).toBeInTheDocument();
    // …but nothing is written until release.
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.pointerUp(slider, { clientX: xFor(4), pointerId: 1, pointerType: "touch" });
    expect(onChange).toHaveBeenLastCalledWith(4);
  });

  it("reaches half-star values by dragging, not just whole ones", () => {
    const { onChange, slider } = setup();
    drag(slider, xFor(5), xFor(2.5));
    expect(onChange).toHaveBeenLastCalledWith(2.5);
  });

  it("can drag down as well as up", () => {
    const { onChange, slider } = setup({ value: 5 });
    drag(slider, xFor(5), xFor(1));
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("commits once per drag, not once per star crossed", () => {
    const { onChange, slider } = setup();
    fireEvent.pointerDown(slider, { clientX: xFor(0.5), pointerId: 1, pointerType: "touch" });
    for (const s of [1, 2, 3, 4, 5]) {
      fireEvent.pointerMove(slider, { clientX: xFor(s), pointerId: 1, pointerType: "touch" });
    }
    fireEvent.pointerUp(slider, { clientX: xFor(5), pointerId: 1, pointerType: "touch" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(5);
  });

  it("abandons without writing when the gesture is cancelled by a scroll", () => {
    const { onChange, onClear, slider } = setup();
    fireEvent.pointerDown(slider, { clientX: xFor(1), pointerId: 1, pointerType: "touch" });
    fireEvent.pointerMove(slider, { clientX: xFor(4), pointerId: 1, pointerType: "touch" });
    fireEvent.pointerCancel(slider, { clientX: xFor(4), pointerId: 1, pointerType: "touch" });

    expect(onChange).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
    // Preview is dropped, so the control does not sit lit on a value it never took.
    expect(screen.queryByText("4.0")).not.toBeInTheDocument();
  });

  it("does not double-commit when the drag is followed by a click", () => {
    // A real drag ends with a synthetic click on whatever zone is underneath;
    // committing there too would write twice.
    const { onChange, slider } = setup();
    drag(slider, xFor(0.5), xFor(3));
    fireEvent.click(screen.getByTestId("rate-3"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("still treats a press without movement as a tap", () => {
    const { onChange, slider } = setup();
    fireEvent.pointerDown(slider, { clientX: xFor(2), pointerId: 1, pointerType: "touch" });
    fireEvent.pointerUp(slider, { clientX: xFor(2), pointerId: 1, pointerType: "touch" });
    // No drag happened, so the zone's click is what commits — as before.
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("rate-2"));
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it("releasing on the current rating clears it, matching click behaviour", () => {
    const { onChange, onClear, slider } = setup({ value: 3 });
    drag(slider, xFor(1), xFor(3));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores pointer input entirely when disabled", () => {
    const { onChange, onClear, slider } = setup({ disabled: true });
    drag(slider, xFor(1), xFor(4));
    expect(onChange).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it("keeps a mouse hover preview without pressing", () => {
    const { onChange, slider } = setup();
    fireEvent.pointerMove(slider, { clientX: xFor(2.5), pointerId: 1, pointerType: "mouse" });
    expect(screen.getByText("2.5")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not preview from an un-pressed touch, so scrolling past cannot light it up", () => {
    const { slider } = setup();
    fireEvent.pointerMove(slider, { clientX: xFor(4), pointerId: 1, pointerType: "touch" });
    expect(screen.queryByText("4.0")).not.toBeInTheDocument();
  });

  it("keeps the slider role and value semantics through a drag", () => {
    const { slider } = setup({ value: 2 });
    expect(slider).toHaveAttribute("role", "slider");
    drag(slider, xFor(2), xFor(4.5));
    expect(slider).toHaveAttribute("aria-valuemin", "0.5");
    expect(slider).toHaveAttribute("aria-valuemax", "5");
    expect(slider).toHaveAttribute("tabindex", "0");
  });
});
