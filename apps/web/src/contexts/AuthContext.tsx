import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, setAccessToken, type SessionUser } from "../services/api";

interface AuthState {
  user: SessionUser | null;
  loading: boolean; // true until the silent refresh on load settles
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Adopt a session the server just issued outside login/register — currently
   * only the password-reset flow, which signs the user in as it completes.
   */
  adoptSession: (user: SessionUser, accessToken: string) => void;
  /**
   * Re-read the current user. Verifying an email changes `emailVerified` on the
   * server; without this the reminder banner would keep nagging a verified user
   * until they reloaded the page.
   */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

// Session bootstrap must run exactly once per page load: refresh tokens rotate
// on use, so a second concurrent /refresh replays the old token and trips the
// server's reuse detection (which revokes the whole family). React StrictMode
// double-invokes mount effects in dev — a module-level singleton makes both
// invocations share one request.
let bootstrapPromise: Promise<SessionUser | null> | null = null;

/**
 * Forget the bootstrapped session.
 *
 * The singleton caches the resumed user for the lifetime of the page, which is
 * right for its purpose and wrong after a sign-out: it holds a resolved promise
 * carrying the user who just left, so anything that remounts AuthProvider —
 * an HMR update, a future layout restructure — would resume them from cache
 * without a request. Clearing it on logout keeps "the session is over" true in
 * every place the session is remembered.
 */
function forgetBootstrappedSession() {
  bootstrapPromise = null;
}

/** Test-only: clear the bootstrap singleton so each test gets a fresh page-load. */
export function __resetAuthBootstrapForTests() {
  forgetBootstrappedSession();
}

function bootstrapSession(): Promise<SessionUser | null> {
  bootstrapPromise ??= (async () => {
    try {
      const { accessToken } = await api.refresh();
      setAccessToken(accessToken);
      const { user } = await api.me();
      return user;
    } catch {
      setAccessToken(null);
      return null;
    }
  })();
  return bootstrapPromise;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  // AuthProvider sits INSIDE QueryClientProvider (see main.tsx), which is what
  // lets sign-out drop the cache the session filled.
  const queryClient = useQueryClient();

  // On load, try to resume the session from the httpOnly refresh cookie.
  useEffect(() => {
    bootstrapSession().then((resumed) => {
      setUser(resumed);
      setLoading(false);
    });
  }, []);

  async function login(email: string, password: string) {
    const res = await api.login({ email, password });
    setAccessToken(res.accessToken);
    setUser(res.user);
  }

  async function register(username: string, email: string, password: string) {
    const res = await api.register({ username, email, password });
    setAccessToken(res.accessToken);
    setUser(res.user);
  }

  /**
   * Sign out. Local state first, network second — §6, and the bug that forced it.
   *
   * This used to `await api.logout()` and only then clear the session, which
   * made the whole sign-out wait on a round trip. `request()` puts no timeout on
   * any fetch, so on a flaky mobile connection a stalled logout left the UI
   * signed in indefinitely: reported from a phone as "tapping Log out sometimes
   * doesn't take effect until the page is refreshed". It always eventually
   * worked, which is what made it look intermittent rather than broken.
   *
   * Safe to reorder because `POST /api/auth/logout` is NOT `requireAuth` — it
   * authenticates by refresh cookie, which `credentials: "include"` sends
   * whether or not we still hold an access token. Clearing the token first
   * cannot orphan the server-side revoke.
   *
   * Three things have to be forgotten, not one, because the session is
   * remembered in three places:
   *   - the in-memory access token,
   *   - the React state the nav renders from,
   *   - the react-query cache, which holds every authenticated response the
   *     session made. Leaving it would let a back-navigation paint the previous
   *     user's diary from cache.
   * …plus the bootstrap singleton, so nothing can resume them from it later.
   *
   * There is no rollback. §6 wants a failed mutation to revert, and this is the
   * one place where reverting would be wrong: putting somebody back INTO a
   * session they asked to leave is worse than a revoke that has to wait for the
   * refresh token to expire on its own.
   */
  async function logout() {
    setAccessToken(null);
    setUser(null);
    forgetBootstrappedSession();
    queryClient.clear();

    try {
      await api.logout();
    } catch {
      // Locally the session is already gone, which is the safe direction. The
      // server-side revoke may not have landed; the refresh token expires on its
      // own and is rejected on next use either way.
    }
  }

  function adoptSession(next: SessionUser, accessToken: string) {
    setAccessToken(accessToken);
    setUser(next);
  }

  async function refreshUser() {
    // Swallowed on purpose: this only ever refines already-displayed state, so
    // a blip must not tear down a working session or surface an error on a
    // screen the user has already succeeded on.
    try {
      const { user: fresh } = await api.me();
      setUser(fresh);
    } catch {
      /* keep the session we have */
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, logout, adoptSession, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
