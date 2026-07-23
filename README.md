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

### Phase 5.5 — Design polish ✅ (one tracked open defect)
> "Wordmark and identity, micro-interactions, perceived performance, a 380px responsive audit, an accessibility floor, and mobile haptics. No new features — refinement only."

**Complete.** Wordmark system (Groove glyph + Struck letterforms, rule at
display sizes only, placeholder icons deferred to Phase 7), micro-interactions,
optimistic follow/list edits, responsive audit at 380px **and** 320px, an
accessibility floor at WCAG AA, the haptics utility, a touch star input with
press-and-drag preview and commit-on-release (~29px per half-star on touch), and
a fixture-debris purge with failure-proof teardown.

**One open defect**, tracked in PROGRESS.md and blocking nothing in Phase 6: on a
physical phone the star drag previews one half-star high. It survived two fixes
that each verified clean in a desktop browser, so diagnosis is now instrumented
rather than speculative — a build stamp and an on-screen pointer readout are
shipped and awaiting one device reading.

**Real-device session — 2026-07-22.** Ran in Expo Go on a physical phone over
LAN. Confirmed working:

- [x] **The app loads and the feed populates** with live data from the API.
- [x] **Pull-to-refresh** (Phase 4, `apps/mobile/app/(tabs)/index.tsx`) — the
      `RefreshControl` gesture had never run on a touch screen. **This closes
      the Phase 4 verification item.**
- [x] **The LAN pipeline end to end** — Expo Go over `exp://` on the LAN, the
      API host derived from the bundler (`src/apiHost.ts`), and the backend
      reachable across the network.
- [x] **The New Architecture**, default since SDK 53, runs without issue.

```bash
# what the session used
cd ~/Downloads/soundlog && EXPO_PUBLIC_DEV_TOKEN=$(cd backend && npx tsx scripts/dev-token.ts) \
  pnpm --filter @soundlog/mobile dev --clear
```

**Still unverified, and now known to be blocked rather than merely pending:**

- **Haptic feel.** `apps/mobile/src/haptics.ts` holds the whole vocabulary and
  its tests cover the mapping, the per-half-star drag behaviour and the
  never-throw guarantee. What tests cannot cover is how it *feels* — and the
  device session confirmed there is nothing to fire one: no rating, log, follow
  or like exists on mobile, so **no intent has a call site**. This is not a
  scheduling problem; it needs the Phase 7 screens. Retuning, when it happens,
  is one table in one file and no call site picks an impact style itself.
- **The native 22px half-star ruling** — same dependency. The mobile *web*
  layout can be judged in mobile Safari today; the native star input cannot
  exist until there is a release detail screen to host it.

Both are carried into **Phase 7** below, alongside the screens they depend on.

### Mobile — Expo SDK 54

`apps/mobile` runs **Expo SDK 54**, upgraded from SDK 51 to unblock the
real-device session (current Expo Go builds only support 54). `npx expo-doctor`
passes 18/18.

**Always install Expo packages with `npx expo install`, never `pnpm add`.**
`expo install` resolves the version matching the installed SDK; `pnpm add` takes
the npm `latest` tag, which is routinely several majors ahead of the SDK and
fails at runtime rather than at install. It also registers config plugins —
`expo-secure-store` appearing under `expo.plugins` in `app.json` is what a
correct install looks like.

**Then restart Metro.** A running bundler caches its module map at startup, so a
package installed afterwards is invisible to it: the device shows
`Unable to resolve module <x>` while `package.json`, the lockfile, `node_modules`
and a fresh `expo export` are all perfectly correct. It reads as a code bug and
sends you hunting through a diff where nothing is wrong.

```bash
pnpm --filter @soundlog/mobile dev --clear
```

**Verify mobile with the bundle, not just types and tests:**

```bash
pnpm --filter @soundlog/mobile verify   # typecheck + tests + real Metro bundle + bundler freshness
```

Typecheck and unit tests can both pass on an app that cannot run. `tsc` will
resolve a package hoisted into pnpm's virtual store even when the app's own
`node_modules` has no link to it, and Vitest mocks native modules
(`vi.mock("expo-secure-store")`) — so the suite proves the logic and says
nothing about resolvability on a device. Only bundling exercises Metro's real
resolver over the real graph. `verify` also fails when the running bundler
predates the last dependency change, which is the one failure no repo-level
check can see.

The upgrade path, for the next one:

```bash
pnpm --filter @soundlog/mobile add expo@^<major>.0.0
cd apps/mobile && npx expo install --fix   # resolves everything else to the SDK
npx expo-doctor                            # then fix what it reports
npx expo export --platform ios             # proves Metro can still bundle
```

#### Where the mobile app finds the API

On a phone, `localhost` is the phone — a dev build pointed at
`http://localhost:4000` reaches nothing and fails in a way that looks like the
server is down. `apps/mobile/src/apiHost.ts` resolves the base URL instead of
hardcoding it, in this order:

1. **`EXPO_PUBLIC_API_URL`**, or **`extra.apiUrl`** from the app config. An
   explicit setting always wins. **This is the production path** — Phase 6 sets
   `extra.apiUrl` to the real API domain.
2. **The Expo bundler's own host**, in development only. Expo already told the
   device where to fetch JavaScript from and exposes it as
   `Constants.expoConfig.hostUri` (`192.168.1.151:8081`); that host is reused
   with the API port. No IP to update when the network changes, the router
   reassigns a lease, or someone runs the repo on their own laptop.
3. **localhost** — correct for a simulator sharing the host machine, a
   deliberate last resort elsewhere, and warned about loudly.

Tunnel hosts (`--tunnel`, `*.exp.direct`) are rejected at step 2 on purpose:
they proxy the *bundler* port only, so appending `:4000` yields a URL that
resolves but refuses. Use `EXPO_PUBLIC_API_URL` with a tunnel.

#### Signing in on a device (development only)

`/api/feed` is authenticated **by design** — the personal feed is private, and
`/api/feed/popular` is the public one. This mirrors the web, where `Home.tsx`
renders the personal feed only for a signed-in user.

Mobile has no real auth until Phase 7, so dev builds ship a sign-in on the
**You** tab. It posts to the same `/api/auth/login` the web client uses — there
is no development-only backend surface — and stores the token with
`expo-secure-store`.

Use the device sign-in rather than `EXPO_PUBLIC_DEV_TOKEN`. Those variables are
inlined by Babel **at bundle time**, so a Metro restarted without the variable
silently serves a build that sends no `Authorization` header, and a working
session becomes "Sign in to see your feed" with nothing in the diff to explain
it. A SecureStore token survives Metro restarts, `--clear`, and reloads.

The env variable still works as a fallback if you prefer it:

```bash
EXPO_PUBLIC_DEV_TOKEN=$(cd backend && npx tsx scripts/dev-token.ts) \
  pnpm --filter @soundlog/mobile dev
```

The whole dev sign-in is gated on `__DEV__`, which is a build-time constant, so
it is dead-code eliminated from release bundles — verified by grepping the
production Hermes bytecode for its strings (all absent; the plain placeholder
screen is what remains).

The dev feed screen prints the resolved base URL and which rule produced it, so
a device failure names its own cause.

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
- **`extra` does not round-trip through Expo's config serialiser.** A
  `"apiUrl": null` in `app.json` arrives at runtime as `{}` — *truthy*. Treating
  `extra` values as the types you wrote crashes at module load. Anything read
  from `Constants.expoConfig.extra` must be validated, not asserted; see
  `resolveApiBaseUrl`, which takes it as `unknown`.

### Phase 6 — Production deployment
> "Finish the K8s manifests in infrastructure/k8s: web deployment, Elasticsearch StatefulSet, Redis deployment, Varnish deployment in front of the backend service, secrets, and a GitHub Actions pipeline (test → build → push → deploy). Target GKE Autopilot."

**Verification items:**
- [x] **Cover URLs are `https`, so TLS won't blank the catalog.** 77% were
  cleartext (220 of 284); browsers block mixed content, so they would have
  broken on the production web app the day it got a certificate. Normalized at
  persist and healed catalog-wide — 0 of 285 remain. Re-check after any bulk
  import with `npx tsx scripts/heal-cover-https.ts --dry-run`.
- [x] **Backend production image builds.** `infrastructure/docker/Dockerfile.backend` is pnpm-workspace-aware: it copies the lockfile + every workspace manifest (`--frozen-lockfile` validates all importers), installs, generates the Prisma client, compiles, then uses `pnpm deploy --prod` to emit a standalone runtime tree. Verified end-to-end with `docker build -f infrastructure/docker/Dockerfile.backend .` and by instantiating `PrismaClient` inside the resulting image.
- [ ] **Full production compose stack boots end-to-end.** `docker compose -f docker-compose.yml up -d` must bring up postgres + redis + elasticsearch + the built backend image + Varnish, with `/api/health` green *through* Varnish on :8080 and container-to-container VCL (`default.vcl`) in use. Currently unverified: the backend image builds and Varnish is proven against the dev server, but the containerized backend has not been booted as a full stack (it needs migrations run against the compose Postgres and the `.env` wired for in-cluster hostnames). **This is the first thing to close in Phase 6.**
- [ ] **Swap the OAuth redirect URIs for production.** Three values in
  `backend/src/config/env.ts` still default to loopback and will silently break
  sign-in the moment the app is served from a real domain:

  | Variable | Dev default | Production needs |
  |---|---|---|
  | `CLIENT_URL` | `http://127.0.0.1:3000` | the real web origin |
  | `SPOTIFY_REDIRECT_URI` | `http://127.0.0.1:4000/api/auth/spotify/callback` | the real API origin |
  | `GOOGLE_REDIRECT_URI` | `http://127.0.0.1:4000/api/auth/google/callback` | the real API origin |

  Changing the env vars is only half of it — **the same URLs must be registered
  in the Spotify and Google consoles**, or the provider rejects the callback
  with a redirect-URI mismatch. Both go in the K8s secret, never a ConfigMap
  (CLAUDE.md §7).

  Related dev-only wrinkle worth fixing at the same time: `CLIENT_URL` is
  `127.0.0.1` while the app is actually used on `localhost`, and browsers treat
  those as different cookie origins — so the refresh cookie set under one host
  is invisible on the other. Harmless locally once you know; a real
  inconsistency to resolve before it is baked into production config.

### Phase 7 — Brand assets, mobile app & deferred design work

Work that Phase 5.5 deliberately did not do, because each item is a new piece of
design or a new component rather than polish on an existing one. The full
deferral list, with reasons detailed in the sections below:

| Deferred | Why it is not 5.5 work |
|---|---|
| **Mobile auth** (real email/password + OAuth code exchange) | New feature. Dev-only SecureStore sign-in exists as scaffolding; the backend's redirect URIs still point at `127.0.0.1` and must move to the `soundlog://` scheme. |
| **Mobile release detail screens** | New screens. Mobile is read-only — feed tab only. |
| **Mobile star input** | Needs a release detail screen to live on. |
| **Haptic feel verification** | Blocked, not pending: no mobile screen fires an intent, so there is nothing to feel. |
| **Native half-star ruling** | Same dependency — no native star input exists to judge. |
| **Covers on device** | Mobile renders no images at all; the URL data is already https-safe, the rendering is unbuilt. |
| **Mobile nav pattern** (disclosure or tab bar) | A new navigation component, not a refinement. Current wrap costs ~18% of a 380px viewport. |
| **Final app icon design** | Current icons are geometrically faithful placeholders, not finished design. |
| **Desktop star hit-width** (8×24) | Pre-existing and outside 5.5's mobile brief. |

#### Mobile app — the screens that don't exist yet

**Device-verified 2026-07-22:** the app loads in Expo Go over LAN, the feed
populates with live data from the API, and pull-to-refresh works — closing the
Phase 4 verification item. The New Architecture (default from SDK 53) runs
without issue. What follows is everything the device session confirmed is
*absent by design*.

- **Auth.** There is none. `expo-auth-session` is a dependency but is imported
  nowhere, and the feed authenticates with a dev token minted by
  `backend/scripts/dev-token.ts`. Needs email/password sign-in **and** the OAuth
  code-exchange flow. The backend is not ready for the device half of this:
  `CLIENT_URL`, `SPOTIFY_REDIRECT_URI` and `GOOGLE_REDIRECT_URI` all default to
  `127.0.0.1`, which a phone cannot use — the redirect has to move to the
  `soundlog://` scheme registered in `app.json`.
- **Release detail screen**, with the half-star `StarRatingInput`.
- **Log / review / list actions** — the write paths. Mobile is read-only today.

Two Phase 5.5 items are **blocked on the above** and cannot be settled first:

- **Haptic feel.** `apps/mobile/src/haptics.ts` holds the whole vocabulary and
  its tests pass, but *no intent has a call site* — there is no rating, log,
  follow or like on the device to fire one. Verifying how the intent→style table
  actually feels needs those screens. Retuning is one table in one file.
- **The native half-star ruling.** The *web* layout's target was ruled on a real
  device in 5.5 — fiddly at 22px, widened to ~29px per half-star on touch. The
  *native* input cannot be judged until a release detail screen exists to put
  one on, and it should start from the web ruling rather than 22px.

**Carry this into the mobile star input:** there is an **open defect** on the
web control — on a physical phone the drag preview reads one half-star high
(3 while the thumb is on 2.5), surviving two fixes that both verified clean in a
desktop browser. Diagnostics are staged (build stamp + on-screen pointer
readout); see PROGRESS.md. Whatever that turns out to be probably applies to a
native implementation too, so resolve it before porting the mapping.

**Cover images — the URL half is fixed; the rendering half is still to build.**
Mobile renders no images today (`FeedRow` is text-only), so adding them is
Phase 7 work. The data they will consume is now safe: cover URLs are normalized
to `https` at persist and the existing catalog has been healed (**0 of 285
cleartext**, was 220 of 284). That closes both the iOS ATS failure — cleartext
is blocked in release builds but allowed in Expo Go, so it would have passed
every dev test and failed only once shipped — and mixed-content blocking on the
web once Phase 6 serves the site over TLS.

**Do not "fix" this by verifying URLs and dropping the broken ones.** The Cover
Art Archive returns intermittent 500s on *both* schemes — one URL returned 500
four times consecutively and 200 on the fifth. Blanking on a failed check would
delete good artwork on a transient error, which is precisely what CLAUDE.md §1
forbids. `toSecureUrl` is a pure rewrite and makes no network call; keep it that
way.

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
