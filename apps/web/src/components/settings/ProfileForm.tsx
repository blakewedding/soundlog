import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type OwnProfile, type ProfileLink } from "../../services/api";
import { useAuth } from "../../contexts/AuthContext";
import { patchUserEverywhere } from "../../lib/userCache";

/** Matches the server's `profileLinksSchema`. Kept in step deliberately. */
const MAX_LINKS = 5;
const MAX_BIO = 500;
const MAX_DISPLAY_NAME = 60;

interface Props {
  profile: OwnProfile;
  onChange: (next: OwnProfile) => void;
}

/**
 * Display name, bio and links — its OWN form with its own submit and its own
 * error, not part of a page-wide Save.
 *
 * §6 asks every mutation to fail visibly. One Save across the whole settings
 * page cannot: a partial failure leaves the form showing values that never
 * persisted, and "which of these six things went wrong" has no answer. One form
 * per concern makes each write atomic and each failure land next to the control
 * that caused it.
 */
export function ProfileForm({ profile, onChange }: Props) {
  const qc = useQueryClient();
  const { refreshUser } = useAuth();
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [links, setLinks] = useState<ProfileLink[]>(profile.links ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function setLink(i: number, patch: Partial<ProfileLink>) {
    setLinks((prev) => prev.map((l, n) => (n === i ? { ...l, ...patch } : l)));
    setSaved(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // Drop rows the user added and left blank rather than sending them and
      // collecting a 422 about a field they never filled in.
      const cleaned = links.filter((l) => l.label.trim() || l.url.trim());
      const { profile: next } = await api.updateMyProfile({
        displayName: displayName.trim() || null,
        bio: bio.trim() || null,
        links: cleaned,
      });
      onChange(next);
      setLinks(next.links);
      // The display name renders on every review card, comment and feed row,
      // and in the nav — none of which are on screen (§6).
      patchUserEverywhere(qc, next.id, { displayName: next.displayName });
      await refreshUser();
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? // A 422 from the links schema is the common case and its raw shape
            // is not for humans.
            err.status === 422
            ? "Check your links — each needs a name and an address starting with https://."
            : err.message
          : "Couldn't save those changes."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="settings-form">
      <div className="settings-row">
        <label htmlFor="displayName">Display name</label>
        <input
          id="displayName"
          value={displayName}
          maxLength={MAX_DISPLAY_NAME}
          placeholder={profile.username}
          onChange={(e) => { setDisplayName(e.target.value); setSaved(false); }}
        />
        <p className="meta settings-hint">Shown instead of @{profile.username}. Leave blank to use your username.</p>
      </div>

      <div className="settings-row">
        <label htmlFor="bio">Bio</label>
        <textarea
          id="bio"
          value={bio}
          rows={4}
          maxLength={MAX_BIO}
          onChange={(e) => { setBio(e.target.value); setSaved(false); }}
        />
        <p className="meta settings-hint">{bio.length} / {MAX_BIO}</p>
      </div>

      <div className="settings-row">
        <span className="settings-label">Links</span>
        {links.map((link, i) => (
          <div key={i} className="settings-link-row">
            <input
              value={link.label}
              placeholder="Name"
              maxLength={40}
              aria-label={`Link ${i + 1} name`}
              onChange={(e) => setLink(i, { label: e.target.value })}
            />
            <input
              value={link.url}
              placeholder="https://"
              type="url"
              maxLength={200}
              aria-label={`Link ${i + 1} address`}
              onChange={(e) => setLink(i, { url: e.target.value })}
            />
            <button
              type="button"
              className="btn btn-ghost"
              // Distinct accessible name per row — §8: two controls on one page
              // must not share one, and five "Remove" buttons is five identical
              // names in a row.
              aria-label={`Remove link ${i + 1}${link.label ? `, ${link.label}` : ""}`}
              onClick={() => { setLinks((p) => p.filter((_, n) => n !== i)); setSaved(false); }}
            >
              ✕
            </button>
          </div>
        ))}
        {links.length < MAX_LINKS && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => { setLinks((p) => [...p, { label: "", url: "" }]); setSaved(false); }}
          >
            + Add a link
          </button>
        )}
        <p className="meta settings-hint">Up to {MAX_LINKS}. Addresses must start with https://.</p>
      </div>

      <div className="settings-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save profile"}
        </button>
        {/* Confirmation matters here: unlike the avatar, nothing on this form
            visibly changes on success, so without this a successful save and a
            silently dropped one look identical. */}
        {saved && <span className="meta settings-ok" role="status">Saved</span>}
        {error && (
          <span className="meta settings-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
