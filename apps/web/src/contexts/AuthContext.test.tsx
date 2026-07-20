// Regression: refresh tokens rotate on use, and the server revokes the whole
// token family when it sees a rotated token replayed. React StrictMode
// double-invokes mount effects in dev, so a naive bootstrap fired TWO
// concurrent /refresh calls — the second was a replay, and every hard page
// load logged the user out. The bootstrap must hit /refresh exactly once no
// matter how many times the provider mounts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth, __resetAuthBootstrapForTests } from "./AuthContext";
import { api } from "../services/api";

vi.mock("../services/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../services/api")>();
  return {
    ...mod,
    api: { ...mod.api, refresh: vi.fn(), me: vi.fn() },
  };
});

const mockedRefresh = vi.mocked(api.refresh);
const mockedMe = vi.mocked(api.me);

function WhoAmI() {
  const { user, loading } = useAuth();
  if (loading) return <span>loading</span>;
  return <span>{user ? `hello ${user.username}` : "anonymous"}</span>;
}

beforeEach(() => {
  __resetAuthBootstrapForTests();
  mockedRefresh.mockReset();
  mockedMe.mockReset();
});

describe("AuthContext session bootstrap", () => {
  it("calls /refresh exactly once under React.StrictMode (double-mounted effects)", async () => {
    mockedRefresh.mockResolvedValue({ accessToken: "tok" });
    mockedMe.mockResolvedValue({ user: { id: "u1", username: "blake" } });

    render(
      <React.StrictMode>
        <AuthProvider>
          <WhoAmI />
        </AuthProvider>
      </React.StrictMode>
    );

    expect(await screen.findByText("hello blake")).toBeInTheDocument();
    // The heart of the regression: a second call here revoked the session.
    expect(mockedRefresh).toHaveBeenCalledTimes(1);
  });

  it("settles as anonymous when there is no resumable session", async () => {
    mockedRefresh.mockRejectedValue(new Error("401"));

    render(
      <React.StrictMode>
        <AuthProvider>
          <WhoAmI />
        </AuthProvider>
      </React.StrictMode>
    );

    await waitFor(() => expect(screen.getByText("anonymous")).toBeInTheDocument());
    expect(mockedRefresh).toHaveBeenCalledTimes(1);
    expect(mockedMe).not.toHaveBeenCalled();
  });
});
