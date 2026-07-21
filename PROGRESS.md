# Soundlog — Progress

Running log of what's shipped and what's next. See `README.md` for the full
build plan and `CLAUDE.md` for the project's binding patterns; this file tracks
execution state.

**Repo:** https://github.com/blakewedding/soundlog · `main`
**Last updated:** 2026-07-21

## Status

`origin/main` verified as an exact mirror of local — head `515b7d0`, root tree
`2cebd29`, 0 ahead / 0 behind. History scanned across every commit: no `.env`
and no secrets committed.

Suites: **backend 148 tests, web 46 tests**, both typecheck clean.

## Done

| Phase | What | State |
|-------|------|-------|
| 0 | Scaffolding (monorepo, health checks, Prisma schema, compose, K8s starters) | ✅ |
| 1 | Auth — email/password + Spotify/Google OAuth, rotating refresh tokens | ✅ |
| 2 | Music data layer — MusicBrainz canonical, Discogs/Last.fm/Spotify, ES | ✅ |
| 3 | Ratings, reviews, threaded comments, ranked lists | ✅ |
| 4 | Social graph & activity feed (BullMQ fan-out) | ✅ |
| 4.1 | Interactive review cards everywhere (optimistic likes, inline threads) | ✅ |
| 5 | Discovery & search — labels, tabbed search, genre/year charts, popular feed, similar listeners, Explore | ✅ |
| — | Infra fixes — pnpm-aware `Dockerfile.backend` (builds), dev Varnish path (`host.docker.internal`) | ✅ (`0f24003`) |
| 5.7 | Seed-pipeline reliability (retry transient MB, skeleton-then-enrich, resumable) + optimistic ratings | ✅ (`1000028`) |
| 5.8 | Strip Discogs artist disambiguation suffix `(n)`, heal existing duplicates | ✅ (`efdcc1a`) |
| 5.6 | Full artist discographies — paginated MB browse, 7d cache, MBID-only merge, type grouping, progressive loading, click-to-materialize, rate-limited refresh | ✅ (`422bb7e`) |
| 5.6.1 | Discography QA fixes — log-listen durability + 401→refresh→retry, ArtistCredit (no dead artist text), refresh-slot mis-keying, non-Latin artist names, cover-art smoothing, genre-tag quality | ✅ (`c162226`) |
| — | `CLAUDE.md` — project laws for future sessions | ✅ (`ee75364`) |
| — | Systemic test mock-leakage fix (`clearMocks`) + title-trim-at-persist | ✅ (`515b7d0`) |

### Phase 5.6.1 — manual verification

| # | Check | Result |
|---|-------|--------|
| 1 | **Log-listen durability**, including one log **after the 15-minute token expiry** | ⏳ **outstanding** |
| 2 | Compilation artist credits are clickable (`New Order, Joy Division`) | ✅ passed |
| 3 | Cold-artist refresh is clean (no spurious "try again in 60 minutes") | ✅ passed |
| 4 | Fishmans renders dual-script — `Fishmans (フィッシュマンズ)` | ✅ passed |

Check 1 is the one that matters most: it's the critical bug of the phase, and
the token-expiry path is exactly what automated tests can't prove — the
`401 → refresh → replay` retry is covered by unit tests, but a *real* session
aged past 15 minutes has not been exercised end-to-end.

## Next

1. **Manual check 1 — log-listen durability.** Sign in, wait out the 15-minute
   access token, then log a listen and confirm it persists to the diary without
   a visible error. This gates 5.5.
2. **Phase 5.5 — polish.** Remaining optimistic updates (log/follow, per the 4.1
   conventions) and deferred UX polish. Optimistic ratings were already pulled
   forward into 5.7.
3. **Phase 6 — Production deployment.** See below.

> 5.7 and 5.8 ran ahead of 5.6/5.5 deliberately: reliability and the
> duplicate-data bug outranked the remaining feature polish.

## Later

- **Phase 6 — Production deployment.** Finish K8s manifests (web, ES
  StatefulSet, Redis, Varnish in front of backend, secrets), GitHub Actions
  pipeline (test → build → push → deploy), GKE Autopilot. The backend image
  builds; **full production compose stack boots end-to-end** remains unverified
  (needs migrations against the compose Postgres and in-cluster env wiring).
- **v1.1 backlog** — see `README.md`: official/bootleg live split, editions and
  reissues, track listings + weighted track ratings, collection/format tracking
  (the headline differentiator), chart builder, community genre voting.
- **Upstream data item:** MusicBrainz has no "Field Day" release-group or
  recording credited to Aphex Twin (MB's own count, 119, matches our assembly
  exactly — so this is upstream data, not a gap on our side). Submitting an edit
  means first deciding whether it's a sanctioned release or a circulating live
  set, since MB's bootleg rules apply — which is what the official/bootleg split
  above is for.
