import { useState } from "react";

/**
 * The Kickstarter campaign strip, above the nav.
 *
 * TEMPORARY BY DESIGN. This exists for the campaign and is meant to be deleted,
 * not maintained: removal is this file plus the one `<CampaignBanner />` line in
 * App.tsx, and nothing else in the app knows it exists. No token changes, no nav
 * changes, no backend, no analytics.
 *
 * The copy carries no dates and no "notify me" phrasing on purpose — it has to
 * read correctly both before and after launch day, so that nobody has to
 * remember to edit a string on the morning of the launch.
 */

/**
 * The referral tag is the minted "site" tag and is load-bearing for attribution,
 * so the URL is a single verbatim constant rather than assembled from parts —
 * there is no interpolation here for a typo to hide in.
 */
const KICKSTARTER_URL =
  "https://www.kickstarter.com/projects/blakewedding/soundlog-letterboxd-for-music?ref=bbq0xe";

/**
 * Versioned so a later campaign update can re-show the banner to people who
 * dismissed this one, by bumping to `-v2`. Without the version there is no way
 * back: a dismissal would be permanent for that browser forever.
 */
const DISMISS_KEY = "soundlog:ks-banner-dismissed-v1";

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    // Private mode or a blocked store — show the banner rather than hide it.
    // Failing open is right here: the cost is a strip someone can dismiss
    // again, where failing closed would silently suppress the campaign.
    return false;
  }
}

export function CampaignBanner() {
  // Read synchronously in the initial state rather than in an effect. An effect
  // would mount the banner, then remove it on the next commit — a visible flash
  // and a layout shift for exactly the people who already said no.
  const [dismissed, setDismissed] = useState(wasDismissed);

  if (dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Storage unavailable — it stays dismissed for this session only, which
      // is a better outcome than the click appearing to do nothing.
    }
  }

  return (
    <div className="ks-banner" role="region" aria-label="Announcement">
      {/* The anchor is a SIBLING of the dismiss button, never its parent: a
          <button> inside an <a> is invalid, and nesting would make every
          dismiss click also open Kickstarter. */}
      <a
        className="ks-banner-link"
        href={KICKSTARTER_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        {/* Copy and arrow are ONE flex child, not two. As siblings the arrow
            became its own flex item, so at 380px — where the copy wraps to two
            lines — it detached and floated beside the wrapped block instead of
            trailing "diary". */}
        <span>
          Soundlog is on Kickstarter — back the future of the listening diary{" "}
          {/* Decorative: the link already reads as a link, and "right arrow"
              announced at the end of the sentence is noise. */}
          <span aria-hidden="true">→</span>
        </span>
      </a>
      <button className="ks-banner-dismiss" onClick={dismiss} aria-label="Dismiss announcement">
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
