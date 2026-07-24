import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../services/api";

/**
 * Request a password-reset link.
 *
 * The server answers identically whether or not the address has an account, and
 * this screen must not undo that: the success copy says "if that address has an
 * account", never "check your inbox" as though delivery were confirmed. A UI
 * that distinguished the two cases would hand back exactly the account-existence
 * oracle the endpoint was written to withhold.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword(email);
      setSent(true);
    } catch (err) {
      // Only a transport or validation failure can land here — the endpoint
      // returns 200 for unknown addresses by design.
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div style={{ maxWidth: 420, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
        <h1>Check your email</h1>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p className="meta">
            If <strong style={{ color: "var(--text)" }}>{email}</strong> has a Soundlog account,
            a reset link is on its way. It works once and expires in an hour.
          </p>
          <p className="meta">Nothing arrived? Check spam, then try again in a few minutes.</p>
          <Link to="/login" className="btn btn-ghost">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Reset your password</h1>
      <form onSubmit={submit} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="meta">
          Enter the address you signed up with and we'll send you a link to choose a new password.
        </p>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoComplete="email"
          required
        />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "…" : "Send reset link"}
        </button>
        {error && (
          <p className="meta" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
      </form>
      <Link to="/login" className="btn btn-ghost">
        Back to sign in
      </Link>
    </div>
  );
}
