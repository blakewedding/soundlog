import { useState } from "react";
import { api, ApiError, setAccessToken, type OwnProfile } from "../../services/api";

interface Props {
  profile: OwnProfile;
  onChange: (next: OwnProfile) => void;
}

/**
 * Password and email — two independent forms, each re-authenticating with the
 * current password.
 *
 * Asking for a password the caller has already proven looks redundant and is
 * not: the access token says this session authenticated at some point in the
 * last fifteen minutes, not that the person holding the phone right now is the
 * owner. These are precisely the two actions that would let someone else KEEP
 * the account, so an unattended unlocked device is the case worth defending
 * against.
 */
export function AccountSection({ profile, onChange }: Props) {
  return (
    <section className="card settings-section" aria-labelledby="section-account">
      <h2 id="section-account">Account</h2>
      <p className="meta settings-hint">Signing in, and where we reach you.</p>
      <EmailForm profile={profile} onChange={onChange} />
      <hr className="settings-divider" />
      <PasswordForm />
    </section>
  );
}

function EmailForm({ profile, onChange }: Props) {
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const pending = sentTo ?? profile.pendingEmail;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestEmailChange(currentPassword, newEmail.trim());
      setSentTo(res.pendingEmail);
      onChange({ ...profile, pendingEmail: res.pendingEmail });
      setNewEmail("");
      setCurrentPassword("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start that email change.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api.cancelEmailChange();
      setSentTo(null);
      onChange({ ...profile, pendingEmail: null });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't cancel that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="settings-form">
      <div className="settings-row">
        <span className="settings-label">Email</span>
        <p className="meta">{profile.email}</p>
      </div>

      {pending ? (
        // The pending state is the whole point of the design, so it has to be
        // visible: someone who has requested a change and sees their old
        // address unchanged would otherwise assume it failed and try again.
        <div className="settings-row">
          <p className="meta">
            Waiting for confirmation at <strong>{pending}</strong>. Your current address keeps
            working until you click the link we sent — it expires in 2 hours.
          </p>
          <div className="settings-actions">
            <button type="button" className="btn btn-ghost" onClick={() => void cancel()} disabled={busy}>
              {busy ? "…" : "Cancel change"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="settings-row">
            <label htmlFor="newEmail">New email</label>
            <input
              id="newEmail"
              type="email"
              value={newEmail}
              autoComplete="email"
              onChange={(e) => setNewEmail(e.target.value)}
              required
            />
          </div>
          <div className="settings-row">
            {/* NOT "Current password" — the password form below has a field by
                that exact name, and §8 forbids two controls on one page sharing
                an accessible name. Identical labels are worse here than
                elsewhere: someone hearing "Current password" twice has no way
                to know which form they are filling in, and these two do very
                different things. */}
            <label htmlFor="emailPassword">Your password, to confirm it's you</label>
            <input
              id="emailPassword"
              type="password"
              value={currentPassword}
              autoComplete="current-password"
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="settings-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Sending…" : "Change email"}
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="meta settings-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const res = await api.changePassword(currentPassword, newPassword);
      // The server revoked every refresh token including this browser's, and
      // issued a replacement pair. Adopt the new access token or the next
      // request 401s against a session that was just deliberately invalidated.
      setAccessToken(res.accessToken);
      setCurrentPassword("");
      setNewPassword("");
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't change your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="settings-form">
      <div className="settings-row">
        <label htmlFor="currentPassword">Current password</label>
        <input
          id="currentPassword"
          type="password"
          value={currentPassword}
          autoComplete="current-password"
          onChange={(e) => { setCurrentPassword(e.target.value); setDone(false); }}
          required
        />
      </div>
      <div className="settings-row">
        <label htmlFor="newPassword">New password</label>
        <input
          id="newPassword"
          type="password"
          value={newPassword}
          minLength={10}
          autoComplete="new-password"
          onChange={(e) => { setNewPassword(e.target.value); setDone(false); }}
          required
        />
        <p className="meta settings-hint">At least 10 characters.</p>
      </div>
      <div className="settings-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Changing…" : "Change password"}
        </button>
        {done && (
          <span className="meta settings-ok" role="status">
            Password changed — other devices signed out
          </span>
        )}
        {error && (
          <span className="meta settings-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
