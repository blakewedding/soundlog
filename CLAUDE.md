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
- **Upstream work is TIERED, and the tier is about ordering, never rate**
  (`upstreamPriority.ts`). `interactive` (a person is blocked on this response) >
  `browse` (a person is watching a progress indicator) > `background` (nobody is
  waiting). Strict priority, FIFO within a tier.

  The rate is MusicBrainz's policy and is not ours to change; what 6.1.4 changed
  is **which caller gets the next slot**. A FIFO gate made an interactive seed
  take **9,034ms mid-discography-browse against 2,294ms idle** — the person lost
  because nothing distinguished them from a background job.

  The default tier is the **ambient** one, and unset means `interactive`: a call
  site that forgets to declare itself gets the user-facing tier, which is the
  harmless way to be wrong. Only work that blocks nobody opts down. A tier is
  never *upgraded* by a call site's local knowledge — see `lowerPriorityOf`.
- **Bound concurrency to every third party, not just rate.** The Cover Art
  Archive had no bound at all, and one discography grid put **37 simultaneous
  requests** on it: **8 of 37 failed**, and the timeouts that resulted failed the
  covers stage and left releases reporting `failed` with no artwork. We were
  manufacturing the upstream failure we then blamed upstream for. Bounded at
  12 concurrent with 3 reserved for interactive, the same burst lost **0 of 37**.
  A dedupe map is not a limiter.
- Discovery calls (search, fuzzy match) get **one attempt** and degrade to
  empty; lookups retry. Retrying discovery burns the very throttle slots whose
  exhaustion causes first-access failures. **This governs image bytes too**: a
  speculative `release-group/<mbid>/front-*` thumbnail for an un-seeded
  discography entry is discovery and gets one attempt (`isDiscoveryCoverUrl`),
  while a stored `coverUrl` for a release we hold is a lookup and retries. A
  discography grid asks for dozens at once — retrying each three times is how a
  Cover Art Archive 429 became a hundred requests that made the 429 worse. One
  attempt is a policy about how hard we try, never a claim the artwork is
  absent: the answer is still 503, never 404.
- **Secrets live in `.env` only** — never committed, never in a K8s ConfigMap,
  never in a URL parameter (tokens go in headers). `.env.example` holds
  placeholders only.

## 7a. The API is single-instance, and that is load-bearing

Three pieces of correctness live in one process's memory or on its local disk,
and **all** break behind a second one:

- the **MusicBrainz rate gate** — two processes each honour 1 req/s and together
  make 2 req/s, a §7 violation whose symptom is 503s indistinguishable from
  ordinary upstream flakiness;
- the **enrichment registry** (`enrichmentState.ts`) — a poll landing on the
  process that is not doing the work reads `ready` for a half-filled release,
  which is the 6.1.1 bug reintroduced by deployment topology rather than by code.
- **avatar bytes on local disk** (6.2, `avatarStorage.ts`) — and this one is
  worse than the other two. A master written on box A does not exist on box B,
  so a fraction of requests 404 an avatar that uploaded successfully, and which
  fraction depends on which process answered. The cover cache under replicas
  merely re-fetches; avatars have no upstream, so replicas do not degrade them,
  they **lose** them.

Scaling the API past one process is therefore **not a config change**. It needs a
distributed token bucket in Redis *and* a shared enrichment registry *and* shared
object storage for avatars, **together** — doing one without the others trades a
visible slowdown for a silent lie.
`config/singleInstance.ts` warns at boot when the environment implies replicas.
Deliberately a warning, not a crash — but note that avatars weakened the
justification for that choice. The first two degrade rather than corrupt and
Postgres stays truth either way (§5); the third is the first thing here whose
only copy is not in Postgres. If a second process ever becomes real, avatars move
to object storage **first**, not last.

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

An approval-adjacent user message that arrives mid-command is a gate until
proven otherwise — pause at the next natural boundary and confirm before
chaining into the next state-changing step.

## 10. A destructive query is read back BEFORE it runs, not after

Any statement that deletes or overwrites rows — `deleteMany`, `DELETE`,
`UPDATE` without a primary key, `TRUNCATE`, `drop`, a bulk re-index — may only
run once a **`SELECT` carrying the identical filter** has been executed and its
**count and rows actually read**, and they match the stated intent. Not a
similar filter. The same one.

**Prefer an explicit list of ids over a pattern.** A pattern describes what you
believe is in the table; a list of ids describes what you have looked at. When a
pattern is genuinely necessary, the `SELECT` is what converts it into the second
thing.

This exists because of 6.2a. Cleaning up one demo account created minutes
earlier, `deleteMany({ where: { email: { endsWith: "@demo.local" } } })` also
matched the seeded dev users `demo_blake` and `sasha`, and the cascade took
their reviews, ratings and logs — 131 ratings that were the product of real
browsing, unrecoverable because a developer's laptop is not in the backup story
that `backup-db.sh` implements for production.

The mechanism is the part worth keeping. **The read-back discipline this project
already follows covered file writes and did not extend to ad-hoc destructive
queries** — every config edit that session was read back, and the one statement
that destroyed data was not. A `SELECT` would have returned three rows where one
was intended and stopped it in a second. The gap was never a missing rule about
databases; it was a rule about *writes* that nobody had applied to *deletes*.

It executed against **dev**, which is why this is a law and not an incident
report. The same reflex aimed at `/srv/soundlog` is the version that ends
differently.

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
