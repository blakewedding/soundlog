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

The 5.5 *code* is shipped; what remains is human sign-off. Everything was demoed
in a browser, but a browser cannot judge taste and cannot vibrate — so **the 5.5
manual pass** (below) comes before **Phase 6 — production deployment.**

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
  retuning on hardware is one edit in one table. `expo-haptics` is pinned to
  `~13.0.1` for **SDK 51** — `pnpm add expo-haptics` grabs v57, which targets
  SDK 54+ and will not work here. Nothing throws: a haptic can never break the
  write that triggered it.
  **No intent has a call site yet** — mobile ships only a feed tab and a
  placeholder profile, so there is no rating/log/follow/like to attach to. The
  map is deliberately ready ahead of those screens.

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

**Real-device Expo session — the only way to check these at all.** Simulators
have no vibration hardware and silently no-op:

```bash
docker compose up -d postgres redis elasticsearch
pnpm dev                              # api :4000, web :3000
pnpm --filter @soundlog/mobile dev    # scan the QR with Expo Go on a real phone
```

- **Haptics feel.** The intent→style table is unvalidated on hardware. Expect to
  retune it; it is one table in one file, and no call site picks a style.
  Note there is nothing to *trigger* a haptic on the device yet (see above), so
  checking feel needs a temporary call site or waiting for the mobile screens.
- **Pull-to-refresh** (Phase 4) — the `RefreshControl` gesture has never run on
  a touch screen either.
- **`EXPO_PUBLIC_API_URL`** must be the dev machine's LAN IP, not `localhost` —
  on a device `localhost` is the phone.

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
- **Nav at 380px** wraps to three rows (~146px tall). Functional and fully
  reachable, but a disclosure menu would be shorter — that is a new feature, so
  it was not built.
- **Desktop half-star targets are 8×24.** Pre-existing and outside 5.5's brief
  (which specified mobile), but tight even for a mouse.

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
