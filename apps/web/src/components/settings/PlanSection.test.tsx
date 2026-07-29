// The Plan row. Groundwork only, so most of what matters here is what the
// section must NOT grow: no upgrade control, no price, and no way to set `plan`
// from the client.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanSection } from "./PlanSection";
import type { OwnProfile } from "../../services/api";

const BASE: OwnProfile = {
  id: "u1",
  username: "blake",
  email: "b@example.com",
  displayName: null,
  bio: null,
  avatarUrl: null,
  links: [],
  pendingEmail: null,
  plan: "FREE",
  profileVisibility: "PUBLIC",
  hasPassword: true,
  createdAt: new Date().toISOString(),
  emailVerified: true,
};

function renderSection(plan: OwnProfile["plan"] = "FREE") {
  render(<PlanSection profile={{ ...BASE, plan }} />);
}

describe("PlanSection", () => {
  it("shows the free plan and the coming-soon row", () => {
    renderSection("FREE");
    expect(screen.getByText(/Soundlog Free/)).toBeInTheDocument();
    expect(screen.getByText(/Coming soon/i)).toBeInTheDocument();
  });

  it("offers nothing to click — this phase ships no billing", () => {
    renderSection("FREE");
    // The rule the section exists under. An upgrade button that does nothing is
    // a promise with a date attached; the honest form of "not built yet" is a
    // sentence. If billing arrives, this assertion is the thing that should be
    // deliberately changed rather than quietly outgrown.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("does not advertise Pro to someone already on it", () => {
    renderSection("PRO");
    expect(screen.getByText(/Soundlog Pro/)).toBeInTheDocument();
    expect(screen.queryByText(/Coming soon/i)).toBeNull();
  });
});
