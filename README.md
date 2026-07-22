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

### Phase 5.5 — Design polish
> "Wordmark and identity, micro-interactions, perceived performance, a 380px responsive audit, an accessibility floor, and mobile haptics. No new features — refinement only."

**Requires a real device — cannot be verified in CI, a simulator, or a browser:**

- **Haptics.** `apps/mobile/src/haptics.ts` holds the whole vocabulary and its
  tests cover the mapping, the per-half-star drag behaviour, and the
  never-throw guarantee. What tests *cannot* cover is how it feels: simulators
  have no vibration hardware and silently no-op, so the choice of impact style
  per intent is unvalidated until it runs on a phone. Expect to retune the
  table in that one file.
- **Pull-to-refresh** (Phase 4, `apps/mobile/app/(tabs)/index.tsx`). The
  `RefreshControl` gesture needs a touch screen; it has never been exercised on
  hardware either.

Both need an Expo session on a physical iOS or Android device. **Unblocked** —
the app was on SDK 51, which current Expo Go builds no longer support; it now
runs SDK 54 (see below):

```bash
pnpm --filter @soundlog/mobile dev   # scan the QR with Expo Go on a real phone
```

**Haptics wiring status.** The map is complete and centralised, but mobile
currently ships only a feed tab and a placeholder profile — there is no rating
input, log button, follow or like on the device yet, so *no intent has a call
site*. The utility is deliberately ready ahead of those screens; wiring is one
`haptic("commitLog")` per action when they land, and no call site ever picks an
impact style itself.

### Mobile — Expo SDK 54

`apps/mobile` runs **Expo SDK 54**, upgraded from SDK 51 to unblock the
real-device session (current Expo Go builds only support 54). `npx expo-doctor`
passes 18/18.

**Always install Expo packages with `npx expo install`, never `pnpm add`.**
`expo install` resolves the version matching the installed SDK; `pnpm add` takes
the npm `latest` tag, which is routinely several majors ahead of the SDK and
fails at runtime rather than at install.

The upgrade path, for the next one:

```bash
pnpm --filter @soundlog/mobile add expo@^<major>.0.0
cd apps/mobile && npx expo install --fix   # resolves everything else to the SDK
npx expo-doctor                            # then fix what it reports
npx expo export --platform ios             # proves Metro can still bundle
```

**Two workspace-specific traps**, both hit during the 54 upgrade:

- **Two React majors now coexist** — web on 18, mobile on 19. pnpm hoists a
  single `@types/react` into its virtual store, and store-resident packages
  (`react-router-dom`) resolve React types by walking up to it. When mobile
  pulled in `@types/react@19` that hoisted copy flipped, and *web* broke with
  "cannot be used as a JSX component" on every route. Fixed by pinning React
  types per package in `apps/web/tsconfig.json` (`paths`), which no longer
  depends on install order. Do the same for any future package that needs its
  own React major.
- **`expo-router` requires peers that Expo does not install for you** —
  `expo-constants`, `expo-linking`, `react-native-safe-area-context`,
  `react-native-screens`. These were missing since SDK 51 and would have crashed
  the app outside Expo Go. `expo-doctor` is what catches this; run it.

### Phase 6 — Production deployment
> "Finish the K8s manifests in infrastructure/k8s: web deployment, Elasticsearch StatefulSet, Redis deployment, Varnish deployment in front of the backend service, secrets, and a GitHub Actions pipeline (test → build → push → deploy). Target GKE Autopilot."

**Verification items:**
- [x] **Backend production image builds.** `infrastructure/docker/Dockerfile.backend` is pnpm-workspace-aware: it copies the lockfile + every workspace manifest (`--frozen-lockfile` validates all importers), installs, generates the Prisma client, compiles, then uses `pnpm deploy --prod` to emit a standalone runtime tree. Verified end-to-end with `docker build -f infrastructure/docker/Dockerfile.backend .` and by instantiating `PrismaClient` inside the resulting image.
- [ ] **Full production compose stack boots end-to-end.** `docker compose -f docker-compose.yml up -d` must bring up postgres + redis + elasticsearch + the built backend image + Varnish, with `/api/health` green *through* Varnish on :8080 and container-to-container VCL (`default.vcl`) in use. Currently unverified: the backend image builds and Varnish is proven against the dev server, but the containerized backend has not been booted as a full stack (it needs migrations run against the compose Postgres and the `.env` wired for in-cluster hostnames).

### Phase 7 — Brand assets & deferred design work

Design work that Phase 5.5 deliberately did not do, because each item is a new
piece of design or a new component rather than polish on an existing one.

#### Icon set

The wordmark is settled: the Groove glyph leading Struck letterforms, flat gold
throughout (`apps/web/src/components/ui/Wordmark.tsx`). The **icon set is not**.

Everything in `apps/web/public/icons/` is a **placeholder**, generated from the
glyph's closed cut by `apps/web/scripts/generate-icons.mjs`. The files are
correct *as files* — right dimensions, opaque, design-system colours, mark
inside the maskable safe zone — but they are not finished icon design.

Outstanding:

- **Small-size optical refinement.** The glyph has two cuts (open arcs above
  18px, a closed ring below) because two concentric hairlines cannot resolve in
  16 pixels. The placeholder uses the closed ring at *every* icon size for
  internal consistency, which leaves the large icons plainer than they should
  be. A real set wants per-size drawings, not one shape scaled.
- **iOS squircle fitting.** The PNGs are square and opaque so each platform can
  apply its own mask. Apple's icon shape is a superellipse, not a rounded rect,
  and artwork intended to sit inside it is drawn to that curve.
- **Full platform size ladder.** Currently 16/32/180/192/512. A complete set
  covers the Windows tile sizes, the macOS `.icns` ladder, watchOS, and Play
  Store / App Store listing art.
- **A monochrome cut** for Safari pinned tabs and any single-colour context.

Replacement is a **drop-in file swap** — same filenames, same dimensions, no
code changes. See `apps/web/public/icons/README.md` for the contract.

#### Mobile nav pattern (disclosure/hamburger or tab bar)

The 5.5 responsive audit made the nav *work* at 380px — it wraps, nothing
overflows, every link is a ≥44px target — but it does so by stacking into three
rows **~146px tall, roughly 18% of a 380px viewport**, consumed before any
content renders. Six links plus a wordmark plus an auth control genuinely do not
fit on one small-screen row, so wrapping was the honest polish-level fix.

The real fix is a different component, which is why it was deferred: a
disclosure (hamburger) menu, or a bottom tab bar for the primary destinations.
Either is a new navigation pattern, not a refinement of the existing one.

Whichever is chosen must keep what 5.5 established, all of it currently verified:

- no horizontal scroll on the document at 380px;
- ≥44px targets on every nav control;
- a visible `:focus-visible` ring on every focusable (the global rule in
  `theme.css` covers new elements automatically — don't opt out of it);
- if it is a disclosure menu, it is a modal-ish surface and owes the same
  keyboard contract the lightbox already implements: focus moves in, is trapped
  while open, and returns to the trigger on close (see
  `apps/web/src/components/ui/Lightbox.tsx` and its tests for the pattern).

Related, same area: the **desktop half-star target is 8×24** in the rating input.
Pre-existing and outside 5.5's mobile brief, but tight for a mouse. The fix is a
wider star box, not larger type — `.stars` is monospace, so font size does not
buy hit width (this is exactly why the mobile fix widens the box instead).

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
