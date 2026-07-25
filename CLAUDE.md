# Soundlog — working laws

Binding rules for this codebase. Each one exists because breaking it caused a
real bug. Violating one is a regression even if tests pass.

Stack: pnpm + Turborepo · Express/TS · Prisma/Postgres · Redis · Elasticsearch ·
Varnish · React (Vite) · React Native (Expo).

---

## 1. Error semantics — three outcomes, never two

Every upstream call resolves to exactly one of:

| Outcome | Meaning | Cacheable |
|---|---|---|
| data | the resource | yes |
| `null` | genuinely absent (404 / definitive 4xx) | **yes** |
| throws `UpstreamUnavailableError` | we couldn't tell (503/429/timeout/socket) | **never** |

**A retry-able condition is never surfaced as a permanent one.** No 404 for a
503. `errorHandler` maps `UpstreamUnavailableError` → **503 + Retry-After**.

Collapsing "unreachable" into `null` is the single most expensive bug this
project has had: a rate-limited MusicBrainz became "Release not found", and the
`null` was then cached for a week, so the retry failed too.

Every raw `fetch` to a third party must be wrapped this way — including
supplemental ones. An unguarded Cover Art Archive `fetch` threw
`TypeError: fetch failed` on a dropped socket and 500'd an already-seeded
release. Supplemental data (art, genres, similar artists) is additionally
**fault-isolated at the call site**: it may fail without failing the request.

See `backend/src/services/musicbrainzService.ts`,
`backend/src/middleware/errorHandler.ts`.

## 2. Never cache a partial assembly

Multi-page/multi-stage results are cached **only when verified complete**.
Assembly either returns everything or throws. `cached()` writes only on return,
so throwing is what keeps partials out.

Completeness is checked against upstream's own count, not our optimism. A
definitive miss on page 1 = legitimately empty (cacheable); a miss on a later
page, or a short read against the reported total = **throw**.

See `assembleDiscography` in `musicbrainzService.ts`, `cached()` in
`backend/src/services/cache.ts`.

## 3. MusicBrainz identity is canonical — match by MBID, never by name

- Release ↔ release-group, artist ↔ artist: **MBID only**.
- Never infer identity from title/artist strings.
- Namespace-qualify foreign ids (`master:N` / `release:N` — bare numbers
  collided and seeded *Bodycage* when *Live At The Liquid Room* was clicked).
- Strip Discogs's `(n)` disambiguation suffix **at ingestion**, before it can
  reach an artist row, an MB search, or a dedupe key. `Danny Brown (2)` defeated
  title+artist dedupe and produced duplicate releases.

Name matching is permitted only for *navigation affordances* (e.g. linking an
unresolved credit to search), never for identity, dedupe, or row creation.

See `backend/src/services/catalog/merge.ts` (`stripArtistDisambiguation`,
`candidateKey`), `mergeDiscography` in `discographyService.ts`.

## 4. Release dates are original, never pressings

Use the **release-group `first-release-date`** (MB) or the **master year**
(Discogs). A specific pressing/reissue year is never stored as the release date.
When healing an existing row, a date may only move **earlier**.

See `groupLevelReleaseDate` in `backend/src/services/catalogService.ts`.

## 5. Postgres is truth; Elasticsearch is a rebuildable index

- **No ES failure may block a core path.** Index writes are swallowed and
  logged; a search read degrades to `[]`. Registration, login, and list edits
  must succeed with ES down.
- **Deletes must clean both stores.** `deleteReleaseEverywhere` is the only
  sanctioned way to remove a Release; bypassing it orphans a search hit.
- Log ES failures with enough detail to diagnose (`name` + status — a
  `ConnectionError`'s `.message` is empty).

See `backend/src/services/searchService.ts` (`warnEs`).

## 6. Mutations: optimistic, visibly failing, fully invalidating

Every mutation does all three:

1. **Optimistic update** — the UI moves on click.
2. **Visible failure** — roll back *and* show an error with a retry affordance.
   A bare `await` with no `catch` is forbidden: a rejected write becomes an
   unhandled rejection and the click silently does nothing.
3. **Invalidate every query that renders the changed data** — not just the one
   on screen. Cross-surface state is patched in place so counts never disagree
   (`apps/web/src/lib/reviewCache.ts`, `releaseCache.ts`).

`request()` in `apps/web/src/services/api.ts` transparently handles
**401 → refresh → replay once** (shared in-flight refresh; auth endpoints
excluded to avoid recursion). Without it, sessions older than the 15-minute
access token silently failed every write.

## 7. Third-party access

- All third-party calls go **through the backend**. The client never calls
  MusicBrainz/Discogs/Last.fm/Spotify directly — **including images**. The
  `<img>`-straight-to-the-Cover-Art-Archive exception was closed in 6.1: artwork
  is fetched, resized and re-encoded by `/covers/w<width>/<encoded>.webp` and
  served from our own origin (`coverProxy.ts`, `coverCache.ts`).

  What the exception cost while it stood: a 2,254,558-byte JPEG original painted
  into a 140px grid tile, two redirects into an Internet Archive node, a
  1.8–2.4s TTFB, and a hostname Cloudflare could not cache on our behalf.

  A cover URL is stored in its proxied form and **encodes its upstream URL**, so
  the heal and the rollback are pure string transforms with no network call —
  the same §1 discipline as the https rewrite. The proxy accepts only
  allowlisted artwork hosts and a fixed set of widths; anything else is a 404.
- **MusicBrainz: one shared 1 req/s throttle**, process-wide. Retries ride the
  same gate. A descriptive `User-Agent` is mandatory.
- Discovery calls (search, fuzzy match) get **one attempt** and degrade to
  empty; lookups retry. Retrying discovery burns the very throttle slots whose
  exhaustion causes first-access failures.
- **Secrets live in `.env` only** — never committed, never in a K8s ConfigMap,
  never in a URL parameter (tokens go in headers). `.env.example` holds
  placeholders only.

## 8. Reuse over reimplementation

One component per concept, interactive wherever it mounts:

- `ReviewCard` — like/comment work on every surface, not just the release page.
- `ArtistCredit` — the only way an artist name is rendered; never dead text.
- `CoverImage`, `StarRating` / `StarRatingInput`, `ChartList`.
  `CoverImage` takes a `size` prop (`row` / `grid` / `hero`) that selects the
  proxied rendition — never hand-build a cover URL at a call site.

Before writing a new component, check whether an existing one should be extended
(add a prop) instead. Two controls on one page must not share an accessible name.

## 9. Rituals

A phase is not done until:

- [ ] Tests **and** typecheck green in both `backend/` and `apps/web/`.
- [ ] A **live demo** of the stated pass condition — actually exercised, not
      asserted. Report what happened, including anything that failed.
- [ ] `PROGRESS.md` updated.
- [ ] Committed **and pushed**; remote verified as an exact mirror.

**Flag any deliberate test-contract change.** If a test's expectation changes
because the behaviour intentionally changed, say so explicitly and explain why —
never quietly relax an assertion to make a suite pass.

Investigate before fixing: reproduce first, then fix the cause. Report failures
faithfully; a passing suite is not evidence a feature works.

---

## Commands

Node comes from nvm — prefix shell commands:

```bash
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

```bash
docker compose up -d postgres redis elasticsearch   # infra (stop, never `down -v`)
pnpm dev                                            # api :4000, web :3000
docker compose up -d varnish                        # edge :8080 (dev override → host)
npx vitest run                                      # per package
npx tsc -p tsconfig.json --noEmit                   # per package
```

`@soundlog/shared` is consumed from source (no build step) and is **not** a
backend dependency — backend tests cannot import it.
