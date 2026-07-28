// Delete account. The irreversible control, so what these test is mostly the
// things that must NOT happen: no request without an exact typed confirmation,
// no password demanded of an account that has none, and no "it failed" shown to
// someone whose account is already gone.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DangerSection } from "./DangerSection";
import { api, ApiError, type OwnProfile } from "../../services/api";

const logout = vi.fn();
const navigate = vi.fn();
vi.mock("../../contexts/AuthContext", () => ({ useAuth: () => ({ logout }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

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

function renderSection(profile: Partial<OwnProfile> = {}) {
  render(<DangerSection profile={{ ...BASE, ...profile }} />);
}

/** Open the folded-shut section — nothing destructive is reachable until then. */
async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Delete account" }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  logout.mockReset().mockResolvedValue(undefined);
  navigate.mockReset();
});

describe("DangerSection", () => {
  it("hides the form until the section is deliberately opened", () => {
    renderSection();
    // No inputs at rest: on a phone, an irreversible field must not be one
    // mis-tap away while someone is scrolling a settings page.
    expect(screen.queryByLabelText(/to confirm/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /delete my account/i })).toBeNull();
  });

  it("keeps the delete disabled until the username matches exactly", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(api, "deleteAccount");
    renderSection();
    await open(user);

    const submit = screen.getByRole("button", { name: /delete my account/i });
    const name = screen.getByLabelText(/to confirm/i);
    await user.type(screen.getByLabelText(/^your password$/i), "hunter2");

    expect(submit).toBeDisabled();

    // A near miss is still a miss — no trimming, no case folding. The value of
    // a typed confirmation is that it was typed, not approximated.
    await user.type(name, "Blake");
    expect(submit).toBeDisabled();

    await user.clear(name);
    await user.type(name, " blake ");
    expect(submit).toBeDisabled();

    await user.clear(name);
    await user.type(name, "blake");
    expect(submit).toBeEnabled();

    expect(spy).not.toHaveBeenCalled();
  });

  it("does not ask an OAuth-only account for a password it cannot have", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(api, "deleteAccount").mockResolvedValue({ deleted: true, purge: "purged" });
    renderSection({ hasPassword: false });
    await open(user);

    // The client half of the 5.1.1(v) lockout: rendering a required password
    // field for an account with no password makes deletion impossible for every
    // Spotify and Google member.
    expect(screen.queryByLabelText(/^your password$/i)).toBeNull();

    await user.type(screen.getByLabelText(/to confirm/i), "blake");
    await user.click(screen.getByRole("button", { name: /delete my account/i }));

    expect(spy).toHaveBeenCalledWith("blake", undefined);
    expect(logout).toHaveBeenCalled();
  });

  it("signs out and leaves on success", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "deleteAccount").mockResolvedValue({ deleted: true, purge: "purged" });
    renderSection();
    await open(user);

    await user.type(screen.getByLabelText(/to confirm/i), "blake");
    await user.type(screen.getByLabelText(/^your password$/i), "hunter2");
    await user.click(screen.getByRole("button", { name: /delete my account/i }));

    expect(logout).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("treats a 502 carrying accountDeleted as done, not as a failure to retry", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "deleteAccount").mockRejectedValue(
      new ApiError(502, "Your account was deleted, but some cached copies could not be cleared.", {
        accountDeleted: true,
        residue: ["cloudflare"],
      })
    );
    renderSection();
    await open(user);

    await user.type(screen.getByLabelText(/to confirm/i), "blake");
    await user.type(screen.getByLabelText(/^your password$/i), "hunter2");
    await user.click(screen.getByRole("button", { name: /delete my account/i }));

    // The account IS gone. Leaving the user on a form with a retry button would
    // invite them to re-attempt something irreversible that already happened.
    expect(logout).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/", { replace: true });
    // …and it still says the true thing rather than claiming a clean success.
    expect(screen.getByRole("alert")).toHaveTextContent(/cached copies could not be cleared/i);
  });

  it("shows a real failure and keeps the session", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "deleteAccount").mockRejectedValue(
      new ApiError(401, "That password is not correct.")
    );
    renderSection();
    await open(user);

    await user.type(screen.getByLabelText(/to confirm/i), "blake");
    await user.type(screen.getByLabelText(/^your password$/i), "wrong");
    await user.click(screen.getByRole("button", { name: /delete my account/i }));

    expect(screen.getByRole("alert")).toHaveTextContent("That password is not correct.");
    expect(logout).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    // Still usable — a refused confirmation must leave the form ready to fix.
    expect(screen.getByRole("button", { name: /delete my account/i })).toBeEnabled();
  });
});
