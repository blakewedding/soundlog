import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api, ApiError } from "../services/api";

/**
 * Choose a new password, using the token from the reset email.
 *
 * Unlike VerifyEmail this does not redeem on mount — redemption is the user's
 * submit, so there is no StrictMode double-fire to guard. Succeeding here also
 * signs the user in (the server issues a session as it completes), so the flow
 * ends in the app rather than at a login form they would immediately fill in
 * with the password they just typed.
 */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const { adoptSession } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.resetPassword(token!, password);
      adoptSession(res.user, res.accessToken);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div style={{ maxWidth: 420, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
        <h1>That link is incomplete</h1>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p className="meta">
            This page needs the token from your reset email. Request a fresh link and open it
            directly.
          </p>
          <Link to="/forgot-password" className="btn btn-primary">
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Choose a new password</h1>
      <form onSubmit={submit} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password (10+ characters)"
          minLength={10}
          autoComplete="new-password"
          required
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password"
          minLength={10}
          autoComplete="new-password"
          required
        />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "…" : "Set new password"}
        </button>
        {error && (
          <p className="meta" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
        <p className="meta">
          Setting a new password signs out every other device, in case someone else has been using
          your account.
        </p>
      </form>
    </div>
  );
}
