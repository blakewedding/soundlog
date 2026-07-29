import { Link } from "react-router-dom";

/**
 * The site footer.
 *
 * Added with the privacy policy, because a policy nobody can find is not
 * published. The App Store and Kickstarter both expect a discoverable link, and
 * "discoverable" means from every page rather than from the one page that
 * happens to link to it.
 *
 * ## Why the footer rather than the nav
 *
 * The same reason `/settings` is reached from a profile button: the nav already
 * wraps to three rows at 380px, and a seventh link would worsen that on the
 * exact device this is tested on. A footer costs nothing above the fold and is
 * where people look for this specific thing.
 *
 * Deliberately minimal — a policy link, a support address, and a line saying who
 * operates the site. It is not a place to grow a sitemap; if it starts
 * accumulating columns, that is a navigation redesign (Phase 7), not a footer
 * change.
 */
export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container site-footer-inner">
        <nav aria-label="Site information">
          <Link to="/privacy">Privacy</Link>
          <a href="mailto:hello@soundlog.app">Contact</a>
        </nav>
        <p className="meta">
          Soundlog · Indianapolis, Indiana{" "}
          <span aria-hidden="true">·</span> Music data from{" "}
          <a href="https://musicbrainz.org" rel="noreferrer noopener" target="_blank">
            MusicBrainz
          </a>
        </p>
      </div>
    </footer>
  );
}
