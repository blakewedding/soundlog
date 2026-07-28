import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type OwnProfile } from "../../services/api";

interface Props {
  profile: OwnProfile;
  onChange: (next: OwnProfile) => void;
}

/**
 * Profile visibility.
 *
 * This control only exists because the enforcement behind it is real — it was
 * deliberately withheld through 6.2a and the first half of 6.2b, when the
 * column existed and nothing honoured it. A toggle that appears to work and
 * does not is worse than no toggle at all.
 *
 * The copy is doing load-bearing work, not decoration. PRIVATE means "you do
 * not broadcast": the profile page and its tabs, member search, and activity in
 * other people's feeds. It does NOT unpublish a review from the release page it
 * was written about, or make a public list private. Saying so here is the
 * difference between a setting and a promise we don't keep — and the field is
 * named `profileVisibility`, not `accountPrivacy`.
 */
export function PrivacySection({ profile, onChange }: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPrivate = profile.profileVisibility === "PRIVATE";

  async function toggle(next: boolean) {
    const previous = profile.profileVisibility;
    const value = next ? "PRIVATE" : "PUBLIC";
    // Optimistic (§6): the switch moves on tap, not after a round trip.
    onChange({ ...profile, profileVisibility: value });
    setBusy(true);
    setError(null);
    try {
      const res = await api.updateMyProfile({ profileVisibility: value });
      onChange(res.profile);
      // Going private removes this member from search and from other people's
      // feeds, so anything cached that renders them is now wrong.
      await qc.invalidateQueries();
    } catch (err) {
      onChange({ ...profile, profileVisibility: previous });
      setError(err instanceof ApiError ? err.message : "Couldn't change that setting.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card settings-section" aria-labelledby="section-privacy">
      <h2 id="section-privacy">Privacy</h2>

      <div className="settings-row">
        <label className="settings-check">
          <input
            type="checkbox"
            checked={isPrivate}
            disabled={busy}
            onChange={(e) => void toggle(e.target.checked)}
          />
          <span>Make my profile private</span>
        </label>
        <p className="meta settings-hint">
          Hides your profile page, your activity in other people's feeds, and your name from member
          search. Only you can see your profile.
        </p>
        <p className="meta settings-hint">
          It does <strong>not</strong> hide reviews you've posted on a release page, or lists you've
          made public — those stay where you put them.
        </p>
      </div>

      {error && (
        <p className="meta settings-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
