// Phase 6b: the landing page for the tokened link in the verification email.
//
// The load-bearing test here is the single-redemption one. These tokens are
// strictly single-use, so a component that redeems twice on mount turns a
// successful verification into a rendered 400 — and React StrictMode
// double-invokes mount effects in development, which is exactly where a human
// would first click the link.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import VerifyEmail from "./VerifyEmail";
import { api, ApiError } from "../services/api";
import { AuthProvider, __resetAuthBootstrapForTests } from "../contexts/AuthContext";

vi.mock("../services/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../services/api")>();
  return {
    ...mod,
    api: {
      ...mod.api,
      verifyEmail: vi.fn(),
      // AuthProvider bootstraps on mount; keep it logged-out and quiet.
      refresh: vi.fn().mockRejectedValue(new Error("no session")),
      me: vi.fn().mockRejectedValue(new Error("no session")),
    },
  };
});

beforeEach(() => {
  __resetAuthBootstrapForTests();
  vi.mocked(api.verifyEmail).mockReset();
});

function renderAt(url: string, { strict = false } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[url]}>
      <AuthProvider>
        <Routes>
          <Route path="/verify-email" element={<VerifyEmail />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

describe("VerifyEmail", () => {
  it("redeems the token and confirms", async () => {
    vi.mocked(api.verifyEmail).mockResolvedValue({
      user: { id: "u1", username: "blake", emailVerified: true },
    });

    renderAt("/verify-email?token=abc123");

    expect(await screen.findByText(/email confirmed/i)).toBeInTheDocument();
    expect(api.verifyEmail).toHaveBeenCalledWith("abc123");
  });

  it("redeems EXACTLY ONCE under StrictMode's double-invoked effects", async () => {
    vi.mocked(api.verifyEmail).mockResolvedValue({
      user: { id: "u1", username: "blake", emailVerified: true },
    });

    renderAt("/verify-email?token=single-use", { strict: true });

    await screen.findByText(/email confirmed/i);
    // Two calls would mean the second saw an already-consumed token and the
    // user would be told their working link had expired.
    expect(api.verifyEmail).toHaveBeenCalledTimes(1);
  });

  it("surfaces the server's message when the link is spent or expired", async () => {
    vi.mocked(api.verifyEmail).mockRejectedValue(
      new ApiError(400, "This link is invalid or has expired")
    );

    renderAt("/verify-email?token=stale");

    expect(await screen.findByText(/this link is invalid or has expired/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to sign in/i })).toBeInTheDocument();
  });

  it("explains itself when the URL carries no token, without calling the API", async () => {
    renderAt("/verify-email");

    expect(await screen.findByText(/missing its token/i)).toBeInTheDocument();
    await waitFor(() => expect(api.verifyEmail).not.toHaveBeenCalled());
  });
});
