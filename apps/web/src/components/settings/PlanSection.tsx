import type { OwnProfile } from "../../services/api";

interface Props {
  profile: OwnProfile;
}

/**
 * Plan — "Soundlog Pro, coming soon".
 *
 * ## Groundwork, and deliberately nothing more
 *
 * The 6.2 brief is explicit that this phase ships a `plan` field and a
 * coming-soon row and **no payment integration**. So there is no upgrade
 * button, no waitlist capture, and no price. Each of those would be a promise
 * with a date attached, and the honest version of "we haven't built this yet"
 * is a sentence, not a call to action that does nothing when tapped.
 *
 * ## Why it renders at all rather than waiting for billing
 *
 * The section order is fixed — Profile, Account, Privacy, Plan, Danger — and
 * the whole point of fixing it up front was that the layout must not shift
 * under a returning user each time a section lands. The Privacy slot was held
 * empty through 6.2a for exactly this reason. Rendering the Plan row now is
 * what keeps Danger where people have already learned it is.
 *
 * ## The one rule this section must not break
 *
 * `plan` is read-only here. Unlike `profileVisibility` — which the Privacy
 * section writes, and which was withheld until enforcement was real — there is
 * nothing behind `PRO` to enforce yet. A control that could set it would be a
 * toggle that grants a tier the product does not implement, which is the same
 * mistake as a privacy switch that does not hide anything, with money attached.
 */
export function PlanSection({ profile }: Props) {
  const isPro = profile.plan === "PRO";

  return (
    <section className="card settings-section" aria-labelledby="section-plan">
      <h2 id="section-plan">Plan</h2>

      <div className="settings-row">
        <p className="settings-plan-current">
          You're on <strong>{isPro ? "Soundlog Pro" : "Soundlog Free"}</strong>.
        </p>
        <p className="meta settings-hint">
          Everything on Soundlog works on Free — logging, rating, reviewing, lists and following are
          not going behind a paywall.
        </p>
      </div>

      {!isPro && (
        <div className="settings-row settings-plan-soon">
          <p className="settings-plan-current">
            <strong>Soundlog Pro</strong> <span className="settings-plan-badge">Coming soon</span>
          </p>
          <p className="meta settings-hint">
            We're working on it. There's nothing to buy yet, and we'll tell you here before there is.
          </p>
        </div>
      )}
    </section>
  );
}
