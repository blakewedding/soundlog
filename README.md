# Soundlog

A Letterboxd-style social platform for music. Log every listen, rate on a half-star scale, write reviews, comment on other members' reviews, build ranked lists, and follow other listeners — across every release type from chart albums to mixtapes, DJ mixes, and music videos nobody else has logged.

**Stack:** Turborepo · Node.js/Express (TypeScript) · Prisma · PostgreSQL · Redis · Elasticsearch · Varnish · React (Vite) · React Native (Expo) · Docker · Kubernetes

**Design system:** "Gold on Vinyl" — layered warm blacks with a single restrained gold reserved for ratings, actions, and the wordmark. Archivo for display, Inter for body, JetBrains Mono for ratings and data. Tokens live in `apps/web/src/theme.css`.

---

## Getting started (Phase 0)

```bash
# 1. Install
corepack enable
pnpm install

# 2. Environment
cp .env.example .env   # fill in JWT_SECRET at minimum
ln -sf ../.env backend/.env   # Prisma CLI and dotenv resolve .env relative to cwd, not repo root

# 3. Infrastructure (Postgres, Redis, Elasticsearch)
docker compose up -d postgres redis elasticsearch

# 4. Database
pnpm db:migrate

# 5. Run everything
pnpm dev
```

- API: http://localhost:4000/api/health
- Web: http://localhost:3000
- Mobile: Metro starts automatically as part of `pnpm dev` (http://localhost:8081) — no separate `expo start` needed

### The Varnish edge (http://localhost:8080)

Varnish runs against your local `pnpm dev` server — no image build, nothing to stop:

```bash
docker compose up -d varnish     # starts standalone; backend is NOT built
curl -i 127.0.0.1:8080/api/feed/popular   # X-Cache: MISS, then HIT on repeat
```

`docker-compose.override.yml` is picked up automatically and points Varnish at
`host.docker.internal:4000` (via `infrastructure/varnish/dev.vcl`), clearing the
`depends_on: [backend]` from the base file so the production image is never built
for local work. The caching policy itself lives in `cache-policy.vcl` and is shared
verbatim with production, so dev and prod can't drift.

To run the **full containerized stack** instead — Varnish fronting the backend
*container*, as in production — bypass the override explicitly:

```bash
docker compose -f docker-compose.yml up -d
```

---

## Architecture decisions

- **One review + one rating per release per user** is enforced at the database level (`@@unique([userId, releaseId])`), not in application code.
- **Logs are separate from ratings/reviews.** A `Log` is a diary entry; relistens create new rows. This is the Letterboxd diary model.
- **Review comments are threaded one level** via `parentId` and soft-deleted (`deletedAt`) so threads don't collapse when a parent is removed.
- **Expanded `ReleaseType` enum**: ALBUM, SINGLE, SONG, EP, MIXTAPE, DJ_MIX, COMPILATION, MUSIC_VIDEO, VIDEO.
- **All third-party API calls proxy through the backend** and cache in Redis (Spotify 24h, Last.fm tags 7d, Discogs 24h). `SPOTIFY_CLIENT_SECRET` never reaches a client.
- **MusicBrainz MBIDs are the canonical dedupe key** across Spotify/Discogs/Last.fm sources. MusicBrainz is rate-limited to 1 req/sec and requires a real User-Agent.
- **Elasticsearch handles catalog + member search** with an edge_ngram autocomplete analyzer (`backend/src/config/elasticsearch.ts`). Postgres remains the source of truth; ES is an index, rebuildable at any time.
- **Varnish caches anonymous public GETs only** (release pages, search, popular feed). Authenticated traffic passes through untouched — see `infrastructure/varnish/default.vcl`.
- **Bandcamp**: no public API, so no integration. oEmbed for embeds only.

---

## Phased build plan

Work one phase at a time. Commit after each working phase. Paste the schema and folder structure into each new Claude Code session — it has no memory between sessions.

### Phase 0 — Scaffolding ✅ (this repo)
Monorepo, TypeScript backend with health checks, Prisma schema, web + mobile shells, docker-compose with all five services, K8s starting manifests.

### Phase 1 — Auth
> Claude Code prompt: "Implement auth for this Express + TypeScript backend: email/password registration and login using bcryptjs, JWT access tokens (15min expiry) signed with JWT_SECRET, rotating refresh tokens stored hashed in the RefreshToken Prisma model and delivered as httpOnly cookies, and Passport.js Spotify + Google OAuth creating OAuthAccount records. Wire the existing requireAuth middleware. Write vitest + supertest integration tests for every auth route."

### Phase 2 — Music data layer
> "Complete spotifyService, lastfmService, musicbrainzService, and discogsService in backend/src/services. Add a catalogService that resolves a search result into a Release row: dedupe on musicbrainzId first, then spotifyId. Build GET /api/releases/:id (seed-on-first-access) and GET /api/search/spotify proxy. Index every new Release into Elasticsearch. Then build the web Search page with debounced search-as-you-type and the Release detail page."

### Phase 3 — Ratings, reviews, comments, lists
> "Build full CRUD for reviews, ratings, logs, review likes, threaded review comments (one nesting level, soft delete), and ranked lists, using the existing Prisma models and Zod validation middleware. React components: StarRating input (half-star precision), ReviewForm, CommentThread, ListEditor. Enforce the one-review-per-release rule with a friendly 409 response."

*Scope note:* if Phase 3 adds any release-delete path (admin or otherwise), it must also remove the release's Elasticsearch document — Postgres deletes don't cascade into the index, and orphaned ES hits become broken search results.

### Phase 4 — Social graph & feed
> "Implement follow/unfollow and GET /api/feed: paginated activity from followed users. Fan out Activity records via a BullMQ job on every log/review/rating/list/comment event. Web: follow buttons, profile tabs, home feed. Mobile: feed tab with pull-to-refresh."

### Phase 5 — Discovery & search
> "Extend Elasticsearch: index users, add genre/tag facets from Last.fm data, build the popular-reviews feed (likes, recency-weighted) and similar-listeners suggestions from overlapping high ratings. Tabbed search results: Releases / Artists / Members / Lists."

*Scope notes (added during Phase 2.5):*
- **Label pages + label search** — labels come from Discogs/MusicBrainz release data; give them the same treatment as artists (entity, page, ES index).
- **Genre and year chart hyperlinks** — genre chips and the year on a release page should link to browsable chart/list views (top releases for `dubstep`, best of `2007`, …).
- **Tabbed search including Labels** — the planned tabs become Releases / Artists / Members / Lists / Labels. Artists are already indexed in ES (Phase 2.5) ready for their tab.
- **Open design question — editorial genre descriptions:** genre pages likely deserve short written descriptions. No API provides these; they'd be content we author and maintain ourselves (where do they live, who writes them, how do they localize?). Decide before building genre pages.

### Phase 6 — Production deployment
> "Finish the K8s manifests in infrastructure/k8s: web deployment, Elasticsearch StatefulSet, Redis deployment, Varnish deployment in front of the backend service, secrets, and a GitHub Actions pipeline (test → build → push → deploy). Target GKE Autopilot."

**Verification items:**
- [x] **Backend production image builds.** `infrastructure/docker/Dockerfile.backend` is pnpm-workspace-aware: it copies the lockfile + every workspace manifest (`--frozen-lockfile` validates all importers), installs, generates the Prisma client, compiles, then uses `pnpm deploy --prod` to emit a standalone runtime tree. Verified end-to-end with `docker build -f infrastructure/docker/Dockerfile.backend .` and by instantiating `PrismaClient` inside the resulting image.
- [ ] **Full production compose stack boots end-to-end.** `docker compose -f docker-compose.yml up -d` must bring up postgres + redis + elasticsearch + the built backend image + Varnish, with `/api/health` green *through* Varnish on :8080 and container-to-container VCL (`default.vcl`) in use. Currently unverified: the backend image builds and Varnish is proven against the dev server, but the containerized backend has not been booted as a full stack (it needs migrations run against the compose Postgres and the `.env` wired for in-cluster hostnames).

---

## Backlog — v1.1

Deferred past v1 deliberately: each needs schema or policy decisions that would
slow the core loop down if taken on now.

- **Official / bootleg live split.** MusicBrainz carries a release *status*
  (official, bootleg, promotion, pseudo-release). Aphex Twin's discography is
  ~31 live entries, most of them circulating bootlegs sitting beside the
  canonical records. Use the status to separate sanctioned live albums from
  bootlegs rather than lumping both under "Live". Needs a per-release status
  field and a display policy (hide bootlegs by default? a toggle?).

- **Editions / reissues on release pages.** A release-group has many releases
  (original pressing, remaster, anniversary edition, regional variants). Show
  them on the release page with an explicit **original-issue cover-art policy**:
  the release-group's original artwork is canonical, so a 2015 remaster never
  silently replaces the 1994 sleeve. Pairs with the 3.6 date policy already in
  place (original date, never a pressing).

- **Track listings + weighted track ratings.** Schema expansion: a `Track` model
  under Release, plus per-track ratings. The release rating then becomes a
  weighted blend of the album rating and its track ratings — the thing that
  makes "this album is a 7 but track 4 is a 10" expressible.

- **Collection / format tracking — the v1.1 headline.** Track what you *own*,
  not just what you've heard: format (vinyl/CD/cassette/digital), pressing,
  condition, purchase date. This is the physical-media differentiator; no
  Letterboxd-for-music competitor does it well, and it's the natural home for
  the editions work above.

- **Customizable chart builder.** The genre/year charts already share one
  ranking query; expose it as a builder — combine type + genre + year (e.g.
  "best EPs of 1997 tagged shoegaze") with the existing weighted-rating and
  `minRatings` machinery behind it.

- **Community genre voting (v1.1+).** The RYM model: members vote on a release's
  genres instead of inheriting Last.fm's folksonomy wholesale. Phase 5.6.1
  filtered the worst of the noise, but voting is the real fix. Needs
  moderation/abuse thinking before it ships, and it supersedes the open question
  about editorial genre descriptions.

---

## Repo map

```
apps/web        React (Vite + TS) — theme.css is the design system
apps/mobile     React Native (Expo Router)
packages/shared Types, API routes, rating utils shared by both clients
backend         Express + TS API, Prisma schema, ES/Redis config, services
infrastructure  Dockerfiles, Varnish VCL, K8s manifests
```
