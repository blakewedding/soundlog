# Soundlog — Progress

Execution state. `CLAUDE.md` holds the binding patterns (read it first);
`README.md` holds the build plan and v1.1 backlog. This file is the "where are
we, what's live, what's next" for a session starting cold.

**Repo:** https://github.com/blakewedding/soundlog · `main`
**Last updated:** 2026-07-21

## Status

`origin/main` is an exact mirror of local — head `d8be781`, 0 ahead / 0 behind.
History scanned across every commit: no `.env`, no secrets committed.

**Phases 0 through 5.6.1b are done.** Suites green: **backend 149 + web 48 =
197 tests**, both packages typecheck clean.

## Done

| Phase | What | Commit |
|-------|------|--------|
| 0 | Scaffolding — monorepo, health checks, Prisma schema, compose, K8s starters | |
| 1 | Auth — email/password + Spotify/Google OAuth, rotating refresh tokens | |
| 2 | Music data layer — MusicBrainz canonical, Discogs/Last.fm/Spotify, Elasticsearch | |
| 3 | Ratings, reviews, threaded comments, ranked lists | |
| 4 | Social graph & activity feed (BullMQ fan-out) | |
| 4.1 | Interactive review cards everywhere (optimistic likes, inline threads) | |
| 5 | Discovery & search — labels, tabbed search, genre/year charts, popular feed, similar listeners, Explore | |
| — | Infra — pnpm-aware `Dockerfile.backend` (builds), dev Varnish via `host.docker.internal` | `0f24003` |
| 5.7 | Seed reliability (retry transient MB, skeleton-then-enrich, resumable) + optimistic ratings | `1000028` |
| 5.8 | Strip Discogs `(n)` disambiguation, heal duplicate releases | `efdcc1a` |
| 5.6 | Full artist discographies — paginated MB browse, 7d cache, MBID-only merge, type grouping, progressive loading, click-to-materialize, rate-limited refresh | `422bb7e` |
| 5.6.1 | Discography QA — 401→refresh→retry, ArtistCredit (no dead artist text), refresh-slot keying, non-Latin artist names, cover-art smoothing, genre-tag quality | `c162226` |
| — | `CLAUDE.md` project laws | `ee75364` |
| — | Systemic test mock-leakage fix (`clearMocks`) + title-trim-at-persist | `515b7d0` |
| 5.6.1b | Log-listen feedback states — transient "Logged ✓" → "Log again", "In your diary ×N" | `d8be781` |

> Numbering is out of order on purpose: 5.7, 5.8, 5.6 and 5.6.1 all ran ahead of
> 5.5, because reliability and data-integrity bugs outranked design polish.

**Resolved, don't re-investigate:** the "log listen doesn't persist" report was a
*feedback* bug, not durability. Logs always persisted; the button settled back to
a label identical to never-logged, so success looked like failure. Fixed in
5.6.1b — see that commit before touching the log button.

## Next — Phase 5.5, design polish

The last feature phase before deployment. Scope:

- **Wordmark options** — present a few directions for the Soundlog mark rather
  than one; the current one is placeholder-grade.
- **Micro-interactions** — the design system is "Gold on Vinyl" (see
  `apps/web/src/theme.css`); motion should stay restrained and respect
  `prefers-reduced-motion`, which the CSS already honours.
- **Optimistic log/follow** — the last two mutations still lacking the pattern.
  Ratings (5.7) and log-listen (5.6.1b) are already done and are the reference
  implementations; follow the same shape via `apps/web/src/lib/releaseCache.ts`.
- **Responsive audit** — layouts are desktop-first; the chart list has the only
  real breakpoint so far.
- **Accessibility floor** — set and meet a baseline. Known landmines already hit:
  two controls sharing an accessible name (fixed once in `StarRatingInput` via a
  `label` prop), and dead non-interactive text where a link belongs (fixed by
  `ArtistCredit`).
- **Expo haptics** — mobile only; the app currently has a feed tab and little else.

Then **Phase 6 — production deployment**: finish the K8s manifests, GitHub
Actions (test → build → push → deploy), GKE Autopilot.

## Open items

- **Full production compose stack boots end-to-end** — still unverified. The
  backend image builds and Varnish is proven against the dev server, but the
  containerized backend has never been booted as a full stack (needs migrations
  against the compose Postgres and in-cluster env wiring). Tracked as a Phase 6
  verification item in the README.
- **401 → refresh → replay against a genuinely aged token** — unit-tested, never
  exercised against a real >15-minute session. Low risk, but it is the one auth
  path no automated test can honestly claim.
- **Stale genre tags** — the 5.6.1 junk-tag filter works, but only 3 releases
  were re-enriched. **55 of 143 releases** still carry pre-filter genres (bare
  years, "favourite albums"). A catalog-wide re-enrich would clear them:
  `npx tsx scripts/reenrich-genres.ts "<title>" …` (extend it to loop all rows).
- **Field Day (Aphex Twin)** — upstream MusicBrainz gap, not our bug. MB's own
  release-group count (119) matches our assembly exactly, and MB has no "Field
  Day" release-group or recording for that artist. Submitting an edit means first
  deciding sanctioned-release vs. live bootleg, which is the v1.1
  official/bootleg split.

## Local environment notes

Things that cost time to rediscover and live nowhere else.

**Dev servers.** `.claude/launch.json` sets `"autoPort": false` deliberately:
`CLIENT_URL=http://127.0.0.1:3000` is the OAuth redirect target and CORS origin,
so a reassigned port breaks sign-in. If `preview_start` reports port 3000 held by
an unrecognised `node`, it is usually an orphaned Vite from a previous session:

```bash
kill $(lsof -tiTCP:3000 -sTCP:LISTEN)   # then retry preview_start
```

`launch.json` must be **strict JSON** — comments break the parser.

**Infra.** `docker compose stop` to pause, never `down -v` (that destroys the
seeded catalog in the `pgdata`/`esdata` volumes).

**Maintenance scripts** in `backend/scripts/`, all idempotent, run with
`npx tsx scripts/<name>.ts` from `backend/`:

| Script | Purpose |
|---|---|
| `backfill-labels.ts` | Seed the primary Label for releases missing one |
| `backfill-search.ts` | Index existing members + public lists into Elasticsearch |
| `backfill-artist-latin-names.ts` | Latin renderings for non-Latin artist names |
| `heal-suffix-dupes.ts` | Merge releases duplicated by a Discogs `(n)` suffix |
| `trim-release-titles.ts` | Strip stray whitespace from titles (re-indexes ES) |
| `reenrich-genres.ts` | Re-pull genres for named releases with current tag rules |
| `mb-smoke.ts` | Live MusicBrainz smoke test (checks the outbound User-Agent) |

**Seeded data** (local dev DB): 143 releases, 56 artists, 94 labels, 3 users; 15
artist discographies cached in Redis (7d TTL). Useful demo anchors:

- **Autechre** — 173 release-groups across 2 browse pages; the discography demo.
- **Danny Brown** — the 5.8 duplicate heal; *Atrocity Exhibition* and *Old*.
- **フィッシュマンズ / 파란노을** — the only two artists with `latinName`
  (Fishmans, Parannoul); use them to check dual-script rendering and search.
- **Portishead — *Dummy*** — `demo_blake` has 2 logs on it (second flagged
  `isRelisten`), so it shows "In your diary ×2".

**Demo accounts.** `demo_blake@demo.local`, `sasha@demo.local` (plus `big_sigh`).
Passwords are local-seed only and deliberately not written here — this repo is
public. Ask the user, or reset via the register endpoint.
