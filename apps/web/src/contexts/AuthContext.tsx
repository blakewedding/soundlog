import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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

/** Test-only: clear the bootstrap singleton so each test gets a fresh page-load. */
export function __resetAuthBootstrapForTests() {
  bootstrapPromise = null;
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

  async function logout() {
    await api.logout().catch(() => {});
    setAccessToken(null);
    setUser(null);
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
