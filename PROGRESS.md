# Soundlog — Progress

Running log of what's shipped and what's next. See `README.md` for the full
build plan; this file tracks execution state.

**Repo:** https://github.com/blakewedding/soundlog · `main`
**Last updated:** 2026-07-20

## Status

`origin/main` verified as an exact mirror of local — commit `efdcc1a`, root tree
`fe42dcd`, 0 ahead / 0 behind. History scanned across every commit: no `.env` and
no secrets committed.

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
| 5.8 | Strip Discogs artist disambiguation suffix `(n)`, heal existing duplicates | ✅ committed & pushed (`efdcc1a`) |

Suites at last check: backend 128 tests, web 32 tests, both typecheck clean.

## Next

1. **Phase 5.6 — discographies.** Artist/label pages present full discographies.
2. **Phase 5.5 — polish.** Remaining optimistic updates (log/follow, per 4.1
   conventions) and the deferred UX polish. (Optimistic ratings already pulled
   forward into 5.7.)

> Note: 5.7 and 5.8 were done ahead of 5.6/5.5 deliberately (reliability and the
> duplicate-data bug were higher priority than the remaining feature polish).

## Later

- **Phase 6 — Production deployment.** Finish K8s manifests (web, ES StatefulSet,
  Redis, Varnish in front of backend, secrets), GitHub Actions pipeline
  (test → build → push → deploy), GKE Autopilot. Backend image builds; **full
  production compose stack boots end-to-end** is still unverified (needs
  migrations against compose Postgres + in-cluster env wiring).
- Open question: editorial genre descriptions (who authors/maintains, where they
  live, localization) — decide before building genre description content.
