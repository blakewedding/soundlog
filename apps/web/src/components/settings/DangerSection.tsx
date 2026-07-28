import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, type OwnProfile } from "../../services/api";
import { useAuth } from "../../contexts/AuthContext";

interface Props {
  profile: OwnProfile;
}

/**
 * Delete account. App Store Review 5.1.1(v).
 *
 * ## Why it is folded shut
 *
 * Every other section on this page is a control sitting in the open, because
 * every other action is reversible. This one is not, so it starts as a single
 * button and the form only appears once someone has said they mean it. That
 * costs a deliberate tap and buys the property that no irreversible input is
 * ever one mis-tap away on a phone — the device this page is actually used on.
 *
 * ## Why the username, and not just the password
 *
 * Typing the username is required of EVERYONE. For accounts with a password it
 * is a second factor alongside re-authentication; for OAuth-only accounts
 * (`hasPassword: false`) it is the whole confirmation, because those accounts
 * have no password to re-check.
 *
 * That asymmetry is the point rather than an accident. Reusing step 3's
 * password re-auth unchanged would have left every Spotify and Google member
 * unable to delete their account at all, which is the precise failure App Store
 * review looks for — and it would only have shown up on a sign-in path nobody
 * exercises locally.
 *
 * ## What the copy has to say out loud
 *
 * The privacy section already established that PRIVATE means "do not
 * broadcast", not "unpublish". Deletion means something stronger and different,
 * and a person about to press this needs to know which of their things end and
 * which do not, BEFORE they press it — not from support afterwards.
 */
export function DangerSection({ profile }: Props) {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Exact match. The server checks this too — this is the affordance, not the
  // control — and it is deliberately not trimmed or lowercased: the whole value
  // of a typed confirmation is that it was typed, not approximated.
  const matches = username === profile.username;
  const needsPassword = profile.hasPassword;
  const ready = matches && (!needsPassword || password.length > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      await api.deleteAccount(username, needsPassword ? password : undefined);
      await finish();
    } catch (err) {
      // The 502 that is NOT a failure: the account is gone and one cached copy
      // survived. Treating this as an error would tell someone their deletion
      // failed and invite them to retry something irreversible that already
      // happened — so it completes the sign-out exactly like success, and says
      // the true thing on the way out.
      if (err instanceof ApiError && err.body?.accountDeleted === true) {
        setWarning(err.message);
        await finish();
        return;
      }
      setError(
        err instanceof ApiError ? err.message : "We couldn't delete your account. Please try again."
      );
      setBusy(false);
    }
  }

  async function finish() {
    // Clears the local session and the refresh cookie. The server already
    // revoked everything server-side; this is what stops the browser holding a
    // credential for an account that no longer exists.
    await logout().catch(() => {});
    navigate("/", { replace: true });
  }

  return (
    <section className="card settings-section settings-danger" aria-labelledby="section-danger">
      <h2 id="section-danger">Delete account</h2>

      {!open ? (
        <>
          <p className="meta settings-hint">
            Permanently deletes your account and everything on it. This cannot be undone.
          </p>
          <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
            Delete account
          </button>
        </>
      ) : (
        <form onSubmit={submit} noValidate>
          <p className="meta settings-hint">
            This permanently deletes your profile, your picture, your ratings, reviews, logs,
            lists, comments and follows. It cannot be undone and we cannot restore it for you.
          </p>
          <p className="meta settings-hint">
            Reviews and comments you posted are deleted along with your account, including from the
            release pages they appear on.
          </p>

          <div className="settings-row">
            <label htmlFor="delete-confirm-username">
              Type <strong>{profile.username}</strong> to confirm
            </label>
            <input
              id="delete-confirm-username"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              disabled={busy}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          {needsPassword && (
            <div className="settings-row">
              {/* §8: this page already carries a "Current password" field in the
                  Account section. Two controls on one page must not share an
                  accessible name — a screen reader user would hear it twice
                  with no way to tell which form they were in. */}
              <label htmlFor="delete-confirm-password">Your password</label>
              <input
                id="delete-confirm-password"
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}

          <div className="settings-actions">
            <button type="submit" className="btn btn-danger" disabled={!ready || busy}>
              {busy ? "Deleting…" : "Delete my account"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setUsername("");
                setPassword("");
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>

          {error && (
            <p className="meta settings-error" role="alert">
              {error}
            </p>
          )}
          {warning && (
            <p className="meta settings-error" role="alert">
              {warning}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
