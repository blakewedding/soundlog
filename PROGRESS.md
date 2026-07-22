# Soundlog — Progress

Execution state. `CLAUDE.md` holds the binding patterns (read it first);
`README.md` holds the build plan and v1.1 backlog. This file is the "where are
we, what's live, what's next" for a session starting cold.

**Repo:** https://github.com/blakewedding/soundlog · `main`
**Last updated:** 2026-07-21

## Status

`origin/main` is an exact mirror of local — head `44ed01c`, 0 ahead / 0 behind,
trees identical, clean working tree. History re-scanned across every commit: no
`.env`, no key material, ever.

**Phases 0 through 5.8 are done. Phase 5.5 (design polish) closes the feature
work** — committed and pushed as `44ed01c`. Suites green: **backend 149 + web 79
+ mobile 10 = 238 tests**, all three packages typecheck clean.

The 5.5 *code* is shipped; what remains is human sign-off. **Mobile is verified
on a real device as of 2026-07-22** — the app loads over LAN, the feed
populates, pull-to-refresh works (closing the Phase 4 item), and the New
Architecture runs clean. What's left of the manual pass is the web layout in a
phone browser, plus taste calls a browser can't make. Then **Phase 6 —
production deployment.**

Two 5.5 items turned out to be **blocked rather than pending**: haptic feel and
the native half-star ruling both need mobile screens that don't exist. Both moved
to **Phase 7**, which now carries the mobile app's missing surface — auth,
release detail, and the write actions.

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
| 5.5 | Design polish — wordmark + placeholder icons, motion system, optimistic follow/list, cover tints + hover prefetch, 380px audit, accessibility floor, haptics map | `44ed01c` |

> Numbering is out of order on purpose: 5.7, 5.8, 5.6 and 5.6.1 all ran ahead of
> 5.5, because reliability and data-integrity bugs outranked design polish.

**Resolved, don't re-investigate:** the "log listen doesn't persist" report was a
*feedback* bug, not durability. Logs always persisted; the button settled back to
a label identical to never-logged, so success looked like failure. Fixed in
5.6.1b — see that commit before touching the log button.

## Phase 5.5 — what landed, and what it taught

Design polish. Details worth carrying forward:

- **Wordmark** — Groove glyph + Struck letterforms, flat gold, no gradients.
  The hairline rule is **size-derived, not a per-call-site choice** (on at
  ≥32px, off below): at nav scale it sits within ~20px of the nav's own border
  and the two read as a mistake. The glyph has two optical cuts — open arcs
  above 18px, a **closed** ring below. The closed cut exists because dropping
  one arc made the survivor read as a crescent moon at 20px.
- **Icons are PLACEHOLDERS** (`apps/web/public/icons/`), generated from
  `src/lib/iconGeometry.json` by `apps/web/scripts/generate-icons.mjs`. Both the
  generator and any preview must read that JSON — an earlier version duplicated
  the geometry and previewed a mark we don't ship. Replacement is a file swap;
  see the README's **Phase 7** entry and `public/icons/README.md`.
- **Motion tokens** live in `:root` (`--motion-*`, `--ease-*`). One overshoot in
  the whole system, reserved for committing a rating.
  **`prefers-reduced-motion` is a blanket wildcard, not a per-rule list** — the
  old version enumerated known animations, so every animation added later
  escaped it silently.
- **`followCache.ts` / `listCache.ts`** join `reviewCache` / `releaseCache`. All
  four patch every cached surface in place. Follow moves counts in *both*
  directions (target's followers, viewer's following).
- **Hover prefetch refuses `<source>:<id>` refs.** `GET /api/releases/mb:…` is
  seed-on-first-access: it WRITES a row and spends a MusicBrainz throttle slot.
  A cursor crossing a search grid must never seed the catalog.
- **Cover tints** are extracted client-side into `localStorage`, muted in HSL
  into a narrow dark band. Do not "simplify" this by normalising chroma — that
  was v1, and it produced twelve identical greys because it discards lightness.
- **Responsive rules key on `(pointer: coarse), (max-width: 560px)`**, both on
  purpose: a desktop browser at 380px reports a *fine* pointer, so
  `pointer: coarse` alone is untestable.
- **Haptics map** — `apps/mobile/src/haptics.ts` is the only place a vibration is
  chosen. Call sites pass **intents** (`commitLog`), never impact styles, so
  retuning on hardware is one edit in one table. Nothing throws: a haptic can
  never break the write that triggered it.
  **No intent has a call site yet** — mobile ships only a feed tab and a
  placeholder profile, so there is no rating/log/follow/like to attach to. The
  map is deliberately ready ahead of those screens.
  *(Written against SDK 51's `expo-haptics@13`; the SDK 54 upgrade moved it to
  `15.0.8` with no source change — every API it uses is unchanged.)*
- **Never install Expo packages with `pnpm add`.** Use `npx expo install`, which
  resolves to the version matching the installed SDK. Plain `pnpm add
  expo-haptics` fetches the npm `latest` tag, which during 5.5 was three majors
  ahead of the SDK and silently wrong.

**Accessibility floor (now the baseline — don't regress it):**

- Every gold-on-ink text pairing clears **WCAG AA 4.5:1**. `--text-faint`,
  `--gold-dim` and `--danger` were all lifted to get there.
- `--line` (1.39:1) is for **decorative** separators only. Any border that is
  the sole identifier of a control uses **`--line-strong`** (≥3:1).
- One `:where(…):focus-visible` rule covers every focusable, declared before
  component styles so nothing can silently lose a focus ring. Never re-introduce
  `outline: none` without a replacement.
- The lightbox is a real modal: focus in, trapped, restored. Search tabs are a
  real tablist: one tab stop, arrows/Home/End.

## Next — 1. the 5.5 manual pass (Blake), then 2. Phase 6

### 1. Manual pass on 5.5

Everything in 5.5 was demoed in a browser, but a browser cannot judge taste and
cannot vibrate. Outstanding human verification:

#### Real-device checklist

Two different device contexts, both needing actual hardware. Start the stack
once and both are reachable from a phone on the same network:

```bash
docker compose up -d postgres redis elasticsearch
pnpm dev                              # api :4000, web :3000
pnpm --filter @soundlog/mobile dev    # scan the QR with Expo Go on a real phone
```

**A · Expo session (the native app) — DONE 2026-07-22.** Ran in Expo Go on a
physical phone over LAN, on **Expo SDK 54** (upgraded from 51 specifically to
unblock this), `expo-doctor` 18/18:

- [x] **App loads over LAN and the feed populates** with live API data.
- [x] **Pull-to-refresh** (Phase 4) — **closes the Phase 4 verification item.**
- [x] **LAN pipeline end to end** — `exp://` over LAN, API host derived from the
  bundler (`src/apiHost.ts`), backend reachable across the network.
- [x] **New Architecture** (default since SDK 53) runs without issue.
- [ ] **Haptics feel — BLOCKED, not pending.** The device session confirmed
  there is nothing to fire a haptic: no rating, log, follow or like exists on
  mobile, so **no intent has a call site**. This needs the Phase 7 screens, not
  another device session. Retuning is one table in one file when it happens.

How the session was started, for the next one:

```bash
cd ~/Downloads/soundlog && EXPO_PUBLIC_DEV_TOKEN=$(cd backend && npx tsx scripts/dev-token.ts) \
  pnpm --filter @soundlog/mobile dev --clear
```

- **The API host derives itself** — `src/apiHost.ts` reuses the Expo bundler's
  own LAN host with port 4000, so there is no IP to set and it survives network
  changes. `EXPO_PUBLIC_API_URL` remains an override, still required with
  `--tunnel`.
- **The feed needs a token.** `/api/feed` 401s without one;
  `backend/scripts/dev-token.ts` mints a 12h token (longer than the 15-minute
  production TTL on purpose — a token expiring mid-session looks like an auth
  bug).
- **`EXPO_PUBLIC_*` is inlined at bundle time**, so the token must be in the
  environment of the Metro process serving the bundle. Re-using an
  already-running bundler that was started without it silently 401s.
- The dev feed screen prints the resolved base URL and the rule that produced it
  (`configured` / `expo-lan` / `fallback`) beneath the empty state.

**B · Mobile browser (the web layout) — STILL OPEN.** Not covered by the
2026-07-22 session, which exercised the *native* app. A desktop browser narrowed
to 380px reports a *fine* pointer, so it exercises the width half of the
responsive rules but never the touch half — and a mouse is far more precise than
a thumb, which flatters every hit-target decision:

- [ ] **Drag a half-star rating one-handed, thumb only, on the 380px web layout
  in mobile Safari — rule on whether 22px per half-star is comfortably usable or
  fiddly.** Deferred deliberately: a fine pointer cannot answer this. If it is
  fiddly, the fix is a wider star box, **not** larger type — `.stars` is
  JetBrains Mono, so font size does not buy hit width (this is exactly why the
  mobile fix widened the box instead of the glyph). The box is
  `.star-input > span { min-width }` in `theme.css`.
  *This is the WEB layout in a phone browser, and is doable today.* The
  equivalent ruling for the **native** star input is Phase 7 work — there is no
  release detail screen on mobile to host one yet.
- [ ] While there: **iOS focus-zoom** should not fire on any input (fields are
  16px for this reason), and the nav's three wrapped rows should still be
  thumb-reachable.

Reach the web app from the phone at `http://<dev-machine-LAN-IP>:3000` — not
`localhost`, and note the cookie-origin caveat below if sign-in looks broken.

**Judgement calls worth a second opinion** — each was a deliberate choice, not
an oversight, and each is cheap to reverse:

- **The wordmark rule threshold** (≥32px). Off in the nav, on at display sizes.
- **The glyph's two optical cuts** — favicon (closed ring) and app icon are not
  the same shape as the nav glyph (open arcs). Standard optical sizing, but you
  may prefer one form everywhere.
- **Lifted palette tokens.** `--text-faint`, `--gold-dim` and `--danger` are all
  lighter than they were, to clear AA. The tonal ladder is compressed as a
  result; check it still reads as "Gold on Vinyl" at full size.
- **Cover tint strength** — saturation capped at 0.45, lightness 0.10–0.24.
- **Nav at 380px** wraps to three rows (~146px tall, ~18% of the viewport).
  Functional and fully reachable, but tall. Logged as **Phase 7** scope in the
  README — a disclosure menu or tab bar is a new navigation component, not
  polish, so it was not built here.
- **Half-star hit targets.** The web layout is 22×44 — **verdict still deferred
  to a mobile-Safari pass** (section B above), because a fine pointer flatters
  it. The **native** ruling is Phase 7, gated on a mobile release detail screen
  existing. Desktop is 8×24: pre-existing, outside 5.5's mobile brief, tight
  even for a mouse, and noted under Phase 7 alongside the nav item.

### 2. Phase 6 — production deployment

Finish the K8s manifests, GitHub Actions (test → build → push → deploy), GKE
Autopilot. The first open item below is the thing to close first.

Reconcile `CLIENT_URL` (`http://127.0.0.1:3000`) with the `localhost` host the
app is actually used on — see the cookie-origin note under local environment.

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
- **Icon set is placeholder** — geometrically faithful and correct as files, but
  not finished icon design. Small-size optical refinement, iOS squircle fitting,
  the full platform size ladder and a monochrome cut are tracked as **Phase 7**
  in the README. Replacement is a drop-in file swap.
- **The API process died once mid-session** (Phase 5.5) and returned 503s until
  restarted. Cause not captured — the logs went with the process. If it recurs,
  grab `preview_logs` before restarting.
- **Mobile cover images are an untested path with a known trap.** `FeedRow` is
  text-only, so nothing on the device has ever loaded an image. Roughly half the
  catalog's `coverUrl` values are `http://` (5 of 11 in a sampled feed page) and
  iOS App Transport Security blocks cleartext loads in *release* builds while
  Expo Go allows them — so images would work in dev and show a grid of blanks in
  production. Fix at the source (store `https` URLs; the Cover Art Archive
  serves both) rather than opening an ATS exception. Tracked in Phase 7.

## Local environment notes

Things that cost time to rediscover and live nowhere else.

**Dev servers.** `.claude/launch.json` defines **two** configs — `api` (:4000)
and `web` (:3000) — both `"autoPort": false`. Start `api` first; the web app is
useless without it.

The web config passes `--port 3000 --strictPort` to Vite explicitly. Without
those flags Vite silently falls back to another port when 3000 is taken, while
the harness still believes it is on 3000 — you then drive a server that isn't
there. `--strictPort` makes it fail loudly instead.

*Corrected 5.5:* the old note here claimed a reassigned port "breaks sign-in"
because of CORS. **CORS is `origin: true`** (`backend/src/app.ts`) and reflects
any origin, so the app works fine on another port. Only the **OAuth redirect**
(`${CLIENT_URL}/auth/callback`) is pinned to 3000 — so on a different port
everything works except Spotify/Google sign-in.

**Use `localhost:3000`, not `127.0.0.1:3000`.** Cookies treat them as different
origins, and the refresh-token cookie is set under whichever host you logged in
with — the other one renders logged-out and looks like a broken session.
`CLIENT_URL` is `http://127.0.0.1:3000`, so the two disagree; worth reconciling
before Phase 6.

If port 3000 is held by an unrecognised `node`, it is usually an orphaned Vite:

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
| `dev-token.ts` | Mint a local access token (default `demo_blake`, 12h) for clients with no sign-in — i.e. the Expo app. Prints only the token, so it composes: `EXPO_PUBLIC_DEV_TOKEN=$(cd backend && npx tsx scripts/dev-token.ts)` |

**Seeded data** (local dev DB): 143 releases, 56 artists, 94 labels, 3 users; 15
artist discographies cached in Redis (7d TTL). Useful demo anchors:

- **Autechre** — 173 release-groups across 2 browse pages; the discography demo.
- **Danny Brown** — the 5.8 duplicate heal; *Atrocity Exhibition* and *Old*.
- **フィッシュマンズ / 파란노을** — the only two artists with `latinName`
  (Fishmans, Parannoul); use them to check dual-script rendering and search.
- **Portishead — *Dummy*** — `demo_blake` has **4** logs on it (all but the
  first flagged `isRelisten`), so it shows "In your diary ×4". *Corrected 5.5:
  this said ×2; the count drifts as the demo account is used, so treat it as
  "more than one" rather than an exact figure.*

**Demo accounts.** `demo_blake@demo.local`, `sasha@demo.local` (plus `big_sigh`).
Passwords are local-seed only and deliberately not written here — this repo is
public. Ask the user, or reset via the register endpoint.
