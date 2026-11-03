# Soundlog — Roadmap

What is planned next, in rough priority order. `PROGRESS.md` is the detailed
execution log (what shipped, what it taught); this file is the short view of
the work ahead. Items link to the section of `PROGRESS.md` or `README.md`
that holds the reasoning where one exists.

Status key: **next** = sequenced, **planned** = committed but not sequenced,
**later** = v1.1+, needs a schema or policy decision first.

## Phase 7 — mobile app surface (next)

The Expo app ships a feed tab and a placeholder profile. The rest of the
surface is the next block of work, in the order it naturally falls:

- [ ] **Auth screens** (sign in, register, verify, reset) consuming the
      existing JWT + rotating-refresh API, tokens held in `expo-secure-store`.
- [ ] **Release detail screen**, hosting a native half-star input. Unblocks the
      two Phase 5.5 items (haptic intent, native star control) that are
      blocked rather than pending because no screen exists to host them.
- [ ] **Write actions**: log, rate, review, comment, list add, follow.
- [ ] **Settings & profile** screens against the 6.2 API, including account
      deletion (App Store review guideline 5.1.1(v)).
- [ ] **Monochrome icon cut** for Safari pinned tabs (the one piece of the
      icon set still open after Brand v3).

## Production reliability (planned)

Filed out of post-launch incidents; each has a written root cause in
`PROGRESS.md`.

- [ ] **Warm sweep schedule must survive a restart.** `startWarming` is a
      `setInterval` with no leading call, so every deploy pushes the first
      sweep a full interval out; with daily deploys the sweep never runs.
      Preferred fix: a persisted last-sweep timestamp beside `WarmTarget`,
      interval computed against it. (`PROGRESS.md` → *Then — Phase 7*, item 6.)
- [ ] **Single-flight for `cached()`**, or hoist `lookupReleaseGroup` ahead of
      the enrichment fan-out. Required before any enrichment parallelisation,
      which is worth ~40% off cold-seed completion time.
- [ ] **Drop `await indexRelease()` from the seed response path.** ES is
      eventually consistent and its errors are already swallowed; awaiting it
      only delays the response (~39 ms of a 52 ms warm seed).
- [ ] **Prefix-capable artist search.** `esSearchArtists` uses a standard
      analyzer with no prefix support, so "radioh" always fans out to
      MusicBrainz (two gate-serialised requests per keystroke pause). Add an
      edge-ngram or `search_as_you_type` field and stop fanning out on
      prefixes of already-known artists.
- [ ] **Intermittent cross-file test failures** in the backend integration
      suite (2 of 6 full runs on one day, different file each time). Run the
      suspect files in isolation under repetition; find the shared-state
      coupling rather than relaxing an assertion.
- [ ] **Unconfigured OAuth providers answer 503**; 501 is the honest code
      since the condition is permanent until configured.

## Web polish (planned)

- [ ] **Navigation component.** At 380 px the nav wraps to three rows
      (~20% of the viewport). A disclosure menu or tab bar is a new component,
      not a tweak.
- [ ] **Desktop half-star hit targets** are 8×24 px, tight even for a mouse.
      Touch was fixed in 5.5; desktop was outside that brief.
- [ ] **Sign in with username or email.** The login form takes email only,
      while the delete-account confirm asks for the username. One lookup that
      tries both, same uniform error so usernames cannot be probed.
- [ ] **Marketing-consent column and an unsubscribe path of our own.** Every
      send to date is transactional; a stored preference comes before any
      second campaign mail.

## Operations checklist (dated, none blocking)

- [ ] DMARC `p=none` → `p=quarantine` once sending history is clean.
- [ ] Inbound routing for the public contact address, then swap the
      MusicBrainz user-agent contact to it.
- [ ] Spotify and Google OAuth consoles (redirect URIs + production env).
- [ ] SSL-expiry alert on the existing uptime monitor.
- [ ] Raise the uptime monitor's alert threshold to two consecutive failed
      checks, so a single-region routing blip (2026-11-03: 16 minutes of
      connection timeouts from North America probes while every other region
      and the origin itself were fine) doesn't page at night.
- [ ] Prune the Docker build cache after each deploy
      (`docker builder prune --keep-storage 5G -f`). Images are built on the
      box, and the cache had grown to 40 GB of a 75 GB disk by 2026-11-03.
      Add it to the deploy runbook in the README, or to the deploy script.

## v1.1 — needs a schema or policy decision first (later)

Deferred deliberately; each would slow the core loop if taken on now.
Reasoning for each is in `README.md` → *Backlog — v1.1*.

- [ ] **Collection / format tracking** (the v1.1 headline): what you own,
      not just what you've heard. Format, pressing, condition, purchase date.
- [ ] **Editions / reissues on release pages**, with an original-issue
      cover-art policy so a remaster never replaces the original sleeve.
- [ ] **Track listings and weighted track ratings** (`Track` model under
      `Release`; release rating becomes a blend).
- [ ] **Official / bootleg live split** using MusicBrainz release status.
- [ ] **Customizable chart builder** over the existing ranking query
      (type + genre + year with the weighted-rating machinery behind it).
- [ ] **Community genre voting** (the RYM model), superseding the Last.fm
      folksonomy allowlist. Needs moderation and abuse thinking first.

## Documented but not planned

- The Kubernetes manifests under `infrastructure/k8s/` remain the documented
  funded-migration path off the single VPS. They are maintained, not dead,
  but nothing is scheduled.
- Spotify integration is dormant behind a config guard (2026 Developer Mode
  restrictions) and stays that way until the platform terms change.

## Further Out

- Concert logging and rating, as a second logged-media type beside releases.
- Physical-media locator: where to find a given release on vinyl, CD or cassette near you, built on the collection-tracking data above.
