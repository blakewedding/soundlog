import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api, ApiError } from "../services/api";

type State = "confirming" | "confirmed" | "failed";

/**
 * Landing page for the link sent to a NEW email address.
 *
 * Same single-use hazard as VerifyEmail, and the same guard: React StrictMode
 * double-invokes mount effects, so an unguarded call would redeem the token,
 * redeem it again, and render the SECOND response — a 400 — on a change that
 * actually succeeded.
 *
 * One thing differs from verification, and it is the reason this is its own
 * page rather than a mode of that one: confirming an email change **signs every
 * session out**, including this browser's, because the address is the login
 * identifier and a completed change is a change of who can get in. So this
 * screen has to send the user to sign in again rather than back to the app,
 * and it should say so before they discover it by being bounced.
 */
export default function ConfirmEmail() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const { logout } = useAuth();
  const [state, setState] = useState<State>("confirming");
  const [email, setEmail] = useState<string | null>(null);
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
      .confirmEmailChange(token)
      .then(async (res) => {
        setEmail(res.user.email ?? null);
        setState("confirmed");
        // The server has already revoked every refresh token. Clear the local
        // session too, or the app sits holding an access token that will stop
        // working within fifteen minutes and fail its next refresh with no
        // explanation.
        await logout().catch(() => {});
      })
      .catch((err) => {
        setState("failed");
        setError(
          err instanceof ApiError ? err.message : "We couldn't confirm that email change."
        );
      });
  }, [token, logout]);

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>
        {state === "confirming" && "Confirming your new email…"}
        {state === "confirmed" && "Email updated"}
        {state === "failed" && "We couldn't confirm that"}
      </h1>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {state === "confirming" && <p className="meta">One moment.</p>}

        {state === "confirmed" && (
          <>
            <p className="meta">
              {email ? <>You'll sign in with <strong>{email}</strong> from now on.</> : "Your email address has been updated."}
            </p>
            <p className="meta">
              For security, this signed out every device — including this one. Sign in again with
              your new address and the same password.
            </p>
            <Link to="/login" className="btn btn-primary">
              Sign in
            </Link>
          </>
        )}

        {state === "failed" && (
          <>
            <p className="meta" style={{ color: "var(--danger)" }}>
              {error}
            </p>
            <p className="meta">
              These links expire after 2 hours and work only once. Your old address still works —
              nothing has changed, and you can request the change again from Settings.
            </p>
            <Link to="/settings" className="btn btn-ghost">
              Go to settings
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
