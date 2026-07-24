import { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { api } from "../../services/api";

/**
 * A quiet nudge for accounts whose address is not yet confirmed.
 *
 * The Phase 6b launch policy is that unverified accounts are FULL accounts —
 * hard-blocking sign-in on verification means any wobble in mail delivery locks
 * out every new user with no way back in. So this is a reminder, not a gate, and
 * it is dismissible.
 *
 * `emailVerified` is optional on SessionUser because the trimmed projection
 * embedded in reviews and lists omits it. Absent is therefore treated exactly
 * like verified: never nag on partial data.
 */
export default function VerifyReminder() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  if (!user || user.emailVerified !== false || dismissed) return null;

  async function resend() {
    setState("sending");
    try {
      const res = await api.resendVerification();
      // An unconfigured mailer reports success at the transport layer while
      // delivering nothing. Saying "sent" there would be a lie the user cannot
      // detect until they give up waiting.
      setState(res.emailConfigured ? "sent" : "failed");
    } catch {
      // Mutation discipline (§6): a failed write is visible and retryable, never
      // a click that silently does nothing.
      setState("failed");
    }
  }

  return (
    <div
      className="card"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        marginBottom: 24,
        borderColor: "var(--line-strong)",
      }}
    >
      <p className="meta" style={{ margin: 0, flex: "1 1 240px" }}>
        {state === "sent"
          ? "Sent — check your inbox for the confirmation link."
          : state === "failed"
            ? "We couldn't send that just now. Try again in a moment."
            : "Confirm your email address to finish setting up your account."}
      </p>

      {state !== "sent" && (
        <button className="btn btn-ghost" onClick={resend} disabled={state === "sending"}>
          {state === "sending" ? "…" : state === "failed" ? "Retry" : "Resend link"}
        </button>
      )}

      <button
        className="btn btn-ghost"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss email confirmation reminder"
      >
        Dismiss
      </button>
    </div>
  );
}
