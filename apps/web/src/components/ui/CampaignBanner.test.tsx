// The campaign banner. Most of what matters here is the referral tag surviving
// verbatim — it is the attribution for the whole campaign, and a banner that
// renders perfectly with a mangled `?ref=` looks exactly like one that works.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CampaignBanner } from "./CampaignBanner";

const DISMISS_KEY = "soundlog:ks-banner-dismissed-v1";
const URL =
  "https://www.kickstarter.com/projects/blakewedding/soundlog-letterboxd-for-music?ref=bbq0xe";

beforeEach(() => {
  localStorage.clear();
});

describe("CampaignBanner", () => {
  it("links to the campaign with the referral tag intact, in a new tab", () => {
    render(<CampaignBanner />);
    const link = screen.getByRole("link", { name: /on kickstarter/i });

    // Compared against the whole string, not a `toContain("bbq0xe")`: a partial
    // match would pass on a truncated or double-encoded URL.
    expect(link).toHaveAttribute("href", URL);
    expect(link).toHaveAttribute("target", "_blank");
    // Without noopener the opened tab can reach back through window.opener.
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("dismisses, and stays dismissed on a fresh mount", async () => {
    const user = userEvent.setup();
    render(<CampaignBanner />);

    await user.click(screen.getByRole("button", { name: "Dismiss announcement" }));
    expect(screen.queryByRole("link", { name: /on kickstarter/i })).not.toBeInTheDocument();
    expect(localStorage.getItem(DISMISS_KEY)).toBe("1");

    // Re-mount from scratch — this is the reload, and the property the effect-
    // free initial state exists to provide.
    cleanup();
    render(<CampaignBanner />);
    expect(screen.queryByRole("link", { name: /on kickstarter/i })).not.toBeInTheDocument();
  });

  it("renders again when the key is bumped, so a later campaign can re-show", () => {
    localStorage.setItem("soundlog:ks-banner-dismissed-v2", "1");
    render(<CampaignBanner />);
    // A v2 dismissal must not suppress v1 — that is the whole point of
    // versioning the key rather than using one permanent flag.
    expect(screen.getByRole("link", { name: /on kickstarter/i })).toBeInTheDocument();
  });

  it("gives the dismiss control and the link separate accessible targets", () => {
    render(<CampaignBanner />);
    const button = screen.getByRole("button", { name: "Dismiss announcement" });
    const link = screen.getByRole("link", { name: /on kickstarter/i });

    // Nesting the button inside the anchor would be invalid HTML and would make
    // every dismiss click also open Kickstarter.
    expect(link.contains(button)).toBe(false);
    expect(screen.getByRole("region", { name: "Announcement" })).toBeInTheDocument();
  });
});
