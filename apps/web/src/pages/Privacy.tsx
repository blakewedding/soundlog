import { Link } from "react-router-dom";

/**
 * The privacy policy. A Kickstarter and App Store prerequisite, and the
 * document a data protection authority would read first.
 *
 * ## Why it is a component rather than a fetched document
 *
 * It is static prose with no data dependency, so a route renders it with no
 * request, no loading state and no failure mode. It is also versioned in git
 * alongside the behaviour it describes, which matters more than it sounds:
 * every claim here is a claim about code in this repo, and a policy that can
 * drift from the code independently is a policy that will.
 *
 * ## The claims here are load-bearing, and each one is true of shipped code
 *
 * This document asserts specific technical behaviour, and each assertion has an
 * implementation behind it. If any of these change, this page changes in the
 * same commit:
 *
 *  - **EXIF including GPS is stripped** — `avatarService.ts` deliberately omits
 *    `withMetadata()`, which is a privacy control rather than an encoding
 *    choice: re-serving a phone photo untouched would publish a home address.
 *  - **Private profiles hide discovery, not contributions** — `visibilityService.ts`.
 *    The policy says so in as many words because the field is
 *    `profileVisibility`, not `accountPrivacy`, and promising the second while
 *    shipping the first is the gap that only surfaces when it matters.
 *  - **Deletion clears Postgres, Elasticsearch, disk and the CDN** —
 *    `accountDeletionService.ts`, App Store 5.1.1(v).
 *  - **Avatar URLs are unguessable but not access-controlled** — they are
 *    content-addressed, and the route authenticates nothing. Saying so is the
 *    difference between a description and a claim we do not meet.
 *  - **Backups retain deleted data for up to 14 days** — `backup-db.sh`
 *    retention. The one place where "deletion is immediate and complete" needs
 *    a qualifier, and burying it would be the dishonest option.
 *  - **Cookieless analytics, one session cookie** — Cloudflare Web Analytics in
 *    our own markup, and the refresh cookie. Nothing else sets one.
 *
 * The effective date is a literal, not a build timestamp: it marks when the
 * policy last changed substantively, and a date that moved on every deploy
 * would tell a reader nothing.
 */
const EFFECTIVE_DATE = "July 29, 2026";

const CONTACT = "hello@soundlog.app";

export default function Privacy() {
  return (
    <article className="prose">
      <h1>Privacy Policy</h1>
      <p className="meta prose-lede">
        Soundlog (soundlog.app) · Effective date: {EFFECTIVE_DATE}
      </p>

      <p>
        Soundlog is a music logging and review platform operated by Blake Wedding in Indianapolis,
        Indiana, United States. This policy describes what information Soundlog collects, how it's
        used, and the choices you have. It describes the product as it exists today; when the
        product changes in ways that affect your data, this policy will be updated and the effective
        date revised.
      </p>
      <p>
        Questions about anything here: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <h2>What we collect</h2>
      <p>
        <strong>Account information.</strong> When you register: your email address, your username,
        and your password. Passwords are stored hashed — we cannot read them.
      </p>
      <p>
        <strong>Profile information you choose to add.</strong> A display name, a short bio, up to
        five links, and a profile picture. All of these are optional.
      </p>
      <p>
        <strong>Your activity on Soundlog.</strong> The things the product exists to record: albums
        you rate, review, and log; lists you make; members you follow; comments and likes on
        reviews. This is the content of your music diary.
      </p>
      <p>
        <strong>Basic technical measurement.</strong> We use Cloudflare Web Analytics to understand
        aggregate site performance and traffic (page load times, page views). It is cookieless and
        does not track individuals across sites. It is the only analytics running on Soundlog.
      </p>

      <h2>What we don't do</h2>
      <ul>
        <li>
          <strong>No ads.</strong> Soundlog does not show advertising.
        </li>
        <li>
          <strong>No selling or sharing your data.</strong> Your information is not sold, rented, or
          shared with data brokers or advertisers.
        </li>
        <li>
          <strong>No tracking cookies.</strong> The only cookie Soundlog sets is the one that keeps
          you signed in.
        </li>
        <li>
          <strong>No hidden photo metadata.</strong> Photos often carry embedded metadata (EXIF),
          which can include the GPS location where they were taken. When you upload a profile
          picture, Soundlog strips all of it — including location data — before the image is stored
          or served. The picture people see contains the picture and nothing else.
        </li>
      </ul>

      <h2>Who can see what</h2>
      <p>
        Profiles are public by default — your profile page, reviews, ratings, logs, and public lists
        are visible to anyone, which is the point of a shared music diary.
      </p>
      <p>
        You can set your profile to private in <Link to="/settings">Settings</Link>. A private
        profile is hidden from member search, from activity feeds, and from your profile page —
        other people can no longer discover you or browse your activity. One deliberate exception:
        reviews you've written remain visible on the album pages they were written on. Privacy on
        Soundlog controls discovery of you, not the removal of contributions from the pages they
        live on. If you want a review gone entirely, you can delete the review itself, or your
        account.
      </p>
      <p>
        Your profile picture is served from content-addressed URLs. These are unguessable, but
        anyone who has the exact URL can load the image regardless of your visibility setting.
      </p>

      <h2>Email</h2>
      <p>
        Soundlog sends transactional email only: account verification, password resets, and security
        notices (for example, when an email change is requested on your account, a notice goes to
        your current address). We do not send marketing email. Transactional email is delivered via
        Resend.
      </p>

      <h2>Deleting your account</h2>
      <p>
        You can delete your account yourself, at any time, in{" "}
        <Link to="/settings">Settings → Delete account</Link>. Deletion is immediate and complete:
        your account, profile, reviews, ratings, logs, lists, follows, comments, and likes are
        removed from our database and search index; your profile pictures are removed from our
        storage; and cached copies of your pictures are purged from our content delivery network.
      </p>
      <p>
        One honest technical note: encrypted nightly backups of the database are kept for up to 14
        days for disaster recovery, then automatically deleted. Deleted data may persist inside
        those backups until they age out. Backups are used only to restore the service after a
        failure — never to restore deleted accounts.
      </p>

      <h2>Where your data lives</h2>
      <p>
        Soundlog is hosted on servers in Helsinki, Finland (EU), operated by Hetzner. The service is
        operated from the United States. If you use Soundlog from elsewhere, your information is
        processed in these locations.
      </p>
      <p>Service providers that process data on Soundlog's behalf:</p>
      <ul>
        <li>
          <strong>Hetzner</strong> (Germany/Finland) — server hosting
        </li>
        <li>
          <strong>Cloudflare</strong> (US/global) — DNS, content delivery, caching, and cookieless
          analytics
        </li>
        <li>
          <strong>Resend</strong> (US) — transactional email delivery
        </li>
      </ul>
      <p>
        Soundlog's music catalog is built from open and licensed music databases (MusicBrainz, Cover
        Art Archive, Discogs, Last.fm, Spotify). Soundlog fetches album and artist data from these
        services; it does not send them your personal information.
      </p>

      <h2>Age</h2>
      <p>
        Soundlog is for people 13 and older. If you're in a country where the law sets a higher
        minimum age for consenting to data processing without parental permission (up to 16 in parts
        of the European Economic Area), that higher age applies to you. We don't knowingly collect
        information from anyone below the applicable age; if you believe a child has created an
        account, contact <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and it will be removed.
      </p>

      <h2>Your rights</h2>
      <p>
        You can view and edit your profile information in <Link to="/settings">Settings</Link>, and
        delete your account entirely as described above.
      </p>
      <p>
        If you're in the EEA, UK, or a jurisdiction with similar data protection law, you
        additionally have the right to request access to, correction of, deletion of, or a copy of
        your personal data, and to object to or restrict certain processing. To exercise any of
        these, email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> — most of them (access, correction,
        deletion) you can also simply do yourself in Settings. You also have the right to complain to
        your local data protection authority.
      </p>
      <p>
        The legal bases on which Soundlog processes data: performing the service you signed up for
        (your account and activity), our legitimate interest in keeping the service secure and
        functioning (security notices, aggregate analytics), and your consent where applicable
        (optional profile information you choose to add).
      </p>

      <h2>Changes to this policy</h2>
      <p>
        When Soundlog changes in ways that affect your data — new features, new processors — this
        policy will be updated before or alongside the change, with a new effective date at the top.
        This policy describes the product as it is, not as it might be.
      </p>

      <h2>Contact</h2>
      <p>
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>
      <p className="meta">Soundlog · Indianapolis, Indiana, United States</p>
    </article>
  );
}
