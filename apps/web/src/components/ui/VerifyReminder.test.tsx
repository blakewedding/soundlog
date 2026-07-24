// Phase 6b: the unverified-email reminder.
//
// Two things it must never do: nag a verified user, and nag on the trimmed
// SessionUser projection that omits `emailVerified` entirely (reviews, lists).
// Absent must read as "don't nag", not as "not verified" — the falsy check that
// would conflate them is the whole reason this file exists.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VerifyReminder from "./VerifyReminder";
import { api, type SessionUser } from "../../services/api";
import * as AuthContext from "../../contexts/AuthContext";

vi.mock("../../services/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../services/api")>();
  return { ...mod, api: { ...mod.api, resendVerification: vi.fn() } };
});

function mockUser(user: SessionUser | null) {
  vi.spyOn(AuthContext, "useAuth").mockReturnValue({
    user,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    adoptSession: vi.fn(),
    refreshUser: vi.fn(),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(api.resendVerification).mockReset();
});

describe("VerifyReminder visibility", () => {
  it("shows for an explicitly unverified user", () => {
    mockUser({ id: "u1", username: "blake", emailVerified: false });
    render(<VerifyReminder />);
    expect(screen.getByText(/confirm your email address/i)).toBeInTheDocument();
  });

  it("stays hidden for a verified user", () => {
    mockUser({ id: "u1", username: "blake", emailVerified: true });
    render(<VerifyReminder />);
    expect(screen.queryByText(/confirm your email address/i)).not.toBeInTheDocument();
  });

  it("stays hidden when the field is ABSENT — partial data is not evidence", () => {
    mockUser({ id: "u1", username: "blake" });
    render(<VerifyReminder />);
    expect(screen.queryByText(/confirm your email address/i)).not.toBeInTheDocument();
  });

  it("stays hidden when logged out", () => {
    mockUser(null);
    render(<VerifyReminder />);
    expect(screen.queryByText(/confirm your email address/i)).not.toBeInTheDocument();
  });
});

describe("VerifyReminder resend", () => {
  beforeEach(() => mockUser({ id: "u1", username: "blake", emailVerified: false }));

  it("confirms when the mail actually went out", async () => {
    vi.mocked(api.resendVerification).mockResolvedValue({ sent: true, emailConfigured: true });
    render(<VerifyReminder />);

    await userEvent.click(screen.getByRole("button", { name: /resend link/i }));

    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
  });

  it("does NOT claim success when the mailer is unconfigured", async () => {
    // The transport succeeds while delivering nothing. Reporting "sent" here is
    // a lie the user cannot detect until they give up waiting for the email.
    vi.mocked(api.resendVerification).mockResolvedValue({ sent: true, emailConfigured: false });
    render(<VerifyReminder />);

    await userEvent.click(screen.getByRole("button", { name: /resend link/i }));

    expect(await screen.findByText(/couldn't send that/i)).toBeInTheDocument();
    expect(screen.queryByText(/check your inbox/i)).not.toBeInTheDocument();
  });

  it("fails visibly and offers a retry (§6)", async () => {
    vi.mocked(api.resendVerification).mockRejectedValue(new Error("network"));
    render(<VerifyReminder />);

    await userEvent.click(screen.getByRole("button", { name: /resend link/i }));

    expect(await screen.findByText(/couldn't send that/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("can be dismissed", async () => {
    render(<VerifyReminder />);

    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(screen.queryByText(/confirm your email address/i)).not.toBeInTheDocument();
  });
});
