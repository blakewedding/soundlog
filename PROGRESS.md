# Soundlog — Progress

Execution state. `CLAUDE.md` holds the binding patterns (read it first);
`README.md` holds the build plan and v1.1 backlog. This file is the "where are
we, what's live, what's next" for a session starting cold.

**Repo:** https://github.com/blakewedding/soundlog · `main`
**Last updated:** 2026-07-23

## Status

**PHASE 5.5 IS COMPLETE.** The polish phase is closed with **one tracked open
defect** (star half-star geometry on device — see below), which blocks nothing
in Phase 6.

**Phases 0 through 5.8 are done.** Suites green: **backend 176 + web 122 +
mobile 38 = 336 tests**, all three packages typecheck clean, `expo-doctor` 18/18.

**Next: Phase 6 — production deployment.**

### What 5.5 delivered

- **Wordmark system** — Groove glyph + Struck letterforms, flat gold throughout,
  no gradients. The hairline rule is **size-derived**: on at display sizes
  (≥32px), off in the nav, so the two cannot drift apart as call sites multiply.
  Icon assets are **placeholders**, flagged for Phase 7.
- **Micro-interactions** — motion tokens in `:root`, star-commit settle, cover
  hover lift, page fade, feed stagger. `prefers-reduced-motion` is a blanket
  wildcard, not a per-rule list.
- **Optimistic follow + list edits** — `followCache` / `listCache` join
  `reviewCache` / `releaseCache`; every bare `await` is gone.
- **Perceived performance** — dominant-colour cover placeholders, hover prefetch
  that refuses un-seeded refs (a GET on those *writes* a row).
- **Responsive audit at 380px and 320px** — no horizontal scroll anywhere, tap
  targets ≥44px.
- **Accessibility floor** — every gold-on-ink pairing clears WCAG AA 4.5:1; one
  global `:focus-visible` rule; lightbox is a real modal; search tabs are a real
  tablist.
- **Haptics utility** — the whole vocabulary in one file, intents not impact
  styles, fault-isolated. No call site yet (Phase 7 screens).
- **Touch star input** — press-and-drag with live preview, commit on release,
  alongside tap and keyboard. Widened to **~29px per half-star** on touch
  layouts per the device ruling (was 22px, ruled fiddly).
- **Fixture debris purged** — failure-proof suite teardown plus ES-vs-Postgres
  reconciliation; 1,070 orphaned search documents removed.
- **Real-device verification complete** — LAN pipeline, durable SecureStore
  auth, pull-to-refresh (closing the Phase 4 item), New Architecture clean.

*The mobile feed populates **without covers** by design: `FeedRow` is text-only
and there is no `<Image>` anywhere in `apps/mobile`.*

### Shipped in 5.5, all committed and pushed

| | |
|---|---|
| `44ed01c` | Phase 5.5 — design polish |
| `578fc4f` | Mobile: Expo SDK 54 upgrade (from 51; `expo-doctor` 18/18) |
| `22c4e77` | Mobile: LAN-aware dev API host |
| `564fa39` | Real-device session recorded; mobile scope moved into Phase 7 |
| `a6e8abe` | Cover-URL scheme measured |
| `7cda5e8` | Covers: https normalization + device-reachable URLs |
| `a44c8f4` | Mobile: on-device dev sign-in (SecureStore), replacing the inlined token |
| `7fe5854` | Mobile: expo-secure-store + bundle-resolution check |
| `171775f` | 5.5 close-out: fixture cleanup + touch star input |
| `ad78ad7` | 5.5 close-out: widen half-star hit boxes on touch |
| `4cdf7c5` | Star geometry: derive mapping from rendered boxes |
| `fa2cc49` | Star input: on-device diagnostics |

## OPEN DEFECT (the only one from 5.5) — star half-star offset on device

**Blocks nothing in Phase 6.** Web and desktop are correct; this is the touch
drag on a physical phone. Carried as a tracked defect rather than holding the
phase open, because the next step needs a device reading, not more code.

**Status: the mapping is no longer the suspect. The verification is.**

The device shows the preview one half-star high (3 while the thumb is on 2.5).
Two fixes shipped — `4cdf7c5` reworked the mapping to read rendered boxes, and
`ad78ad7` widened the boxes — and **two real-browser verifications passed** while
the phone kept failing with the *identical* symptom. A third fix is not
warranted until something reproduces the way the device does.

**Do not change `lib/starGeometry.ts` until a repro fails.** It is exhaustively
tested against measured geometry and verified in-browser; changing it again
without a failing case is guessing.

### Instrumented diagnosis, staged and shipped

- **Build stamp** — commit hash + server start time, fixed bottom-right on every
  dev page (`components/ui/BuildStamp.tsx`, hash injected by `vite.config.ts`).
  `+dirty` means the tree had uncommitted changes when the server started.
  **Check this first**: if it does not match `git rev-parse --short HEAD`, the
  phone is on a cached bundle and nothing else in the report means anything.
- **Live pointer readout** — bottom-left on the release page
  (`components/ui/StarDebugReadout.tsx`). One drag prints every input the
  mapping consumes. Both are `import.meta.env.DEV` only and dead-code eliminated
  from production.

Vite already sends `Cache-Control: no-cache` + ETag on source modules, so a
stale bundle requires a 304 against a changed file — unlikely but not
impossible, hence the stamp.

### Repro candidates, most-likely first

Each is stated with the reading that would confirm or kill it, so tomorrow's
numbers land directly on one:

1. **Stale bundle on the device.** Kill: stamp matches HEAD. Confirm: it does
   not, or the time predates the last restart. Costs nothing to check and
   invalidates everything else.
2. **visualViewport divergence (pinch-zoom).** iOS reports
   `getBoundingClientRect()` in the *layout* viewport while a pinch moves the
   *visual* one; touch `clientX` then no longer shares an origin with the boxes.
   A half-star at ~28px needs only a small zoom to drift one step. Confirm:
   `vv scale ≠ 1` or `offL ≠ 0`. This is my leading candidate — it is invisible
   to every synthetic test because the harness never zooms.
3. **Page zoom / text-size setting**, the same divergence from a different
   cause. Confirm: `vv scale ≠ 1` with no pinch, or `vw` not matching the
   device's CSS width.
4. **Coordinate space mismatch.** Confirm: `x` and `pageX` differ by a constant
   ≈ the scroll offset, meaning something upstream is feeding page coordinates
   where client coordinates are expected.
5. **Stale box measurement.** The boxes are read fresh per event, so this needs
   a layout shift *during* the drag — sticky nav resize, keyboard, or the
   `key={commitCount}` remount landing mid-gesture. Confirm: `cells L…` shifting
   between samples in one drag.
6. **iOS not delivering pointer events as assumed** — e.g. `pointercancel` mid
   drag with the gesture continuing as touch events. Confirm: `evt` shows
   something other than a clean `pointermove` run, or stops updating.
7. **devicePixelRatio.** Both rects and `clientX` are CSS pixels, so this
   *should* be irrelevant. Printed only to rule it out rather than assume it.
   Confirm: drift scales with `dpr` (2 or 3).

### What to send back

A single slow drag to the 2.5 position, then the readout verbatim — especially
`build`, `vv`, `x`/`pageX`, `cells`, and `box`/`calc`.

## 5.5 close-out — how each item landed

| Item | Outcome |
|---|---|
| Cover URL scheme | **Done.** Normalized at persist, catalog healed, 0 of 285 cleartext. Not device-verifiable as framed — mobile renders no images; verified on web + API payload. |
| Mobile-Safari star-drag ruling | **Done.** Ruled fiddly at 22px; boxes widened to ~29px per half-star on touch (`ad78ad7`). |
| Desktop taste calls | **Accepted as shipped** — wordmark rule threshold, the glyph's two optical cuts, lifted palette tokens, cover tint strength. Reversible; details under "judgement calls" below. |
| Haptic feel verification | **Moved to Phase 7** — blocked, not pending: no mobile screen fires an intent. |
| Native half-star ruling | **Moved to Phase 7** — needs a mobile release detail screen to host a star input. |
| Star half-star offset on device | **Open, tracked** — see the defect section above. |

Phase 7 now carries the mobile app's missing surface: auth, release detail, and
the write actions.

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
| 5.5 | **Design polish — COMPLETE** (one tracked open defect). Wordmark + placeholder icons, motion system, optimistic follow/list, cover tints + hover prefetch, 380/320px audit, accessibility floor, haptics map, touch star input, fixture-debris purge, real-device verification | `44ed01c` … `fa2cc49` |

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
- **The star input is driven by pointer events, not hover.** Hover does not
  exist on a phone, so tap-only rating meant hitting a 22px zone exactly. It now
  takes press-and-drag with live preview, committing on release, alongside the
  original tap and keyboard paths. Two details are load-bearing:
  `touch-action: pan-y` (vertical scroll still belongs to the page, horizontal
  drag belongs to the control) and a 4px movement threshold that separates a tap
  from a drag — a drag ends with a synthetic click on whatever zone is
  underneath, which would otherwise commit twice.
- **The pointer→value mapping reads the RENDERED BOXES, never a container width
  and a constant** (`lib/starGeometry.ts`). This is not a style preference; the
  arithmetic version shipped and drifted half a star on a real phone:
  - the row is not the stars — above ~412px the boxes hit their 64px cap and
    stop growing while the row keeps filling its flex line (336px row vs 320px
    of stars at 430px), skewing every ratio;
  - `Math.ceil` puts a boundary pixel in the zone *below*, while DOM hit zones
    are `[left, right)` — a half-star flip at every boundary.
  Both were invisible at 380px, where the boxes divide evenly and row equals
  stars. **Verifying one width proves nothing here.** `lib/starGeometry.test.ts`
  sweeps real measured geometry from 320/380/430 so flex drift fails in CI.
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
  **This bit once and cost a session** — see below. It is now fixed properly:
  sign in on the device via the **You** tab, and the token is kept in
  SecureStore, surviving Metro restarts, `--clear`, and app reloads.
- The dev feed screen prints the resolved base URL and the rule that produced it
  (`configured` / `expo-lan` / `fallback`) beneath the empty state.

**B · Mobile browser (the web layout) — STILL OPEN.** Not covered by the
2026-07-22 session, which exercised the *native* app. A desktop browser narrowed
to 380px reports a *fine* pointer, so it exercises the width half of the
responsive rules but never the touch half — and a mouse is far more precise than
a thumb, which flatters every hit-target decision:

- [x] **Half-star precision on a real device — RULED AND FIXED.** Two rounds.
  The first pass found the actual bug rather than answering the question: there
  was **no touch drag at all**, so rating on a phone meant a precise tap and a
  half-star meant the left sliver of a glyph. With press-and-drag working, the
  width was re-ruled on its merits and came back **fiddly at 22px**.

  The star boxes now flex to fill the row rather than sitting at a fixed 44px,
  giving **28.6px per half-star at 380px** (28–32 target), bounded by
  `min-width: 44px` (never worse than before) and `max-width: 64px` (32px/half).
  Widened via the box, never the glyph — `.stars` is JetBrains Mono, so type
  size buys no hit width.

  At **320px** it degrades to 22.6px with no overflow: 264px of card interior
  minus the 36px readout leaves 228px, so 28px/half is not physically available
  there. 320 is the floor, not the target.

  The **native** star input still has no ruling — Phase 7, since mobile has no
  release detail screen to host one.
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
- **Half-star hit targets — settled for the web layout.** Touch/narrow is now
  ~28.6×44 at 380px (was 22×44, ruled fiddly on device). Desktop is unchanged at
  **8×24**: pre-existing, outside 5.5's mobile brief, tight even for a mouse,
  and noted under Phase 7 alongside the nav item. The **native** input is
  Phase 7.

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
- ~~**Cover URLs are stored over `http://`**~~ — **RESOLVED**, details below.
  Measured across the whole catalog, not sampled: **220 of 284 cover URLs (77%)
  were `http://`**, every one of them `coverartarchive.org`.

  This bites in two places, and the second one is closer than it looks:

  - **iOS App Transport Security** blocks cleartext in *release* builds while
    Expo Go permits it — so mobile covers would work in dev and show blanks in
    production, once mobile renders images at all (it doesn't yet).
  - **The production web app**, which Phase 6 will serve over HTTPS. Browsers
    block mixed content, so 77% of covers would break on the *web* the moment
    the site is no longer served over plain HTTP. This is a Phase 6 concern, not
    only a Phase 7 one.

  The `https` variants serve the same artwork — verified on 7 stored URLs, all
  returning `200 image/jpeg`.

  **The constraint that makes the obvious fix dangerous:** the Cover Art Archive
  and its archive.org backend return **intermittent 500s on both schemes**. One
  URL returned 500 four times in a row and 200 (49 KB) on the fifth. A
  normalization script that verifies each URL and blanks or skips on failure
  would destroy good artwork on a transient error — the exact class of bug
  CLAUDE.md §1 exists to prevent. Rewrite the scheme unconditionally, or retry
  hard before concluding anything is missing; never turn a retryable failure
  into a permanent one.

  **RESOLVED 2026-07-22.** Normalized at persist (`src/services/coverUrl.ts`,
  applied at the single `resolveCovers` exit so a future source cannot bypass
  it) and healed catalog-wide: **110 rows rewritten, 0 of 285 cover URLs remain
  cleartext**. Re-running the heal is a clean no-op. The heal makes **no network
  calls**, for the reason directly above. Kept here because the *reasoning* still
  governs any future URL migration.
- **Resolved, don't re-investigate: red screen "Unable to resolve module
  expo-secure-store".** The package was installed correctly (`npx expo install`,
  config plugin registered in `app.json`, lockfile and symlink present, and a
  fresh `expo export` bundles it — 972 modules, `ExpoSecureStore` in the graph).
  The bundler serving the phone had started **50 minutes before the install**
  (Metro 23:22:54, symlink 00:12:25) and caches its module map at startup, so it
  never saw the package. **A running Metro must be restarted after any install**
  — `pnpm --filter @soundlog/mobile dev --clear`.

  Now caught automatically: `pnpm --filter @soundlog/mobile verify` runs
  typecheck, tests, a real Metro bundle, **and** a bundler-freshness check that
  fails when the running Metro predates the last dependency change.
- **Resolved, don't re-investigate: "the mobile feed suddenly demands sign-in".**
  Not a regression, not an expiry, and nothing to do with the covers commit or
  the SDK upgrade. `/api/feed` is `requireAuth` **by design** (`/api/feed/popular`
  is the public one), exactly mirroring the web, where `Home.tsx` renders the
  personal feed only as `{user && <FeedSection />}`.

  What actually changed: the afternoon Metro was started with
  `EXPO_PUBLIC_DEV_TOKEN` in its environment, and `EXPO_PUBLIC_*` is inlined by
  Babel **at bundle time**. A later Metro started without it produced a bundle
  that sends no `Authorization` header at all. Evidence: the running Metro's
  environment had the variable absent (`ps eww`), anonymous `/api/feed` returns
  `401 {"error":"Missing access token"}` — the screen's exact message — and the
  afternoon token had *not* expired (12h TTL, minted ~15:20, checked at 00:00).

  Fixed by moving the credential off the bundle: sign in on-device via the
  **You** tab (dev builds only), token persisted in SecureStore.
- ~~**Stray test-fixture row in the dev catalog**~~ — **RESOLVED.** `Record 7 /
  Prolific mrwiup8e` was live in Explore's recently-added. Three causes, all
  fixed: `discography.test.ts` cleaned only two hardcoded MBIDs while the suite
  materializes any of 250 (now cleans by prefix); no backstop ran when a suite
  failed or was interrupted (now `tests/support/globalTeardown.ts`, which Vitest
  runs pass or fail, and which **fails the run** if anything synthetic survives);
  and suites delete users/lists with `prisma.deleteMany`, which never touches
  Elasticsearch — **1,070 orphaned documents** had accumulated, 999 of them
  users. The teardown now reconciles ES against Postgres too (CLAUDE.md §5).
  Detection lives in `scripts/lib/fixtures.ts`, shared by the teardown and the
  operator script so they cannot drift, and is unit-tested in both directions —
  it must catch every fixture shape and must never match real data.

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
| `heal-cover-https.ts` | Rewrite stored `http://` cover URLs to `https://` and re-index. `--dry-run` supported. No network calls — a pure scheme rewrite (see the covers open item) |
| `purge-test-fixtures.ts` | Remove synthetic test rows from Postgres **and** orphaned Elasticsearch docs (docs with no Postgres row). `--dry-run` supported. Detection is shared with the suite teardown via `scripts/lib/fixtures.ts` |
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
