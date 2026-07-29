import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type OwnProfile } from "../services/api";
import { useAuth } from "../contexts/AuthContext";
import { AvatarField } from "../components/settings/AvatarField";
import { ProfileForm } from "../components/settings/ProfileForm";
import { AccountSection } from "../components/settings/AccountSection";
import { PrivacySection } from "../components/settings/PrivacySection";
import { PlanSection } from "../components/settings/PlanSection";
import { DangerSection } from "../components/settings/DangerSection";
import { useState, useEffect } from "react";

/**
 * `/settings` — everything the signed-in user can change about their own
 * account.
 *
 * ## One scrolling page, and each section is its own form
 *
 * Not a single page-wide Save. §6 requires every mutation to fail visibly with
 * a retry affordance, and one Save across six unrelated controls cannot do
 * that: a partial failure leaves the page showing values that never persisted,
 * and "which one failed" has no answer. Independent sections make every write
 * atomic and land every error beside the control that caused it.
 *
 * Scrolling rather than tabs because this is a form on a phone, and because a
 * tab strip would add another horizontal row competing with the nav, which
 * already wraps to three rows at 380px.
 *
 * The only entry point is the "Edit profile" button on your own profile, for
 * that same reason. Making settings a first-class nav destination is DEFERRED
 * to Phase 7's mobile nav redesign — it is the right answer and it needs the
 * nav rethought first, not a seventh link added to a bar that already wraps.
 *
 * ## Section order
 *
 * Descending frequency of use, ascending consequence: what other people see →
 * what secures the account → who may see it → what you pay → what ends it.
 * Destructive actions last and visually separated, so nothing irreversible sits
 * next to something routine.
 *
 *   1. Profile   — avatar, display name, bio, links      (here)
 *   2. Account   — email with re-verification, password with re-auth
 *   3. Privacy   — profile visibility. Rendered from 6.2b step 4 onward,
 *                  once enforcement was real across users.ts, feedService AND
 *                  the Elasticsearch user documents (§5) — the last of which
 *                  removes the document rather than filtering it, so the index
 *                  cannot answer a question nobody thought to guard.
 *   4. Plan      — Soundlog Pro, coming soon. Groundwork only: `plan` is
 *                  READ-ONLY here, because unlike `profileVisibility` there is
 *                  nothing behind PRO to enforce yet, and a control that could
 *                  set it would grant a tier the product does not implement.
 *   5. Danger    — delete account (6.2b step 6). Folded shut, and the only
 *                  irreversible control on the page.
 *
 * Sections 2–5 arrived across 6.2b and all five are now present; the order
 * above is what stopped the layout shifting under a user each time one landed.
 */
export default function Settings() {
  const { user, loading: authLoading } = useAuth();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["me", "profile"],
    queryFn: () => api.myProfile(),
    enabled: !!user,
  });

  // Held locally so a section's response updates every other section without a
  // refetch — the avatar upload returns the whole profile, and the fields form
  // should not then be showing a stale copy of it.
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  useEffect(() => {
    if (data?.profile) setProfile(data.profile);
  }, [data]);

  if (authLoading || (user && isLoading)) return <p className="meta">Loading…</p>;

  if (!user) {
    return (
      <p className="meta">
        <Link to="/login">Log in</Link> to change your settings.
      </p>
    );
  }

  if (isError || !profile) {
    return (
      <div className="settings">
        <h1>Settings</h1>
        <p className="meta settings-error" role="alert">
          We couldn't load your settings. Reload the page to try again.
        </p>
      </div>
    );
  }

  return (
    <div className="settings">
      <header className="settings-header">
        <h1>Settings</h1>
        <Link to={`/${profile.username}`} className="meta">
          View your profile →
        </Link>
      </header>

      <section className="card settings-section" aria-labelledby="section-profile">
        <h2 id="section-profile">Profile</h2>
        <p className="meta settings-hint">This is what other people see.</p>
        <AvatarField profile={profile} onChange={setProfile} />
        <ProfileForm profile={profile} onChange={setProfile} />
      </section>

      <AccountSection profile={profile} onChange={setProfile} />

      <PrivacySection profile={profile} onChange={setProfile} />

      <PlanSection profile={profile} />

      <DangerSection profile={profile} />
    </div>
  );
}
