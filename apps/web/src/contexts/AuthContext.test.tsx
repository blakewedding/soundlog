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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
        <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <WhoAmI />
        </AuthProvider>
      </QueryClientProvider>
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
        <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <WhoAmI />
        </AuthProvider>
      </QueryClientProvider>
      </React.StrictMode>
    );

    await waitFor(() => expect(screen.getByText("anonymous")).toBeInTheDocument());
    expect(mockedRefresh).toHaveBeenCalledTimes(1);
    expect(mockedMe).not.toHaveBeenCalled();
  });
});

// Regression: logout waited on the network before clearing the session.
//
// Reported from a phone as "tapping Log out sometimes doesn't take effect until
// the page is refreshed". `request()` sets no timeout on any fetch, so a stalled
// POST /api/auth/logout left the UI signed in for as long as the connection took
// to fail — and it always eventually worked, which is what made it read as
// intermittent rather than broken.
//
// The assertion that matters is ORDERING, so the mock deliberately never
// resolves. A test that awaited a resolving logout would pass against the broken
// version too.
describe("logout", () => {
  function Harness() {
    const { user, loading, logout } = useAuth();
    return (
      <div>
        <span>{loading ? "loading" : user ? `hello ${user.username}` : "anonymous"}</span>
        <button onClick={() => void logout()}>sign out</button>
      </div>
    );
  }

  it("clears the session before the request settles", async () => {
    mockedRefresh.mockResolvedValue({ accessToken: "tok" });
    mockedMe.mockResolvedValue({ user: { id: "u1", username: "blake" } });
    // Never resolves — the stalled logout that produced the report.
    const logoutSpy = vi.spyOn(api, "logout").mockReturnValue(new Promise<void>(() => {}));

    const qc = new QueryClient();
    qc.setQueryData(["feed"], [{ id: "leftover" }]);

    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Harness />
        </AuthProvider>
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByText("hello blake")).toBeInTheDocument());
    screen.getByRole("button", { name: "sign out" }).click();

    // Signed out immediately, with the request still hanging.
    await waitFor(() => expect(screen.getByText("anonymous")).toBeInTheDocument());
    expect(logoutSpy).toHaveBeenCalled();
    // …and the session's cached data went with it, or a back-navigation would
    // repaint the previous user's pages from cache.
    expect(qc.getQueryData(["feed"])).toBeUndefined();
  });

  it("stays signed out when the server call fails", async () => {
    mockedRefresh.mockResolvedValue({ accessToken: "tok" });
    mockedMe.mockResolvedValue({ user: { id: "u1", username: "blake" } });
    vi.spyOn(api, "logout").mockRejectedValue(new Error("offline"));

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Harness />
        </AuthProvider>
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByText("hello blake")).toBeInTheDocument());
    screen.getByRole("button", { name: "sign out" }).click();

    // No rollback, deliberately: putting somebody back into a session they asked
    // to leave is worse than a revoke that waits for the token to expire.
    await waitFor(() => expect(screen.getByText("anonymous")).toBeInTheDocument());
  });
});
