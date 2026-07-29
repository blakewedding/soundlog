// The privacy policy page.
//
// What these test is deliberately narrow. Prose does not need snapshotting —
// that produces a test which fails on every wording change and asserts nothing
// about meaning. What DOES need pinning is the small set of claims that are
// promises about shipped code, and the fact that the page is reachable and
// linked, because a policy nobody can find is not published.
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Privacy from "./Privacy";
import { Footer } from "../components/ui/Footer";

function renderPage() {
  render(
    <MemoryRouter>
      <Privacy />
    </MemoryRouter>
  );
}

describe("Privacy policy", () => {
  it("states the load-bearing commitments, each of which is true of shipped code", () => {
    renderPage();
    const text = document.body.textContent ?? "";

    // avatarService.ts omits withMetadata() as a privacy control.
    expect(text).toMatch(/strips all of it — including location data/i);
    // visibilityService.ts — PRIVATE means do not broadcast, not unpublish.
    expect(text).toMatch(/reviews you've written remain visible on the album pages/i);
    // accountDeletionService.ts — five stores, App Store 5.1.1(v).
    expect(text).toMatch(/database and search index/i);
    expect(text).toMatch(/purged from our content delivery network/i);
    // The qualifier that makes "immediate and complete" honest.
    expect(text).toMatch(/backups.*kept for up to 14 days/i);
    // Avatar URLs are unguessable but not access-controlled. Saying so is the
    // difference between a description and a claim we do not meet.
    expect(text).toMatch(/anyone who has the exact URL can load the image/i);
    // One cookie, cookieless analytics.
    expect(text).toMatch(/only cookie Soundlog sets/i);
  });

  it("names every processor that touches user data", () => {
    renderPage();
    const text = document.body.textContent ?? "";
    for (const processor of ["Hetzner", "Cloudflare", "Resend"]) {
      expect(text).toContain(processor);
    }
  });

  it("carries an effective date and a working contact address", () => {
    renderPage();
    expect(screen.getByText(/Effective date:/)).toBeInTheDocument();
    const mailto = screen.getAllByRole("link", { name: /hello@soundlog\.app/ });
    expect(mailto.length).toBeGreaterThan(0);
    expect(mailto[0]).toHaveAttribute("href", "mailto:hello@soundlog.app");
  });

  it("points at Settings for the rights a user can exercise themselves", () => {
    // The policy claims access, correction and deletion are self-serve. If that
    // link ever stops existing, the claim becomes false.
    renderPage();
    const settingsLinks = screen.getAllByRole("link", { name: /Settings/ });
    expect(settingsLinks.length).toBeGreaterThan(0);
    expect(settingsLinks[0]).toHaveAttribute("href", "/settings");
  });
});

describe("Footer", () => {
  it("links the policy from site chrome, so it is reachable from anywhere", () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    );
    const nav = screen.getByRole("navigation", { name: /site information/i });
    expect(within(nav).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(within(nav).getByRole("link", { name: "Contact" })).toHaveAttribute(
      "href",
      "mailto:hello@soundlog.app"
    );
  });
});
