import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api, ApiError } from "../services/api";

type State = "verifying" | "verified" | "failed";

/**
 * Landing page for the tokened link in the verification email.
 *
 * The token is strictly single-use, which makes this screen unusually sensitive
 * to double submission: React StrictMode double-invokes mount effects in
 * development, so an unguarded effect would redeem the token, redeem it again,
 * and render the SECOND response — a 400 — on a verification that actually
 * succeeded. Same hazard the AuthContext bootstrap singleton exists to prevent,
 * and the same fix: run once per mount, deliberately.
 */
export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const { refreshUser } = useAuth();
  const [state, setState] = useState<State>("verifying");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!token) {
      setState("failed");
      setError("This link is missing its token. Try the link in your email again.");
      return;
    }

    api
      .verifyEmail(token)
      .then(async () => {
        setState("verified");
        // The session (if any) now has a stale emailVerified; refresh it so the
        // reminder banner stops nagging someone who has just complied.
        await refreshUser();
      })
      .catch((err) => {
        setState("failed");
        setError(
          err instanceof ApiError ? err.message : "We couldn't confirm your email. Try again."
        );
      });
  }, [token, refreshUser]);

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>
        {state === "verifying" && "Confirming your email…"}
        {state === "verified" && "Email confirmed"}
        {state === "failed" && "We couldn't confirm that"}
      </h1>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {state === "verifying" && <p className="meta">One moment.</p>}

        {state === "verified" && (
          <>
            <p className="meta">
              Your address is confirmed. That's the whole account set up — nothing else to do.
            </p>
            <Link to="/" className="btn btn-primary">
              Start listening
            </Link>
          </>
        )}

        {state === "failed" && (
          <>
            <p className="meta" style={{ color: "var(--danger)" }}>
              {error}
            </p>
            <p className="meta">
              Confirmation links expire after 24 hours and work only once. If yours has lapsed, sign
              in and request a fresh one.
            </p>
            <Link to="/login" className="btn btn-ghost">
              Go to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
