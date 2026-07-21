// Phase 5.5 — the lightbox declares aria-modal, so it has to behave like one.
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Lightbox } from "./Lightbox";

function open(onClose = vi.fn()) {
  // A trigger outside the dialog, so focus restoration is observable.
  render(
    <>
      <button data-testid="trigger">Open cover</button>
      <Lightbox src="/cover.jpg" alt="Dummy cover" onClose={onClose} />
    </>
  );
  return onClose;
}

describe("Lightbox — modal keyboard contract", () => {
  it("moves focus into the dialog on open", () => {
    open();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = open();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes from the Close button", async () => {
    const user = userEvent.setup();
    const onClose = open();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("traps Tab inside the overlay", async () => {
    const user = userEvent.setup();
    open();
    const close = screen.getByRole("button", { name: "Close" });
    expect(close).toHaveFocus();

    // Only one focusable inside, so Tab must wrap back to it rather than
    // escaping to the trigger behind the overlay.
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(close).toHaveFocus();
  });

  it("returns focus to whatever opened it", async () => {
    const user = userEvent.setup();

    // The real flow: a trigger that survives the dialog closing, and focus
    // sitting on it at the moment the dialog mounts.
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open cover</button>
          {open && <Lightbox src="/cover.jpg" alt="Dummy cover" onClose={() => setOpen(false)} />}
        </>
      );
    }
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Open cover" });
    await user.click(trigger);
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });

  it("names the dialog for screen readers", () => {
    open();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "Dummy cover — full size");
  });
});
