# Soundlog — Progress

Execution state. `CLAUDE.md` holds the binding patterns (read it first);
`README.md` holds the build plan and v1.1 backlog. This file is the "where are
we, what's live, what's next" for a session starting cold.

**Repo:** https://github.com/blakewedding/soundlog · `main`
**Last updated:** 2026-08-07 — **Phase 6.2b is CLOSED**, all six steps deployed
and verified on production (settings page · reserved usernames · password and
email change · visibility across both stores · the Pro row · account deletion to
App Store 5.1.1(v)), plus 6.2c. The server housekeeping task is **done**: 18
updates applied, rebooted into kernel `6.8.0-136`, ~60s downtime, full chain
re-verified. Since then: social share cards (07-30), **6.2g — the warm sweep
no-op** (08-05, and its TTL-cliff recovery runs through ~08-10), brand v3 in the
nav, the genre canonicalization heals, and the **muted text tier going warm**
(08-07, section below). Next: **Phase 7**. Kickstarter launch **2026-08-11**.

## Status

# 🎉 SOUNDLOG IS LIVE AT https://soundlog.app

**Phase 6b is COMPLETE.** Phases 0 through 6b are done. The site is public,
served over TLS from a Hetzner VPS in Helsinki, with real users able to
register, verify an email address, and log music.

Suites green: **backend 274 + web 185 + mobile 38 = 497 tests**, all three
packages typecheck clean, `expo-doctor` 18/18.

**Day two (2026-07-25):** the first user-reported bug — rating clicks committed
nothing — was diagnosed, fixed, deployed and verified on production the same
session (its own section below). Web analytics moved from edge auto-injection
to a snippet in our own markup, verified serving and reporting.

**The launch was proven the only way that counts** — a full journey from a
phone on **cellular**, not LAN: registered, received and clicked a real
verification email, signed out and back in, seeded Burial's *Untrue* from
MusicBrainz, rated it 4.5, and posted the platform's first review. The
half-star fix from 5.5 held on real touch hardware: four gold stars and one
half, read off the glass.

**Launch state** (2026-07-24): 1 verified member, 12 releases, 3 artists,
9 labels, 12 ratings, 12 logs, 2 reviews. The database opened **empty** —
every throwaway account from verification was purged first, from both
Postgres and Elasticsearch, so the first durable account is a real one.

**Phase 6.1 is closed**, across five parts: the cover proxy itself, the
half-seeded release page it surfaced (6.1.1), the discovery retry cap (6.1.2), a
retry button that only looked like one (6.1.3), and the edge caching that hid
the fix from signed-out visitors (6.1.3b). Sections for each below.

**6.1.4 is done, deployed and verified on production** — cold-seed and
discography latency under browse load: priority tiers at the MusicBrainz gate, a
concurrency bound on the Cover Art Archive (the half the brief did not name, and
the one the report was actually about), and background pre-warming. Live at
`ba52e2e`, phone-checked by Blake. Section below.

**Two follow-ups carried out of it.** **Pre-warming ships DISABLED** and is
enabled tomorrow as its own step (see the deployment section). And **6.1.5** —
the `CoverImage` load-event race found during verification — is filed as the
next piece of work, below.

**Next: 6.1.5**, then **6.2** — Settings & Profiles,
before the Kickstarter launch. Phase 7
still carries the mobile app's missing surface (auth, release detail, write
actions), real icon design, and the navigation component the 380px three-row nav
is standing in for. Both are sequenced at the end of this file.

Hosting moved from GKE Autopilot to a Hetzner VPS on cost; the K8s manifests
remain the documented funded-migration path, not dead work.

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
| `fa0f7a1` | Phase 5.5 complete (one tracked open defect) |
| `b0cbf06` | Star input: render half-star fills (closes the last 5.5 defect) |

## RESOLVED — the last 5.5 defect: half-stars drew as whole stars on device

**Closed 2026-07-23.** The on-device readout answered it in one session, and the
answer was not where three rounds of work had been looking: **the mapping was
right, the rendering was wrong.**

### What the two drags settled

Read off the glass on the phone, both drags:

- `build` matched HEAD (`fa0f7a1`) — **stale bundle (candidate 1) dead.** The
  first thing checked, and the reason the stamp exists.
- `vv scale 1` — no zoom, layout and visual viewports agree; **visualViewport
  divergence (candidates 2 and 3, the leading suspects) dead.**
- `calc 2.5 / was 2.5`, `calc 4.5 / was 4.5` — the mapping computed the value
  under the thumb, React rendered that value, and the numeric readout printed
  it. Every candidate about coordinates, boxes, and event delivery died with
  those two lines. `lib/starGeometry.ts` was never touched — correctly.

What was actually wrong: at `2.5` the row drew **three whole gold stars**. The
value was right, the number beside it was right, and the community aggregate on
the same page rendered `★★½` correctly. The only surface that lied was the
interactive one, and "the preview is one half-star high" is exactly what a
correct value drawn as a whole star looks like to a user's eye.

### Cause

The half mask was anchored to the **cell** rather than the **glyph**. On the
desktop layout the cell shrink-wraps the glyph, so `clip-path: inset(0 0 0 50%)`
of the cell *was* half the star and the mask was correct. On touch the cell
flexes to 44–64px while the glyph stays ~0.6em, and the flexbox centres the
glyph inside it: measured on the release card, a **58.8px** cell holding an
**18.1px** glyph, with the mask clipped to everything past **x+29.4** — entirely
off the star. Nothing was drawn, so the star stayed fully gold.

This is the same shape of bug as `4cdf7c5` (the arithmetic mapping) and has the
same root: **the box is not the mark.** They are equal only on the desktop
layout, which is the one every browser verification had been run at.

### Fix

`.star-glyph` — an inline-block that shrink-wraps the glyph — now carries both
the star and the mask, so 50% means half the star at any cell width. The 0.05em
`.stars` used to contribute moves to the glyph's *margin*, outside the masked
box, so the cell keeps its exact previous width: desktop boxes measure
`116.2/15.6 …` before and after, i.e. **the pointer geometry is unchanged by
this fix**.

Each cell now exposes `data-fill="full|half|empty"`, and
`StarRatingInput.test.tsx` asserts the rendered fill at every half step at rest,
under hover preview, and mid-drag — plus that the half mark is nested inside the
glyph box, which is the invariant that broke. jsdom lays nothing out, so the
alignment itself is still browser-verified, not unit-tested.

**The law this leaves behind:** a committed value, an `aria-valuenow`, and a
numeric readout agreeing with each other is **not** evidence that the control
draws the right thing. Assert the mark.

### Instruments

- **Build stamp kept** (`components/ui/BuildStamp.tsx`) — dev-only, general
  purpose, and it is what killed candidate 1 for free. It stays for the next
  device session.
- **Star pointer readout removed** (`components/ui/StarDebugReadout.tsx`, and
  the `onDebugSample` sink it needed inside the component's pointer path). Its
  question is answered, and it was the only reason diagnostics code sat in a hot
  event handler. `data-fill` is the durable instrument now, and it is asserted
  in CI rather than read off the glass.

## 5.5 close-out — how each item landed

| Item | Outcome |
|---|---|
| Cover URL scheme | **Done.** Normalized at persist, catalog healed, 0 of 285 cleartext. Not device-verifiable as framed — mobile renders no images; verified on web + API payload. |
| Mobile-Safari star-drag ruling | **Done.** Ruled fiddly at 22px; boxes widened to ~29px per half-star on touch (`ad78ad7`). |
| Desktop taste calls | **Accepted as shipped** — wordmark rule threshold, the glyph's two optical cuts, lifted palette tokens, cover tint strength. Reversible; details under "judgement calls" below. |
| Haptic feel verification | **Moved to Phase 7** — blocked, not pending: no mobile screen fires an intent. |
| Native half-star ruling | **Moved to Phase 7** — needs a mobile release detail screen to host a star input. |
| Star half-star offset on device | **Done, closed 2026-07-23.** Not a geometry offset at all — the mapping was correct and the fill was drawn whole. See the resolved section above. |

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
| 5.5 | **Design polish — COMPLETE**, no open defects. Wordmark + placeholder icons, motion system, optimistic follow/list, cover tints + hover prefetch, 380/320px audit, accessibility floor, haptics map, touch star input, fixture-debris purge, real-device verification, half-star fill fix | `44ed01c` … `b0cbf06` |

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
- **The star BOX is not the star MARK, and nothing may be positioned as if it
  were.** The box is the hit target and flexes from 44px to 64px on touch; the
  glyph is ~0.6em and sits centred inside it. Anchoring the half mask to the
  cell put a 50% clip 29px from the cell's left edge, over an 18px glyph — off
  the star entirely, so every half rendered as a whole gold star while the value
  and the readout were correct. Both bugs in this list are the same mistake made
  twice: measuring the mark by the container. Anything that must line up with
  the glyph hangs off `.star-glyph`, which shrink-wraps it.
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
- [x] **Half-star FILL — fixed 2026-07-23, one device confirmation left.** The
  third round of this bug was not geometry at all: the value was right and the
  row drew whole stars (resolved section above). Fixed and verified in a real
  browser at 380px — the failing layout — and at desktop width, at rest, on
  hover, and mid-drag. What a phone would still add: the same read on real touch
  hardware. Look at the stars, not the number — the number was never wrong.
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

**Phase 6a is DONE** (below): the production stack boots and is proven
end-to-end locally. **The server is live** (its own section below). What remains
is **Phase 6b — the deploy**, sequenced at the end of this file.

*Superseded:* this previously read "K8s manifests, GitHub Actions, GKE
Autopilot". Hosting moved to a Hetzner VPS running the 6a compose artifact after
US-region managed pricing came back at $73/mo against a $9.59/mo VPS. The
manifests stay in `infrastructure/k8s` as the funded-migration path.

## Phase 6a — production stack, locally proven (DONE 2026-07-23)

The deliberately-unchecked README item — "full production compose stack boots
end-to-end" — is closed. `docker-compose.prod.yml` (its own project,
`soundlog-prod`, its own volumes) runs the cluster's shape: nginx serving the
built SPA and fronting Varnish, Varnish fronting the backend *container*, data
stores by service name, and a `migrate` job (`prisma migrate deploy`) gating the
API via `service_completed_successfully`.

**Proven over the public edge only** (nginx :8090, nothing else published), on a
**cold boot from empty volumes**, green in ~20s. The whole journey is a script,
`infrastructure/scripts/verify-prod-stack.sh`, so it stays a regression test:
health through nginx → Varnish → backend · register/login (HttpOnly refresh
cookie, `/api/auth` scoped) · search fan-out to live MB/Discogs from inside the
container · seed a release by MBID · rate 4.5 + review · second user follows,
sees the RATING and REVIEW in the feed · Varnish **HIT** on the anonymous
popular feed and forced **MISS** on the authenticated one · SPA shell no-cache,
hashed assets immutable, deep links fall back. ES `ensureIndices()` runs on the
backend's own boot (five indices on the cold start). MB throttle intact in-container
(4 concurrent searches serialise to ~3.8s). CAA timed out mid-cold-boot and the
cover **healed on retry** — CLAUDE.md §1 holding: a transient failure did not
corrupt the row.

**Four defects fixed, none of which any existing test could have caught** — they
live between the containers, where unit tests don't reach:

| Defect | Why it hid | Fix |
|---|---|---|
| Web image could never build | `npm install` on `apps/web` alone can't resolve `workspace:*` → `@soundlog/shared` | Rewrote `Dockerfile.web` workspace-aware from the repo root |
| nginx 400'd every **bodyless** mutation (follow/like/delete) | nginx speaks HTTP/1.0 upstream, sends no Content-Length for an empty body; Varnish rejects it. POSTs *with* a body (login, review) worked, so it hid | `proxy_http_version 1.1` + `Connection ""` |
| Web edge reported **unhealthy** while serving fine | healthcheck hit `localhost` → `::1`, but nginx binds IPv4 | healthcheck uses `127.0.0.1` |
| Migrations had no production path | schema applied ad-hoc in dev only | `migrate` target running `prisma migrate deploy`, gating the API |

**Cookie-origin policy resolved** (the Phase 6 pre-work wrinkle): `CLIENT_URL`
is THE APP ORIGIN — one origin serves SPA + `/api`, so the refresh cookie is
same-origin by construction. Dev moved `127.0.0.1` → `localhost` (browsers keep
per-host cookie jars; the app is browsed on localhost). OAuth provider callbacks
stay on `127.0.0.1` (Spotify requires a loopback IP) — safe, that leg sets no
cookie. The cookie's `Secure` flag now follows the served scheme, not `NODE_ENV`
(they disagree exactly where Safari drops a `Secure` cookie on local http prod).
Unit-tested in `backend/tests/unit/appOrigin.test.ts`.

Boot: `docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build`
— both flags load-bearing (interpolation reads `./.env` without `--env-file`;
`-f` suppresses the dev override). Full procedure in the README.

## Production server — live and verified (2026-07-24)

The 6a artifact now has somewhere to run. Provisioned and reached by hand; no
application is deployed to it yet, which is Phase 6b.

**`soundlog-prod` at Hetzner** — CX33 (4 vCPU / 8 GB / 80 GB, **x86_64**),
Helsinki, **Ubuntu 24.04 LTS**, $9.59/mo.

| | |
|---|---|
| IPv4 | *(origin address kept out of the repo; see the Hetzner dashboard)* |
| IPv6 | *(same; Hetzner assigns a `/64`, the host uses `::1` in it)* |
| SSH alias | `soundlog-prod` (`~/.ssh/config`, `600`) |

- **Firewall applied BEFORE first boot**, not after: Hetzner Cloud Firewall,
  **default-deny inbound**, only TCP **22 / 80 / 443** open, each rule
  documented in the dashboard (SSH / HTTP for the Let's Encrypt challenge and
  the redirect / HTTPS). Ordering matters — a box is exposed from the moment it
  has an address, not from the moment you get around to securing it.
- **Key-only SSH**: `id_soundlog_prod` (ed25519, `-a 100`, passphrased, held in
  the macOS keychain agent). The passphrase was set by Blake and has never been
  in a shell history, a command line, or this repo.
- **Handshake verified by hand**, not assumed: host fingerprint checked and
  accepted (TOFU, now pinned in `known_hosts`), root prompt reached, clean exit.
  `uname` confirms **x86_64**, which is what **validates the build-on-server
  plan** — the images are built on an arm64 Mac, so an arm-only host would have
  meant either cross-building or a registry. **7.6 Gi RAM free**, comfortably
  above what the six-container stack needs.

### Accounts and identity layer — complete

- **Resend** account created (`hello.soundlog@gmail.com`); API key minted and
  held **in the password manager only**. It goes into `.env.production` **on the
  server**, per CLAUDE.md §7 — never committed, never `scp`'d from a machine
  where it could land in shell history. It is deliberately not written here.
  *(Corrected in 6b: this repo is **private**, not public as this file and
  CLAUDE.md both previously asserted — an anonymous clone 404s, which is how it
  was found. Keeping secrets out of the repo is right either way, so the
  discipline stands; only the stated reason was wrong.)*
- **Identity inventory**: `soundlog.app` (Cloudflare, auto-renew) ·
  `hello.soundlog@gmail.com` (2FA'd, the recovery root for everything else) ·
  **@soundlogapp** on TikTok, Instagram, X, YouTube and Bluesky, bios written.
- **DPA** to conclude in the Hetzner dashboard when convenient.

### Decisions recorded

- **Hosting: a Hetzner VPS running the 6a-proven compose artifact.** US-region
  pricing was ruled out at **$73/mo** — that is the dashboard's real number, not
  the estimate the plan had assumed, and the gap is the whole reason for the
  change. Helsinki latency is accepted, mitigated by Cloudflare's US edge. **The
  K8s manifests are not abandoned** — they remain the documented migration path
  for when the project is funded.
- **Backups deliberately deferred to 6b step 6.** The server currently holds
  nothing, so a backup now would preserve an empty box; the Hetzner backup
  toggle gets enabled as part of one coherent strategy rather than as a reflex.
- **Ubuntu 24.04 LTS over 26.04** — production runs LTS.

## Open items
- **Intermittent cross-file test failures, surfaced (not caused) by 6.2f.**
  Observed 2026-07-30 while adding the `needsWarming` regression test: **2 of 6**
  full-suite runs failed, in files the change does not touch and with a *different*
  failure each time — `profileVisibility` (`/api/users/<name>` answering 500 where
  200 was expected) and a `review.create` / `listItem.create` pair. Not
  reproducible on demand; the same tree then ran clean three times consecutively,
  and the parent commit ran clean twice.

  **Most likely surfaced rather than introduced**, and this repo has the precedent
  in writing: `prewarm.test.ts` records that "adding two unrelated test files in
  6.2 changed the scheduling and it began failing deterministically". The new test
  adds ~5.5s and three more sweeps, which reshuffles a parallel suite sharing one
  database. Nothing in the change itself can reach `/api/users` — it is four Redis
  `TTL` reads and a set of cache-key builders that produce byte-identical strings.

  Worth ruling out properly rather than living with: the honest next step is to
  run the two suspect files in isolation under repetition, and if they are clean
  alone, look for the shared-state coupling the way 6.2a's `runTag` investigation
  did. **Not** to relax an assertion.
- **Give `cached()` single-flight, or hoist `lookupReleaseGroup` — required
  BEFORE any enrichment parallelisation.** Filed out of 6.2f (2026-07-30).
  `cached()` is a plain read-through with **no in-flight map**, unlike
  `ensureVariant` and `getDiscographyState`, which both keep one. `resolveArtistId`
  and `groupLevelReleaseDate` both call `lookupReleaseGroup(mbid)` on the same key.
  Serially that is one MusicBrainz call and a Redis hit; run concurrently — which
  is exactly what parallelising the enrichment stages would do — both miss and
  both take a gate slot, spending two slots on one resource and making the
  "faster" version slower. Fix either by hoisting that one lookup ahead of the
  fan-out, or by giving `cached()` a single-flight map (which would benefit every
  caller). **Parallelisation itself is worth ~40% off time-to-complete for a cold
  seed and nothing off the response**, so it ranks below the budget change that
  6.2f actually shipped.
- **Drop `await indexRelease(release)` from the seed response path.** Filed out of
  6.2f (2026-07-30). It sits between the skeleton write and the enrichment race in
  `persistRelease`. Its errors are already swallowed (§5) and Elasticsearch is
  eventually-consistent, so awaiting it makes the release searchable no sooner —
  it only delays the response. ~39ms of a warm seed's 52ms falls outside the timed
  stages, across two ES writes and two DB reads. Small, free, and §5-aligned;
  deliberately not bundled into the 6.2f commit, which was about one measured
  constant.
- **Prefix-capable artist search — pre-Phase-7 fast-follow.** Filed out of 6.2e
  (2026-07-30) because pre-warming **cannot** deliver "a stranger searches
  Radiohead and it is instant" on its own, and it is worth being precise about
  which half it does deliver.

  Three facts compose into the gap. Search is **as-you-type** on a 300ms debounce
  (`Search.tsx:34`); the default tab fires **both** `searchCatalog` and
  `searchArtists`, each of which fans out to MusicBrainz when local hits are below
  `THIN_RESULTS` (5); and `esSearchArtists` is a `multi_match … operator: "and"`
  over a **standard analyzer with no prefix support**, so "radioh" matches nothing
  locally and always fans out. Every keystroke-pause on an unwarmed string is
  therefore **2 MusicBrainz requests, gate-serialized**.

  The MB search cache is keyed on the exact lowercased query string and lives 7
  days, so pre-warming a canonical name makes the *final* keystroke instant. The
  prefixes typed on the way there stay cold. Net effect for a stranger: the artist
  page is fully fixed by warming, the search box is not.

  Two pieces, and **both are needed** — either alone is useless. An edge-ngram (or
  `search_as_you_type`) analyzer on the artist index so partial names match
  locally; *and* a fan-out trigger that is **quality-aware rather than a bare count
  of 5**, because a specific-artist search legitimately returns one excellent hit
  and would still fan out under the current rule.

  Deliberately NOT folded into 6.2e: it is a search-relevance change to a
  user-facing path, and it wants its own before/after rather than riding a
  cache-warming job. The index is rebuildable (§5), so the analyzer half is low
  risk; the threshold half is the one that needs judgement.
- ~~**Enable catalog pre-warming in production**~~ — **DONE 2026-07-27**,
  `PREWARM_INTERVAL_MINUTES=60`, backend recreated 05:20:48 UTC. Details in the
  6.1.5 section below, including the two things the procedure as filed got
  wrong about how the first cycle can be observed.
- **`/api/health` is cached for 60s, so it can report health it did not just
  verify.** Found 2026-07-27 while decomposing an UptimeRobot latency figure.
  The route is in Varnish's cache-safe list (`cache-policy.vcl`, `return (hash)`)
  but — unlike `releases`/`search`/`feed/popular` — is given **no explicit TTL**,
  so it falls through to `default_ttl=60`. It sends no `Cache-Control` of its own.
  Confirmed live: `X-Cache: HIT`, `X-Cache-Hits: 5` on the loopback edge.

  The consequence is a **≤60s window in which a monitor is told `ok` by a
  response that predates the failure** — Postgres, Redis or Elasticsearch can be
  down and the cached 200 keeps being served. A degraded run returns 503, which
  Varnish's builtin does not cache, so the lie is bounded rather than sticky; but
  bounded-and-trusted is exactly the failure mode §9 keeps re-learning ("a check
  that reports a working system as broken is worse than no check" — this is the
  same coin, inverted). A health check is the one endpoint whose whole value is
  that it was *just* evaluated.

  Fix is one line — `no-store` on the route, or an explicit `beresp.ttl = 0s` for
  `^/api/health` in `vcl_backend_response`. Deliberately NOT fixed inside 6.1.5:
  it is an edge-policy change to a monitored endpoint and wants its own before/
  after, not a ride-along on a client rendering fix.
- **A malformed upstream 200 body throws `TypeError`, not
  `UpstreamUnavailableError`.** `detail.title.trim()` / `detail.artistName.trim()`
  (`catalogService.ts:287`) assume fields that a 200 with an unexpected shape does
  not guarantee. Pre-warming catches and continues, so it is invisible there — it
  is visible in the prewarm test's logs, where fetch is stubbed to `{}`. An
  interactive seed would 500 instead of returning a §1 outcome. Low likelihood,
  cheap fix, but it is a §1 gap and should be closed deliberately.
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
*Reconciled in Phase 6a:* `CLIENT_URL` is now `http://localhost:3000` (was
`127.0.0.1`), so browse the app on `localhost` and the two agree. The provider
callbacks stay on `127.0.0.1` by design (Spotify requires it) — that leg sets no
cookie. Policy detail is in the Phase 6a section above.

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
Passwords are local-seed only and deliberately not written here. Ask the user, or
reset via the register endpoint. *(The old reason given — "this repo is public" —
was wrong; it is private. Credentials stay out of it regardless.)*

---

## Phase 6b — soundlog.app live (DONE 2026-07-24)

The 6a artifact is on the box and serving the public internet. What follows is
what the phase actually taught, not a replay of the runbook — the runbook is the
README's **Production operations** section.

### The prompt assumed a feature that did not exist

6b step 6 read "wire the backend's email service to Resend". There was no email
service: no mailer, no `RESEND_API_KEY`, no verification flow, no reset flow, no
`emailVerified` column. `authRouter` had register/login/refresh/logout/me/
exchange and the four OAuth legs, and nothing else. Step 9's proof — "receive
the verification email" — depended on all of it.

Built as part of 6b (`891fd00`):

- **One `VerificationToken` model with a `purpose` enum**, not two near-identical
  tables, so expiry / single-use / hashing have one implementation and one set of
  tests. Only the SHA-256 hash is stored — same discipline as `RefreshToken`, for
  a stronger reason: **a password-reset token IS a credential.**
- **`emailService`** wraps Resend under §1. A busy provider (5xx/429/timeout/
  dropped socket) throws `UpstreamUnavailableError`; a definitive rejection (bad
  address, unverified sending domain) returns `delivered: false`. Collapsing
  those is how *"your email is invalid"* gets shown to someone whose email is
  fine. Optional like Last.fm and Discogs, which is what let the stack deploy and
  prove itself **before** the sending domain finished DNS verification.
- **Sends never fail the write that triggered them.** A failed welcome mail has a
  resend button behind it; a failed registration is data loss.
- **Launch policy: unverified accounts are FULL accounts.** They can log in and
  see a dismissible reminder. Hard-blocking sign-in on verification means any
  wobble in delivery locks out every new user — including the first one — with no
  way back in.
- Security details worth keeping: `forgot-password` answers identically for known
  and unknown addresses **and the UI does not undo that**; OAuth-only accounts get
  no reset link (mailbox access could otherwise CREATE a password on them); a
  reset revokes every other refresh token; issuing a token consumes any
  outstanding one of the same purpose.

### Four things that were only visible in production

1. **The repo is private.** Both this file and CLAUDE.md asserted it was public —
   an anonymous clone 404s. Fixed by generating a **read-only deploy key on the
   server**, so the private half never left the box.
2. **Docker's iptables rules are evaluated before ufw's.** A normally-published
   port is reachable from the internet while `ufw status` shows it denied. The
   container edge binds to **`127.0.0.1:8090`** and host nginx terminates TLS in
   front of it.
3. **Docker's `json-file` log driver has no rotation at all.** Unbounded by
   default. Capped at 10 MB × 5 per container — and log options apply at
   container *creation*, so adopting them required `--force-recreate`.
4. **`compose run` uses the built image, not the working tree.** A maintenance
   script pulled into `/srv/soundlog` is invisible until the image is rebuilt —
   which also meant the fixture purge would have run *stale detection*.

### Two bugs found in my own work, both in the verification, not the thing

- **The backup script rejected every good dump.** It piped a custom-format
  archive into `pg_restore -l`, and those must be **seekable**. Since the check
  deletes on failure it would have destroyed a good backup nightly, silently. A
  verification step that reports a working thing as broken is worse than none.
- **certbot's generated nginx put the ACME challenge behind a server-level
  `return`**, which nginx evaluates *before* location matching — leaving renewal
  wholly dependent on the authenticator rewriting config at runtime. Rewritten as
  a location. The dry-run passes a real ACME exchange.

**And one bug that wasn't.** The verification link arrived looking broken —
`?token*…`, 62 characters instead of 64, and it failed to verify. Pulling the
**raw** message showed `token=3D…` with a full 64-char token: `=3D` is simply
quoted-printable for `=`, and the mail tooling was mis-decoding it. The product
was correct the whole time. *The lesson is 5.5's, restated: the instrument can be
the thing that is broken. Confirm against the raw artifact before believing a
reading.*

### TLS, and the policy that activated itself

`CLIENT_URL` flipping from `http://<origin-ip>` to `https://soundlog.app` was
the entire change. Before, the boot log carried
`[boot] CLIENT_URL is … production over plain http`; after, that line is gone and
a real registration returns `HttpOnly; Secure; SameSite=Lax`. **No code
changed** — the 6a `cookieSecure` design paid off exactly as written.

Cloudflare is **proxied (orange)** with SSL mode **Full (strict)**, set in that
order: proxy-before-cert gives a redirect loop, because Cloudflare would speak
HTTP to an origin that redirects to HTTPS. HSTS is `max-age=15552000;
includeSubDomains`, deliberately matching what helmet already sends — two
different max-ages from one origin is not belt-and-braces, since the browser
takes whichever it saw last. No `preload`: that is a one-way door.

### Mail authentication, verified against an independent receiver

Not asserted from the sending side, where it cannot be known:

```
dkim=pass  (1024-bit key) header.d=soundlog.app header.i=@soundlog.app
           header.a=rsa-sha256 header.s=resend
dmarc=pass (p=none dis=none) header.from=soundlog.app
Received-SPF: pass  envelope-from=@send.soundlog.app
```

Spam score 10/10; the Gmail copy landed in **INBOX**. SPF aligns under *relaxed*
(envelope on `send.soundlog.app`, `From:` on the apex) and DKIM aligns strictly —
both legs pass, which is what makes tightening DMARC later safe.

### Verification now cleans up after itself

`verify-prod-stack.sh` registers accounts and writes a rating and a review. On a
live site those are not neutral debris — they are members, visible in search.
Cleanup runs from an **EXIT trap**, so it happens on failure and on Ctrl-C too,
the same discipline `globalTeardown` exists for.

Detection was **not** reimplemented: `scripts/lib/fixtures.ts` gained user
detection keyed on an **RFC 2606 reserved email TLD** (`.test`/`.invalid`/
`.example`), which can never belong to a real person. Deliberately *not* a
username pattern — `prod_check_<ts>` is what the script happens to use today, but
a real member could pick that name, and **no username is ever proof of
anything**. Deleting a user cascades to their reviews, ratings, logs and lists.

That detection deletes user rows, so it is tested in both directions, including
that it does not match the dev seed accounts on `@demo.local`, the integration
suites' own `@*.local` accounts, or near-miss real domains like `test.com`,
`testing.io` and `latest.dev`.

### The cellular proof

Run by Blake on a real phone, on cellular:

| Step | Outcome |
|---|---|
| Register | Account created, reminder banner shown |
| Verify | Email received, link clicked, **banner cleared without a reload** |
| Sign out / sign in | Real login path exercised, not just the registration session |
| Seed *Untrue* | Materialised from MusicBrainz in ~1–2s |
| Rate 4.5 | **Four gold stars and one half — correct on device** |
| Review | Posted as the platform's first entry |
| Feed | Rating and review both present |

Two open Phase 5.5 items closed for free along the way: **no iOS focus-zoom** on
any input (the 16px field sizing works), and the **three-row 380px nav feels good
under a thumb** — so the disclosure-menu rework stays a Phase 7 nicety, not a
defect.

## RESOLVED — day-one production bug: rating clicks committed nothing

**Reported by Blake on launch morning (2026-07-25), fixed and deployed the same
session (`6b9812d`).** The first bug a real user hit, and it was the founding
feature.

**Symptom:** hover previewed correctly, a clean click committed nothing — no
request, no error, no console output. Any release, desktop, logged in.
Logout/login did not help.

**What the evidence ruled out, in order.** The nginx access log showed the
"failing" morning PUTs actually **arrived and returned 200**, and the database
had the rows — server, Varnish, TLS and Cloudflare all exonerated in two
commands. The user's request trail then showed the real shape: after a certain
point, clicks produced **no request at all**. A fresh account in a real browser
reproduced it instantly, and a capture-phase click listener produced the
verdict in one line: the click's target was the **row**, and the hit zone under
the cursor was not even in `composedPath()`.

**Root cause:** `onPointerDown` takes pointer capture (the drag path needs it),
and per the Pointer Events spec the follow-up `click` is dispatched to the
**capturing element**, not the element under the cursor. Current Chromium and
Safari implement that. The entire tap path lived in the zones' `onClick`, so a
plain click ran no code at all. It ever looked healthy only because touch drags
and press-drag mouse gestures commit on the row's own `pointerup` — the
founding journey rode that path, as did the morning ratings that "failed"
visibly but were in fact micro-drags that landed.

**Fix:** every pointer gesture — tap and drag — now commits in `endPress` on
`pointerup`, resolved through the same rendered-box geometry, so a tap and a
drag release on the same pixel cannot disagree. Zone `onClick` remains solely
for activations that arrive without a pointerdown (assistive tech). The
trailing click of a committed gesture is swallowed wherever the browser targets
it; the swallow flag arms only on an actual commit so it can never eat a later
activation. Taps do not inherit the drag's left-edge 0.5 clamp; secondary
buttons are ignored. Alongside, the §6 gap: the rating mutation rolled back on
error but showed nothing — it now shows "Rating didn't save" with a Retry.

**Flagged test-contract change:** the test "still treats a press without
movement as a tap" asserted the press committed nothing and deferred to the
zone click — *the broken contract itself*. Inverted, plus eight new tests that
dispatch the click sequences of both browser generations explicitly, since
jsdom models neither capture nor retargeting.

**The laws this leaves behind:**
- **A hit target that only a `click` event serves is dead under pointer
  capture.** If a control takes capture for drags, its taps must commit from
  `pointerup` too.
- **"No error anywhere" is itself a symptom class** — it distinguishes a dead
  handler from a failing one. A dead handler produces no network, no console,
  no rollback; only the server logs' *silence* shows it.
- **A green suite said nothing here.** jsdom fires `onClick` on children
  directly; it cannot see what browsers do to that event. Browser-contract
  behaviour must be encoded as explicit event sequences.

Verified live on production: a hover-confirmed clean click committed, the PUT
crossed Cloudflare → nginx → Varnish → backend as 200, the row persisted, and
a second click on the same star cleared it. Throwaway accounts purged from both
stores after; the users table holds exactly the real members. The full
workflow is documented in the README under **Debugging a production incident**.

## Web analytics — moved to a manual snippet (2026-07-25)

Cloudflare Web Analytics now ships in **our own markup** (`apps/web/index.html`);
edge auto-injection is **off** (radio set to Manual). Auto-injection made the
edge parse and rewrite every HTML response, and the one script we served was
invisible to anyone reading the repo.

**Verified through the edge with auto-injection disabled**, by parsing the HTML
a real visitor receives rather than eyeballing a grep: **exactly one** beacon
`<script>`, unversioned (i.e. ours, not injected), `defer`, classic script,
token parsing cleanly. In a live browser it is `renderBlockingStatus:
"non-blocking"` and it **fires its reporting request** to
`https://cloudflareinsights.com/cdn-cgi/rum` — which is the functional proof;
markup presence alone would not distinguish a working beacon from one that
loaded and silently reported nothing.

**The token is not a secret.** It is a public site identifier that Cloudflare
puts in the markup of every page it serves. §7 governs credentials; this is not
one.

Three ways this fails *silently*, all now commented at the call site:

- **The `data-cf-beacon` attribute must be single-quoted.** Its value is a JSON
  document. The first attempt routed it through Vite's `transformIndexHtml`
  `attrs` map, which serializes values with `JSON.stringify` — double-encoding
  it to `data-cf-beacon="{\"token\":\"…\"}"`. An HTML parser ends that attribute
  at the first inner quote, so the beacon loads, finds no token, and reports
  nothing while View Source looks roughly right. Caught by parsing the built
  shell with a real HTML parser and `json.loads`-ing the token.
- **`defer`, not `type="module"`.** Cloudflare's **dashboard** hands out a
  `type='module'` variant while their **documentation** specifies `defer` — they
  genuinely disagree, and the dashboard form is what you will see if you re-copy.
  `beacon.min.js` is a classic script; module loading would impose CORS-mode
  fetching and module scope on it for no benefit.
- **The `src` must stay unversioned.** Edge injection pins a `/v<hash>` build and
  rotates that hash; a pinned copy here would quietly serve a stale beacon.

**CSP: nothing needed changing, and there is no helmet entry to add.** `helmet()`
is mounted on the Express app, which serves only `/api/*`, and CSP is enforced
**per-document** — a CSP header on a JSON response governs nothing about the page
that fetched it. The SPA document is nginx-served with no CSP.

If a document CSP is ever added (worth doing), the beacon needs **two different
hostnames**, which is the trap: `script-src https://static.cloudflareinsights.com`
to fetch, and `connect-src https://cloudflareinsights.com` — no `static.` — to
report. Verified empirically from the browser, not from memory. Allowing only the
`static.` host would load the script and silently drop every measurement.

*Trade-off accepted:* the snippet lives in `index.html` rather than a build-only
Vite plugin, so the **dev server loads it too** and localhost page views reach
production analytics. The plugin form avoided that and is a one-line revert.

*Not measured:* LCP/CLS could not be measured from the automation browser — the
tab reports `visibility: "hidden"` with zero paint entries, and Chrome suppresses
LCP and paint timing for never-visible pages (which also makes a `CLS: 0` reading
trivially true rather than evidence). Structurally a `defer` classic script at the
end of `<body>` cannot block the parser or first paint, and a `<script>` generates
no box so it cannot shift layout. Real numbers will arrive on their own: the
beacon collects Core Web Vitals **field data from actual visitors**.

## Post-launch checklist

Dated items that cannot be done at launch because they need elapsed time, a
service that does not exist yet, or a dashboard visit. None blocks the site.

1. **DMARC `p=none` → `p=quarantine`** — after roughly **3–4 weeks of clean
   sending** (from 2026-07-24, so on or after ~2026-08-21). `p=none` is
   monitor-only: it publishes alignment results without acting on them, which is
   the correct posture for a domain that has never sent mail, because a
   misconfiguration under `quarantine` silently sends real verification mail to
   spam. Tighten only once real traffic has shown DKIM and SPF passing
   consistently. Consider adding `rua=mailto:` first so there are reports to
   judge "clean" by. Record at launch: SPF, DKIM and DMARC all verified passing
   against an independent receiver on day one (10/10, `dkim=pass`
   `header.d=soundlog.app`, `dmarc=pass`).

2. **Cloudflare Email Routing for inbound `hello@soundlog.app`** — required
   **before any public contact listing**. Outbound from that address already
   works (the Resend domain is verified), but nothing receives: a reply to a
   verification email currently bounces. Publishing a contact address that
   silently discards mail is worse than publishing none.

3. **Swap `MUSICBRAINZ_USER_AGENT` to `hello@soundlog.app`** — once (2) exists.
   It is currently the personal Gmail, deliberately: MusicBrainz requires a
   *reachable* contact (§7), and an address that bounces would be worse than a
   personal one that works. This is a one-line `.env.production` edit plus a
   backend recreate.

4. **Spotify and Google OAuth consoles — PENDING, deliberately deferred.** Both
   client IDs are blank in production, so the strategies never register and the
   routes answer 503 rather than crashing; email/password is unaffected. To
   enable, register these exact redirect URIs in the provider consoles AND fill
   the four values in `.env.production` — changing one without the other is a
   redirect-URI mismatch:

   | Provider | Redirect URI |
   |---|---|
   | Spotify | `https://soundlog.app/api/auth/spotify/callback` |
   | Google | `https://soundlog.app/api/auth/google/callback` |

   *Minor note for whoever does it:* an unconfigured provider answers **503**,
   which by §1's own logic reads as "retry-able" when it is in fact permanent
   until configured. Harmless today (nothing links to those routes while
   dormant), but 501 would be the honest code. Pre-existing Phase 1 behaviour,
   not introduced by 6b.

5. **Enable the Hetzner backup toggle** (server → Backups) and **conclude the
   DPA** in the Hetzner dashboard.

**Already done, not outstanding:** uptime monitoring is **live** — UptimeRobot
against `https://soundlog.app/api/health`, 5-minute interval, alerting to
Blake's personal email. Health traverses the whole chain (host nginx → container
nginx → Varnish → backend → all three stores), which is why it is the target
rather than `/`: the SPA shell is static files and would keep returning 200 with
Postgres on fire. Worth adding SSL-expiry notification on the same monitor —
renewal is automatic and proven, but if it ever silently stopped, an https check
fails only *after* expiry.
## Phase 6.1 — cover delivery (DONE 2026-07-25)

Covers loaded with a visible stutter, and Cloudflare Web Analytics had flagged
release pages yellow on LCP — where the cover is the largest element. The cause
turned out to be worse than "the Cover Art Archive is slow", and the measurement
is the whole story:

| the stored `coverUrl` for *Lost in the Dream* | 2,254,558 bytes · 2.35s TTFB · 2 redirects |
|---|---|
| painted into | a 140px grid tile |

We were shipping **multi-megabyte originals into thumbnails**, from a hostname
Cloudflare cannot cache for us, behind two redirects into an Internet Archive
node (`dn7109xx.ca.archive.org`).

### What shipped

**A cover proxy at `/covers/w<width>/<base64url(upstream)>.webp`.** The backend
fetches the upstream once, resizes with sharp, re-encodes to WebP, keeps the
rendition on disk and serves it `public, max-age=31536000, immutable`. §7's
browser-direct `<img>` exception is **closed** — including the discography's
un-seeded thumbnails, which were the last direct third-party image request.

**The URL encodes its upstream URL rather than hashing it.** That is what makes
the heal — and the rollback — a pure string transform with no network call, the
same discipline `coverUrl.ts` established: a script that verified each URL
against a flaky upstream would delete good artwork on a transient error. It also
means no mapping store exists to be lost.

**Three outcomes, never two.** 200 with the rendition (immutable, a year); 404
for a definitive absence (cacheable a *day*, because art gets uploaded later);
503 + `Retry-After` + `no-store` when we could not tell, with **nothing written
to disk**. An edge-cached 503 would turn one bad minute at the archive into a
day of blank tiles — §1 with a CDN behind it.

**Server-sampled tints, closing the 5.5 limitation.** The dominant colour is
sampled at seed time into `Release.coverColor`, so the FIRST paint of a cover
nobody has seen is already tinted — previously the tint only paid off on repeat
views, i.e. never on the view where the wait is longest. The colour is stored
RAW and muted client-side, so the palette decision keeps one home. **154 of 154
covers sampled, 154 distinct raw colours, 152 distinct after muting, luminance
spread 26.6 → 75.7** — the twelve-identical-greys failure is measurably absent.

**Disk discipline.** The cache is a named volume outside the backup strategy
(regenerable from `Release.coverUrl`, which `pg_dump` holds — same rule as
Elasticsearch under §5), bounded by `COVER_CACHE_MAX_BYTES` and swept
least-recently-used. Documented in the README's Backups section.

### Measured

Per rendition, against the same *In Rainbows* cover whose upstream JPEG is
70.8 KB / 500×500 (and whose stored large original was 1.8 MB):

| rendition | bytes | vs upstream |
|---|---|---|
| w96 (diary/chart row) | 2,188 | **33× smaller** |
| w200 (grid tile) | 8,118 | 8.9× |
| w400 (release hero) | 23,736 | 3.0× |

Through the full production edge locally (nginx → Varnish → backend):
**cold 2.03s, warm 6ms** (`X-Cover-Cache: HIT`). Origin-direct warm hits are
**2.2ms**. Varnish deliberately passes `/covers/` — its store is memory, and
renditions would evict the JSON it exists to cache.

### Two traps this phase walked into on purpose

- **nginx's SPA fallback.** Without its own `location /covers/`, `try_files`
  answers every cover with `index.html` — a **200 carrying HTML**, which renders
  as a broken image and reports as success. Verified: an unknown cover path
  through the real edge returns 404, not the shell.
- **Volume ownership.** Docker seeds a fresh named volume from the image's
  directory *including its ownership*, so the mount point is created and
  chowned in the Dockerfile before the volume attaches. Otherwise the non-root
  process gets a silent EACCES per cover on a stack that looks healthy.

### Deliberate test-contract change (§9)

`tests/integration/coverHttps.test.ts` asserted that the persisted cover URL
*is* the https upstream URL. Since covers persist in proxied form, two of its
three cases now assert the same guarantee **through the decode** — the stored
value must still resolve to the same artwork over https. The guarantee did not
move; where it is read did. The third case (no cleartext image URL anywhere in
the API payload) is untouched and still passes as written.

### Mobile

Unchanged and unaffected: `apps/mobile` renders no images at all. Phase 7's
screens inherit the proxied URLs for free, with one thing to remember — stored
URLs are **relative** (`/covers/…`), so a native client must resolve them
against its API origin.

## Phase 6.1.1 — the half-seeded release page (DONE 2026-07-26)

Reported from production on mobile Safari, hours after 6.1 shipped: a newly
opened release rendered with **no label, no genres and a grey cover tile**, and
stayed that way through scrolling, tapping, resizing and zooming. Rating the
album made everything appear.

### The diagnosis, which inverted the report

Rating was not fixing anything. `ratingMutation` calls
`invalidateQueries(["release", …])`, and that invalidation was **the only refetch
trigger anywhere on the page**. Everything else was already correct and already
arriving — the page simply never asked again.

Underneath: seeding writes a canonical skeleton and races enrichment against a
1,500ms budget (5.7). Production logs show that race is lost on **every** seed —
twelve consecutive `servedAs: "skeleton"`, Tunes 2011 to 2019 through Deadbeat.
The response carrying that skeleton was an ordinary 200 with nothing to
distinguish it from the finished record, so the client cached it and drew the
gaps as the truth. **A page rendering partial data indistinguishably from
complete data is the §6 silent failure**, and it is the second time this project
has shipped that shape.

Two contributors were 6.1's own:

- **`cover-tint` ran second and ate the budget.** Logs caught it burning
  **1,356ms of 1,500ms** while artist, label and genres queued behind a fetch
  and a sharp encode. It runs last now: a missing tint costs a flat tile, a
  missing label costs the page its content.
- **`enrichExisting` was awaited in the request path with no ceiling** — the
  reason a *revisit* through an `mb:` ref could be slower than a first visit.

### What shipped

`toReleaseDTO` reports `enrichment: pending | ready | failed`, tracked per
release id in `services/enrichmentState.ts`. **`failed` is terminal and real**:
a stage that throws is recorded, a hung enrichment is failed by watchdog at 90s,
and a later success clears it. Without it a broken stage would poll forever —
the same silent failure wearing a spinner.

The page polls while pending (800ms ×1.6, 6s cap, **60s budget**), then stops and
shows a retryable failure. A missing field draws a placeholder **only while
pending**; a field that genuinely does not exist stays absent, because those two
looking identical was the whole defect. Ref-keyed cache entries are no longer
retained and the URL canonicalizes to the resolved id, so a return visit cannot
be won by a stale skeleton.

### The tint, revised

The 5.5 mute compressed every cover into L 0.10–0.24. *Sky Blue Sky* samples
`#d2d2d2` — starlings on a white sky — and came out `rgb(55,55,55)` against an
empty tile of `rgb(28,28,33)`. On a phone those are the same dark grey, which is
why the tile read as broken. The band widens to **0.10–0.34**, saturation cap and
hue untouched.

This is the *opposite* of the twelve-identical-greys mistake, not a repeat: that
failure normalised **chroma** and discarded lightness; this restores lightness.
Measured over the catalog: **153/154 distinct** (was 152/154), luminance
**33–138** (was 27–76). Sky Blue Sky now sits **69 luminance points** above the
empty tile, and pure black does not move at all.

### Verified on production

| check | evidence |
|---|---|
| cold, never-viewed | `mb:e9f4b96a…` (Slint — *Spiderland*): `pending` at t+0, **`ready` at t+23s** with label *Touch and Go Records*, 5 genres, cover and tint `#717571` — **no interaction at all** |
| visibly loading between | spinner + "Still fetching details for this release…", shimmering tile, skeleton bar where the label lands (mobile viewport, screenshotted) |
| warm | 287ms TTFB, complete on the **first** response |
| `mb:` canonicalizes | `/release/mb:e9f4b96a…` → `/release/cms17uf3f0000yxt9nncnpbj2` in a real browser |
| pale tile | Sky Blue Sky renders `rgb(97,97,97)`, 69 points above the empty tile |

**§1 proved itself under real pressure during this verification.** The burst of
seeds got us **HTTP 429 from the Cover Art Archive**. The proxy retried three
times, raised `UpstreamUnavailableError`, the stage reported failed, and
*Wildflower* recovered to `ready` with its cover on a later pass — only its tint
column stayed null, which is the additive degradation by design. Nothing cached
a false "no art".

### Also fixed: the long-standing flaky backend test

Identified with measurements rather than guesses. `tabbedSearch.test.ts > the
'all' tab returns every bucket key` searches a nonsense token, which is the
**thin-results** condition that fans out to **live** MusicBrainz behind the
process-wide 1 req/s gate — inside a 5s default timeout. Measured **2,997ms on a
passing run**, file total ranging 516ms → 3,457ms, and timing out whenever the
machine was loaded. None of its four cases is about discovery, so the fan-out is
stubbed: **~480ms, stable**.

*Self-inflicted, found and fixed in the same session:* the new
`enrichmentVisibility` suite first cleaned up with `contains: RUN`, and every
suite derives `RUN` from `Date.now().toString(36)` — two files loading in the
same second share it. It deleted the discography suite's artist mid-run.
Teardowns scope to exact ids now. Cross-suite demolition is worse than debris:
the global teardown catches debris, and nothing catches this.

### Deliberate test-contract changes (§9)

Both are consequences of intended behaviour changes; neither is a relaxation.
`coverColor`'s white-sleeve ceiling is **re-derived** from the new band (61 →
112, still nowhere near white), and a new case pins that a pale sleeve reads
paler than an empty tile — the property the fix bought, so a future narrowing
cannot silently undo it.

## Phase 6.1.2 — discovery retry cap (DONE 2026-07-26)

§7 already said discovery gets one attempt and lookups retry. That rule was
written for metadata, and 6.1 routed image **bytes** through the same kind of
call without carrying it across.

The cost arrived unplanned, mid-verification: a burst of seeds earned us
**HTTP 429 from the Cover Art Archive**, and every 429 was then retried three
times. A discography grid builds `release-group/<mbid>/front-500` speculatively
for dozens of un-seeded entries at once, so the retry policy turned one bad
minute at the archive into a hundred requests that made it worse.

`isDiscoveryCoverUrl` splits the shapes: the release-group `front-*` redirect
(speculative, for something nobody has seeded) gets **one attempt**; a stored
`coverUrl` for a release we hold is a lookup and still retries three times.

The outcome is deliberately unchanged — still `UpstreamUnavailableError`, still
503 + `Retry-After` + `no-store`, **never a 404**. One attempt is a statement
about how hard we try, not a claim the artwork is absent; a 404 there would be
the §1 bug cached for a day.

## Phase 6.1.3 — "Try again" that actually retries (DONE 2026-07-26)

Reported from the phone check: **Movement (New Order) sat in `failed` and Try
again never recovered it.** Diagnosed by counting rather than reading:

| | |
|---|---|
| Requests for Movement in nginx's access log | **39** |
| Backend log lines for Movement | **2** — the seed, and one `stage covers failed` |

Every tap arrived. Exactly one enrichment run ever happened. `GET
/api/releases/<internal id>` is `prisma.release.findUnique` and nothing more, so
no amount of tapping could re-execute anything. **The retry button was
decoration.**

Not a data-shape problem — the early-New-Order reissue tangle was the obvious
suspect and was wrong. Movement's other stages all succeeded (Factory, five
genres, New Order, 1981‑11‑13). One stage hit a Cover Art Archive timeout.

**6.1.1 sharpened the gap it did not create.** Before canonicalization, arriving
through an `mb:` ref re-ran the heal as a side effect of seeding; canonicalizing
to the internal id removed that accident and left the missing trigger bare.

Fixes, all class-level:

- **`POST /api/releases/:id/refresh`** re-runs enrichment for a row we hold,
  through the same `seedFromSource` path an `mb:` ref takes. Rate-limited 60s per
  caller per release — a person is looking at this button, and the cost is a
  handful of calls, not a 250-group browse. A run already in flight reports
  `pending` without burning the slot.
- **`failed` is sticky.** It used to lapse to `ready` after five minutes on the
  theory that the next access would re-run the heal — wrong twice over: nothing
  re-ran it, and lapsing meant a release with a dead stage began reporting
  `ready` while its data was still missing. Movement was in exactly that state
  when it was reported.
- The client's retry is a **mutation**, and a refused retry (429) is shown.

### The lesson, recorded because it is the expensive one

**The test that covered this passed while the product was broken.** It drove the
retry through the `mb:` ref — a path that re-runs enrichment as a *side effect of
seeding*, and a path **no user takes once the URL is canonical**. It asserted
recovery against a code path the product had stopped using, and reported green
for a button that moved nothing.

A test has to exercise the route the client actually takes. Both the backend and
web cases now drive the retry by **internal id**, and a new case pins that a GET
by internal id makes **zero** upstream calls — the Movement bug, in one
assertion.

## Phase 6.1.3b — an in-progress release is not cacheable (DONE 2026-07-26)

Found by nearly reporting the 6.1.3 fix as broken. Six polls over thirty seconds
all showed a coverless Movement; Postgres had healed it the whole time. **Varnish
was serving a 60-second-old response.**

The release DTO began carrying a progress field in 6.1.1 — something that changes
every few seconds — while `cache-policy.vcl` sets `beresp.ttl = 60s` on
`^/api/(releases|search)` unconditionally. The page polls at 800ms–6s against a
minute-old snapshot, and its self-healing is disabled.

**Not for everyone, which is why the phone check missed it.** An authenticated
request carries `Authorization`, which Varnish passes; the affected class was
every **signed-out** visitor — the anonymous majority on a public site.

The backend now sends `Cache-Control: no-store` whenever `enrichment !== "ready"`,
and the VCL honours it with a hit-for-pass branch placed **before** the URL rules
that would otherwise override it. Ten seconds of hit-for-pass rather than the
customary two minutes: enrichment settles in seconds and normal caching should
resume as soon as it does.

**Verified signed-out, through the real edge**, on Talk Talk's *Laughing Stock*
(never seeded, no `Authorization` header anywhere in the test):

| | status | label | cover | `x-cache` | `age` | `cache-control` |
|---|---|---|---|---|---|---|
| t+0 | `pending` | — | no | MISS | 0 | **no-store** |
| t+3 | `pending` | — | no | MISS | 0 | **no-store** |
| **t+6** | **`ready`** | **Polydor** | **YES** | MISS | 0 | none |
| t+9 | ready | Polydor | YES | **HIT** | 3 | none |
| t+30 | ready | Polydor | YES | HIT | 27 | none |

Every anonymous poll fresh while pending; **self-completed in six seconds** with
no interaction and no session; caching resumed the instant it settled.

Movement passes on the phone, signed in and signed out.

### Two test-fixture bugs of my own, fixed in passing

Every non-primary mbid in the enrichment suite shared a title, so dedupe's
title+artist fallback merged the variants onto one row and later lookups by
musicbrainzId returned null — **the suite tripping over §3's own warning about
name-based identity**. And the stage being made artificially slow was the artist
lookup, which is cached after the first seed, so a later release enriched too
fast to ever observe `pending`; the label browse runs per release and is the
honest choke point.

## Phase 6.1.4 — cold-seed and discography latency (DONE 2026-07-26)

Filed from the phone check: *On the Corner* and *Get Up With It* were slow and
incomplete on cover detail while browsing Miles Davis' discography. Treated as a
database-wide behaviour under browse load, not as per-release defects.

### The brief named one gate. There were two.

The diagnosis pass ran before any change, so the after has a before.

**Gate 1 — MusicBrainz, strictly FIFO.** Miles Davis is **794 release-groups =
8 browse pages**, each ≥1.1s apart. A click landing mid-assembly queued behind
speculative work because nothing distinguished the two:

| interactive seed's MusicBrainz work | |
|---|---|
| idle gate | **2,294ms** |
| mid-assembly | **9,034ms** — 3.9× |

**Gate 2 — the Cover Art Archive, no gate at all.** This is the one the report
was actually about, and the brief did not name it: cover bytes never touch the
MusicBrainz gate (CAA is a separate host, explicitly exempt). A cold discography
put **792 tiles in the DOM and 37 simultaneous requests** on the archive, with
nothing bounding them — `coverCache`'s `inFlight` map is a **dedupe, not a
limiter**. Measured server-side, 37 tiles plus one interactive hero cover:

| gate | hero | tiles p50 | grid fill | **tile failures** |
|---|---|---|---|---|
| none (was) | 5,469ms | 3,098ms | 5.6s | **8 of 37** |
| 6 total / 2 reserved | 1,969ms | 7,101ms | 13.4s | 1 of 37 |
| **12 / 3 (shipped)** | **1,706ms** | 4,588ms | 7.3s | **0 of 37** |

**Eight of thirty-seven speculative tiles failed outright** — we were
manufacturing the upstream failure we then blamed upstream for. The 2,500ms
`getCoverArtUrls` timeout was tripping on congestion *we* created, failing the
covers stage and leaving releases reporting `failed` with no artwork. The
before-run's logs caught it verbatim: `stage covers failed: Cover Art Archive
unreachable … aborted due to timeout`, on *Get Up With It*, **with the
MusicBrainz gate completely idle**. Priority tiers alone would not have moved it.

6.1.2 capped discovery *retries* (volume per URL); it added no concurrency bound.
Ordering and concurrency were both still outstanding.

### What shipped

**`upstreamPriority.ts` — three tiers, `interactive` > `browse` > `background`.**
`browse` is its own tier rather than lumped with `background` because someone IS
watching the artist page's progress line — a discography must keep moving
whenever no click is outstanding.

Two mechanisms, one vocabulary: a **priority rate gate** (MusicBrainz, spacing
invariant unchanged) and a **priority concurrency gate** with capacity reserved
for interactive work (the archive). The reservation is the load-bearing part —
without it the hero cover of the release someone just opened queues behind a
screenful of speculative thumbnails.

**The gate selects at dispatch time, not when the slot opens.** Choosing before
waiting out the 1.1s gap would commit the slot to whoever happened to be queued
already, so a click arriving during that wait — the overwhelmingly likely case,
since waiting is most of the gate's life — would still lose a full slot. Found
while writing the test, not after.

**Tier travels by `AsyncLocalStorage`, not by parameter.** Enrichment reaches
upstream through eight-odd `catalogService` functions and then **detaches** from
the request that started it; a parameter would have to be re-passed by hand at
every hop and would not survive the detachment at all. Unset means `interactive`,
so forgetting to declare a tier is the harmless kind of wrong.

**Pre-warming (`prewarmService.ts`)** finishes releases we already hold, ordered
by rating then log count, at the `background` tier. Off by default
(`PREWARM_INTERVAL_MINUTES=0`) so no test, CI job or laptop makes unattended
upstream calls. It **never creates a row** — `discographyService`'s "nothing is
bulk-seeded" invariant stands, and a background job is not the place to overturn
a documented law. Attempts are remembered in Redis for a week, because some
releases genuinely have no label and no art and re-asking forever is what a
sweep with no memory converges on.

### The registry / Redis decision, made explicitly

**Stays in-memory.** The queue design does not imply a second API process — and a
second API process is *already* broken today, independent of this work: two
processes each honour 1 req/s and together make 2 req/s (a §7 violation), and
`enrichmentState` would report `ready` for a release the other process is still
filling in (the 6.1.1 bug, reintroduced by topology). Neither announces itself.

So the cheap half shipped instead: `config/singleInstance.ts` warns at boot when
the environment implies replicas, naming what has to move — a distributed token
bucket **and** a shared registry, together, since doing one without the other
trades a visible slowdown for a silent lie. New CLAUDE.md **§7a**.

### Verified through the real edge (Varnish :8080, signed out, cold)

| | first response | settled | result |
|---|---|---|---|
| Get Up With It, idle gate | 2,256ms `no-store` | **3,562ms** | ready · cover · tint · CBS/Sony · 5 genres |
| **On the Corner, mid-assembly** | 2,417ms `no-store` | **3,661ms** | ready · cover · tint · Columbia · 5 genres |

**The click mid-browse now costs what the idle click costs** — 3,661ms against
3,562ms, where before it was 9,034ms against 2,294ms. 6.1.3b's no-store-while-
pending is intact. Confirmed visually in a browser: *On the Corner* renders its
artwork, label, year and genres complete.

The browse pays for it, as intended: assembly measured 11.7s–23.1s across runs
(against ~13.6s before), the spread being upstream variance plus the slots it now
yields. Nobody is blocked on any single page of it.

**Suites: backend 290 (was 274) + web 185**, both packages typecheck clean.

### Found in passing, deliberately NOT fixed here

`CoverImage`'s fade-in has a load-event race: `.img-loading` sets `opacity: 0`
and is cleared only by React's `onLoad`, so an image that finishes decoding
before React attaches the handler stays **permanently invisible** behind the tint
tile. Caught live during verification — `{ complete: true, naturalWidth: 250,
opacity: "0" }`, a state only reachable by the missed event. Intermittent
(warm-cache dependent) and unrelated to latency, so it is filed rather than
folded into this commit. It is the same silent-failure shape as 6.1.1: a failed
or stuck image is indistinguishable from a slow one.

**Now filed as Phase 6.1.5**, below — and sequenced *before* 6.2, because it
reproduces the very cover symptom 6.1.4 set out to fix and would otherwise make
this phase's result unfalsifiable by eye.

### Instruments kept

`scratchpad` harnesses are gone, but two things stayed in the tree: `mbGateDepth()`
and the gates' `stats()`/`depth()`, which is what the tests assert against, and
the starvation warning in `PriorityRateGate` — strict priority *can* starve
`browse` under sustained clicks, and rather than build ageing for load this site
does not have, the wait is measured and logged the day it stops being
hypothetical.

### Deployed to production (2026-07-26)

`ba52e2e`, then `57aa514` for the verifier fix below. No Prisma migration — the
two new env vars both default safely, so `.env.production` needed no edit.

| | |
|---|---|
| Pre-deploy dump | `soundlog-20260726-183036Z.dump`, 72K, self-verified by `pg_restore -l` |
| `migrate` | exited **0** |
| Containers | all six healthy; only `backend` and `web` recreated |
| Running image | `upstreamPriority.ts` · `prewarmService.ts` · `singleInstance.ts` present; gate constants read back out of the container as **12 / 3** |
| Boot log | clean — including **two expected silences**: no `[prewarm]` line, no replica warning |

**Pre-warming is DISABLED in production** (`PREWARM_INTERVAL_MINUTES` unset → 0).
Deliberate: one change at a time on a live box, so the ordering and concurrency
work prove themselves on their own first. **Enable it tomorrow as its own step**
— a one-line `.env.production` edit plus a backend recreate, no rebuild — after a
day of normal traffic on this build.

*Phone check passed* (Blake), which is what closed the phase.

### The deploy gate had been lying for two days

The first verification run failed at step 5: `FAIL aggregate not 4.5`. **The
product was correct and the check was wrong.**

`verify-prod-stack.sh` rated *In Rainbows* 4.5 from a throwaway account and
asserted `avgRating == 4.5` — which is only true when that account is the
release's **only** rater. Blake rated it 5.0 on launch day, 2026-07-24, so the
aggregate was a perfectly correct **4.75** and the script called it a failure.
The write had landed exactly as intended: `myRating: 4.5`, `ratingCount: 2`,
review created.

**What made it more than cosmetic:** `fail()` calls `exit 1`, so steps **6, 7 and
8 never ran** — the follow/feed journey, the Varnish caching policy and the SPA
shell had been silently unverified on **every deploy since 24 July**. The bug
was not the wrong answer; it was that a wrong answer stopped the rest of the
chain and nobody noticed the chain had got shorter.

Fixed in `57aa514` as a **deliberate test-contract change (§9)**, and made
*stricter*, not looser. The aggregate is read before rating and the post-state
predicted from it:

```
expected = (a0 * n0 + 4.5) / (n0 + 1)
```

which pins the aggregation arithmetic for **any** number of pre-existing ratings,
where the old constant only worked for zero. `ratingCount` must advance by
exactly one — which also pins that posting a review carrying a rating *upserts*
rather than creating a second. `myRating == 4.5` is promoted to the primary
assertion: it is the only property that is ours alone, and therefore the only one
that actually proves the write landed. The pre-read carries its own cache-buster
so Varnish cannot hand it a stale aggregate and poison the prediction.

Re-run after the fix: **all eight steps green**, including the three that had
stopped running.

```
5 · myRating 4.5; aggregate 4.75 over 2 rating(s), exactly as predicted from the 1 before
6 · follows (bodyless POST survives the proxy) · feed carries both RATING and REVIEW
7 · anonymous popular feed HIT · authenticated MISS (per-viewer, never shared)
8 · shell no-cache, hashed assets immutable, deep links fall back
```

Cleanup left nothing behind: 2 throwaway users removed, **0 orphaned
Elasticsearch documents**, *In Rainbows* back to Blake's 5.0 alone.

**The law this leaves behind: an absolute assertion cannot survive a living
platform.** A verification that hard-codes a value it does not solely control
will eventually be falsified by the product working correctly — by a real member
doing a real thing. Assert what you control (`myRating`), and for anything shared,
**predict it from the pre-state instead of assuming you are the only actor.** The
same shape as the 6b backup script that rejected every good dump: a check that
reports a working system as broken is worse than no check, because it is trusted.
And a `fail()` that exits turns one stale assumption into a silently shortened
suite — which is how this went unnoticed for two days.

## Phase 6.1.5 — the CoverImage load-event race (DONE 2026-07-27)

**Filed from 6.1.4's verification, and reproducing the original cover symptom** —
which is why it is next rather than queued behind 6.2. A cover that never
appears looks exactly like the 6.1 latency bug this phase just fixed, so leaving
it in place makes the fix unfalsifiable by eye.

**The defect.** `CoverImage` fades in on load: `.img-loading` sets `opacity: 0`,
cleared only by React's `onLoad`. An image that finishes decoding **before React
attaches the handler** — a warm HTTP cache, a `/covers/` rendition already on
disk, a bfcache restore — never fires an `onLoad` React can see, so the element
stays **permanently invisible** behind its tint tile.

**Caught live**, not theorised: `{ complete: true, naturalWidth: 250,
opacity: "0" }`. A decoded, correctly-sized image rendered fully transparent —
a state reachable *only* by the missed event.

**The fix:** check `img.complete` on mount (via a ref) and clear the loading
state immediately when the image is already there, rather than waiting for an
event that has already happened. `onLoad` stays for the cold path.

**The regression test must drive the CACHED path**, which is the whole point —
the bug is invisible to any test whose image loads after mount, and jsdom fires
nothing on its own. Assert the rendered opacity/class for an image that reports
`complete: true` at mount time, the way 5.5's `data-fill` assertion pins the mark
rather than the value.

**Why it is 6.1.5 and not folded into 6.1.4:** it is a client rendering bug, not
a latency one; it is intermittent and warm-cache dependent; and it wants its own
before/after. It is the same silent-failure shape as 6.1.1 — **a stuck image is
indistinguishable from a slow one** — which is the third time that shape has cost
this project a phase.

### What shipped

`settle(img)` in `CoverImage.tsx` now holds everything that must happen once the
pixels are known, callable **without an event** — because on the cached path
there is no event to be called from. A `useLayoutEffect` keyed on the served src
asks `imgRef.current.complete` at mount and settles immediately when the image is
already there. `onLoad` is unchanged and still owns the cold path.

Two details that are load-bearing:

- **`useLayoutEffect`, not `useEffect`.** The class has to be gone before the
  browser paints; clearing it after paint is a visible flash of nothing, which is
  a smaller version of the bug being fixed.
- **`naturalWidth` is the real predicate, not `complete`.** `complete` is also
  true for an errored or empty src, so testing it alone would unhide the
  browser's broken-image glyph at full opacity. Non-zero `naturalWidth` is what
  actually means "pixels exist".

The ratio/letterbox check moved into `settle` with it. That was a second, quieter
half of the same defect: a cached **non-square** cover (gatefold scan, cassette
J-card) lost its letterboxing too, because that logic also lived only in the load
handler — so it was center-cropped into a smear *and* invisible.

### The regression test, and proving it is worth having

Four cases in `CoverImage.test.tsx`. The two that matter drive the **cached**
path — jsdom fires no load events on its own, so a test whose image loads after
mount passes against the broken component and proves nothing.

They assert the **class**, not computed opacity: the `opacity: 0` rule lives in
`theme.css`, which jsdom does not apply, so opacity reads `""` either way. Pinning
the mark rather than the value is 5.5's `data-fill` discipline.

**Falsified before being trusted.** Reverted the component, kept the new tests,
re-ran: **2 failed / 9 passed**, with exactly the right assertions failing —
`expected 'img-loading' not to contain 'img-loading'` and `expected '' to be
'contain'`. The other two (broken-image guard, cold path) pass either way by
design; they exist to catch the fix over-reaching, not to detect the bug.

### The live demo did NOT reproduce the bug, and that is reported, not hidden

§9 asks for a live demo of the pass condition. **The automated browser pane
cannot reproduce this race, so the fix's before/after was not demonstrated in a
real browser.** Stated plainly because the alternative is a verification that
reports success it did not observe — the 6.1.4 lesson, one phase old.

Two structural reasons, both established by measurement rather than assumed:

- Covers are `loading="lazy"`, and in that pane **no image begins loading until a
  paint is forced** (a screenshot). By then React has long since attached
  `onLoad`, so `complete` is never true at mount. Initial symptom was 12/12 covers
  at `complete: false, naturalWidth: 0` with a **0×0 viewport** — the pane had no
  viewport at all, so nothing was ever "in view". Sizing it to 1280×900 was
  necessary but not sufficient.
- CSS transitions **do not advance without compositor frames**. A mid-flight
  `opacity` reads `0` indefinitely.

That second one produced a **false positive I nearly reported as a reproduction**:
on the reverted build, an SPA remount over a warm cache measured
`stuckInvisible: 12`. It was not the bug — `img-loading` had already been
removed (`stillLoadingClass: 0`), meaning `onLoad` had fired correctly and the
transition was simply frozen at its start value. Forcing a paint resolved it to
**0 stuck / 12 visible**. The tell was that the class and the opacity disagreed;
had the run only measured opacity, it would have "confirmed" a bug that was not
there. **Measure the mechanism, not just the symptom** — a symptom has more than
one cause, and the environment is one of them.

What the live pass *does* establish, on the paths this environment can exercise:
cold load **12/12 decoded, 12/12 at opacity 1**, class cleared; SPA remount over a
warm cache **12/12 visible, 0 stuck, 1 correctly letterboxed** — `settle` working
end to end, and no regression to the path that already worked. The falsifiable
evidence for the fix itself is the test's before/after, plus the original live
capture on production (`{ complete: true, naturalWidth: 250, opacity: "0" }`).

### Pre-warming enabled in production (the item this phase was gated behind)

`PREWARM_INTERVAL_MINUTES=60`, backend recreated **05:20:48 UTC**. Boot logged
`[prewarm] catalog pre-warming every 60m`, with the replica warning correctly
silent. Pre-state measured first: **101 releases, 5 candidates** (3 missing a
cover, 4 missing a label, overlapping) and **0 Redis markers**.

The MusicBrainz UA contact was swapped to `hello@soundlog.app` **first and
separately**, with its own recreate, rather than riding this deploy — a first
pre-warm cycle under a simultaneously-changed UA conflates two changes. Verified
out of the running process, not off the disk file.

**Two things the filed procedure got wrong**, both worth recording because they
would have made the verification unfalsifiable:

- `startPrewarming` uses `setInterval` with **no leading call**, so the first
  sweep is 60 minutes *after* boot, not at boot. "Verify before anything else"
  was not achievable as written.
- The `[prewarm] warmed N release(s)` line is **conditional on
  `attempted.length`**. A healthy cycle with nothing left to warm logs *nothing*,
  so absence of the line does not distinguish success from failure. It was only
  verifiable at all because the pre-state check found 5 real candidates —
  checking that first is what made the log line a meaningful assertion instead of
  a hopeful one.

**First cycle, observed live at 06:20:48 UTC:**
`[prewarm] warmed 5 release(s), 0 already attempted` — exactly the predicted
number, no failures logged, 5 Redis markers set, all six containers healthy.

**And it healed nothing.** Candidates after the sweep: still 5, still 3 without a
cover and 4 without a label — byte-identical to the pre-state. Recorded because
`warmed N` reports **attempts, not outcomes**, and a cycle that fixes nothing
logs the same line as one that fixes everything. Checking the row counts either
side is what turns that line into evidence.

The outcome is legitimate rather than a defect, which the residue itself argues:
*Jeff Mills at Wire* (DJ set), *The Lonesome Crowded West Demos*, *Third Side of
the Moon*, *Great Divide*, and Aphex Twin's `[user48736353001]` — demos,
bootlegs and a SoundCloud alias, the exact profile MusicBrainz holds no art or
label for. Ordinary browsing already healed everything healable; the sweep
inherited the genuine upstream gaps. That is §1's "`null` is a real answer", and
it is the whole reason the attempt marker exists — without it these five would be
re-asked forever. They are now suppressed for seven days.

**What this does not yet prove:** that pre-warming makes a *first visit faster*,
which is the reason it exists. This cycle demonstrated the mechanism (selects,
claims, attempts, logs, bounds itself) against a population with nothing to give.
The value case needs a cycle that finds a genuinely healable row — most likely
after new releases are seeded by real browsing. Worth re-reading the log after a
day of traffic before shortening the interval.

## Then — Phase 6.2: Settings & Profiles (before the Kickstarter launch)

Positioned before Kickstarter because several items are launch prerequisites
rather than polish, and because **Phase 7's mobile app consumes this same API** —
anything missing here is missing on iOS.

**Profile customization** — display name, bio, links.

**Avatar uploads, reusing the covers pipeline.** The 6.1 work already built
exactly this machinery: validation, resize via sharp, a size-bounded disk cache,
and edge-cached delivery from our own origin. Avatars are the same problem with
user-supplied bytes, so they need the same treatment **plus** upload-side limits
— size and dimension caps enforced before sharp is handed anything.

**Security list for v1:**

- password change
- email change **with re-verification**
- profile visibility
- **full in-app account deletion to App Store Review 5.1.1(v) standard** —
  complete removal across Postgres *and* Elasticsearch. §5's
  `deleteReleaseEverywhere` is the precedent: a delete that leaves an orphaned
  search document is not a delete. This is a hard App Store requirement, not a
  nicety, and Phase 7 ships the client that will be reviewed against it.

**Plan groundwork, no billing code:** a `plan` field defaulting to `free`, and a
**"Soundlog Pro — coming soon"** row. Groundwork only — no payment integration in
this phase.

~~**Kickstarter / App Store prerequisites, gated on email routing.**~~ **DONE
2026-07-29** — the privacy policy is live at `/privacy` and the support contact
is linked from a site footer on every page. See the section below.

### Decisions taken before implementation (Blake, 2026-07-27)

Recorded ahead of any code so the implementation is not the place these get
argued out.

**1. Avatar storage is durable, NOT evictable.** 6.2 reuses the covers
*pipeline* — validation, sharp resize, rendition widths, delivery from our own
origin (§7) — but explicitly **not** `coverCache`'s eviction. The cover cache is
a size-bounded cache keyed by an upstream URL: anything it drops is re-fetchable
from the Cover Art Archive, which is what makes dropping safe. An avatar has no
upstream. Evicting one destroys the only copy, and the user experiences it as
the product losing their picture.

**2. Avatars are in the backup story, because they are not regenerable.** This
is the first non-regenerable bytes-on-disk this stack has held.
`backup-db.sh` is **Postgres only** (`pg_dump -Fc`), and `prod_covercache` is
deliberately excluded precisely because it *is* regenerable. Avatars cannot
inherit that exclusion by default — an avatar volume that nobody backs up is a
silent single point of data loss, and it would be discovered at restore time,
which is the worst moment to discover it. Either the volume joins the nightly
backup or the storage decision changes; the one thing not permitted is
inheriting the cover cache's treatment by accident.

**3. `Avatar` is its own component, sharing the rendition helper with
`CoverImage`.** §8 asks whether an existing component should gain a prop
instead, and the answer here is no: avatars are circular, have a
person-shaped fallback rather than a tint tile, and carry different alt-text
semantics. What they *do* share is the "never hand-build a proxied URL at a call
site" rule, so the size→rendition helper is common to both.

**4. Account deletion is a HARD DELETE for v1**, on the
`deleteReleaseEverywhere` precedent (§5): Postgres *and* Elasticsearch, or it is
not a delete. This is App Store 5.1.1(v), not a preference.

**Filed as a revisit trigger, not an open question:** anonymize-vs-orphan for
threaded replies. If, before Kickstarter, real conversations exist where a
deleted user's review or comment has replies under it, hard delete removes the
parent of a live thread. Revisit *at that point* — the trigger is the existence
of threaded replies, not a date. Deciding it now, against zero such threads,
would be designing for a hypothetical.

### 6.2a — DONE (2026-07-27): schema, avatar storage, backup, upload path

**Three of the six columns already existed.** `displayName`, `bio` and
`avatarUrl` shipped in the `init` migration on 2026-07-15 — read off the live
table, not off the schema file. More usefully: `avatarUrl` was **read everywhere
and written nowhere**, already threaded through `authService`'s session payload,
the profile response, the `publicUser` select in both `reviews.ts` and
`lists.ts`, `feedService` and `similarService`, carrying `null` since July. So
6.2a was a write path and a component, not a plumbing job. The one sharp edge:
`Profile.tsx` rendered a raw `<img src={p.avatarUrl}>`, harmless while the value
was always null and a §8 violation the moment it was not.

The migration is therefore `links` / `plan` / `profileVisibility` only
(`20260727143959_profile_links_plan_visibility`), all `NOT NULL DEFAULT`, which
on PG 11+ is a catalog-only change and does not rewrite the table.

**`profileVisibility` ships unenforced, deliberately and visibly.** The column
and the enum doc-comment both say so, and no UI writes it. Enforcement is 6.2b
alongside the security list, and has to cover every read in `users.ts`,
`feedService`, and the **user documents in Elasticsearch** — §5 means a hidden
profile is otherwise still answerable from the index. A toggle that renders
before that is a promise the product does not keep.

**Storage says "not a cache" in the path, not just in a comment.**
`/var/lib/soundlog/avatars`, not `/var/cache/...`; `.data/`, not `.cache/`; no
max-bytes companion and no sweeper. Under the FHS `/var/cache` may be deleted by
anything reclaiming space, which is exactly right for cover renditions and
exactly wrong for the only copy of a user's photograph. Two tiers: a durable
512px `master/`, and `w<width>/` renditions derived from it on demand — so the
non-regenerable bytes are one small directory, and adding a fifth width later is
a code change rather than a mass re-upload request.

The URL is `/avatars/w<width>/<userId>-<hash16>.webp`, hashed over the **original
uploaded bytes**. Not reversible like a cover URL — there is no upstream to
encode and no allowlist needed, because this route fetches nothing. What the hash
buys is the property that makes `immutable` honest: new picture, new URL, so a
year-long lifetime cannot serve someone their old face. Sharding is on the
**hash, not the user id** — cuid ids all begin with `c`, so id-sharding is one
directory wearing a sharded costume.

**The backup landed and was drilled before the upload endpoint existed.**
`backup-db.sh` is no longer Postgres-only. It archives `master/` and then does
the thing a `tar tzf` cannot: it asks Postgres how many users hold an avatar and
compares. An empty tarball verifies perfectly, which is precisely the
wrong-volume failure that would otherwise be found at restore time. Zero archived
against a non-zero database count is a **hard failure**; a smaller shortfall is a
warning (an upload landing mid-run is benign); zero against zero succeeds,
because a new stack is not a broken one. An avatar failure exits non-zero but
**keeps the database dump**, which by then is already written and verified.

All three paths were exercised against a scratch stack, plus archive → destroy →
restore → **checksums matched byte-for-byte**. The drill also found a real
portability trap: `verify_archive`'s fallback used GNU `stat -c%s`, and because
that check *deletes on failure*, on any non-GNU host it would have thrown away a
good backup every night. Production is Linux so it was never live, but it is the
one bug in that script that destroys backups.

**The gauntlet is ordered, and the order is the point.** Size at the transport
(`express.raw` limit) → magic-byte sniff → `limitInputPixels: 24M` → `metadata()`
for dimensions and frame count → only then pixels. Everything cheap runs before
sharp allocates. JPEG/PNG/WebP only: that allowlist is what rejects **SVG**,
which sharp would happily rasterize and which is a script and XXE vector wearing
an image's clothes. GIF excluded on purpose. Animated WebP rejected rather than
silently flattened to frame one. **No `withMetadata()`** — a privacy control, not
an encoding preference: a phone photo carries GPS, and re-serving it from our own
origin would be publishing a user's home address. Every rejection is a **400
naming the reason**; §1's 503 is for upstream uncertainty and there is no
upstream here.

Uploads are `PUT /api/me/avatar` with the image as the **raw body**, not
multipart — no fields are needed beyond the bytes, the path is derived from the
user id and the hash so a filename is something to throw away, and both web and
React Native speak it natively. `/api/me/*` is deliberately separate from
`/api/users/:username`: same rows, different contract.

`links` is a Json column, which is safe only because there is exactly one write
path through one zod schema (max 5, `https:` only — `javascript:` parses fine as
a URL and these render as anchors). Nine rejection cases are tested at the HTTP
boundary, including that a rejected write leaves the stored value untouched.

**Live demo:** a 1400×600 JPEG carrying 244 bytes of EXIF including GPS →
512×512 master, all four renditions square and correct, **EXIF stripped**, served
`immutable` with content-derived ETags, rendered circular at 96 CSS px fetching
the **w384 2x candidate** on a retina viewport, person-glyph fallback for users
without one, and `DELETE` removing every byte including derived renditions.

The first attempt at that demo **did not actually prove the EXIF strip** — the
generator wrote EXIF to a buffer and then re-encoded through a second sharp pass
that silently stripped it, so the upload had nothing to strip. Recorded because
the unit test was the only thing genuinely covering it, and a demo that agrees
with you for the wrong reason is worse than no demo.

**Test suites split into vitest projects.** Integration now runs single-fork,
sequentially; unit stays parallel. This was the **third** documented instance of
the shared-state-under-parallelism class (RUN-collision teardown, tabbedSearch,
and now `prewarm`'s `release.count()` reading a row seeded by
`discography.test.ts`). Confirmed pre-existing by stashing all 6.2 work and
reproducing the identical failure on `a4d8ae6`; adding two unrelated unit files
was enough to shuffle scheduling and surface it. Before: 2 red in 3 runs, a
different test each time. After: **5 consecutive green runs**. Wall clock
48s → 110s, accepted. `prewarm`'s assertion changed from a global count to a
direct watch on `release.create/createMany/upsert` — narrower (the enrich path
legitimately calls `update`) and strictly stronger (a create-then-delete balances
a count and is still a violation).

**And the split did NOT fix everything — a second, unrelated bug was hiding
behind it.** `catalog.test.ts` failed once more after five green single-fork
runs, which by the standing rule meant it was not parallelism and had to be
chased. It wasn't, and the mechanism is worth keeping:

Fixture titles end in `Date.now().toString(36)` (e.g. `ms3jrtg7`). The release
index uses an edge-ngram `autocomplete` analyzer whose search analyzer splits
letter/digit runs, so that tag tokenizes to **`["ms", "jrtg"]`** — meaning every
fixture created in the same era shares the leading `ms` token. Invisible to the
eighteen files that look their fixtures up by id; fatal to the **two that assert
on search**, because `searchCatalog` returns early once Elasticsearch already
holds `THIN_RESULTS` (5) matches and never fans out to the mocked MusicBrainz.
The test's own title is then simply absent, and it reads as a broken fan-out.

Reproduced deterministically by indexing six sibling-tagged documents: the
time-derived query returned **7 hits (fan-out skipped, test fails)** while an
alphabetic tag returned **1 (fan-out runs)**. Fixed with `tests/support/runTag.ts`
— letters only, so it analyzes to exactly one token with no shared prefix —
applied to the two search-asserting files. Four further full runs green.

Worth stating plainly: this survived the single-fork split *because it was never
a parallelism problem*. Sequential files still share one index. Parallelism made
more fixtures coexist and so made it likelier, which is exactly how one bug ends
up wearing another's clothes.

Final: backend **36 files / 362 tests**, web **27 / 213**, typecheck clean in
both, four consecutive green full runs.

#### Incident, 2026-07-27 — local dev data loss during 6.2a cleanup

Recorded because the mechanism generalises, and because the near-miss is the
interesting part.

Cleaning up one demo account created minutes earlier,
`deleteMany({ where: { email: { endsWith: "@demo.local" } } })` matched **three**
users, not one: the seeded dev accounts `demo_blake` and `sasha` used the same
email domain. The cascade took their owned rows — roughly 131 ratings, 147 logs
and 3 reviews, the product of real browsing.

**Unrecoverable.** No seed script exists, dev Postgres has no WAL archiving, and
`backup-db.sh` targets `/srv/soundlog` on the production host, so it has never
dumped a laptop. The accounts were recreated empty; the data stays lost.

**Production was never touched.** Every database command that session went to
`soundlog-postgres-1` (the local dev container) or the throwaway `soundlog-drill`
stack. `big_sigh` survived precisely because it uses a real email rather than
`@demo.local`. The backup drill used a scratch stack specifically so it could not
reach anything real.

**The catalog survived** — 167 releases, 66 artists, 106 labels. Only user-owned
rows cascaded, which is the difference between an annoyance and a re-seed.

The mechanism, which is now **CLAUDE.md §10**: the read-back discipline this
project already follows covered *file writes* and had never been extended to
*ad-hoc destructive queries*. Every config edit that session was read back; the
one statement that destroyed data was not. A `SELECT` with the identical filter
would have returned three rows where one was intended. The gap was not a missing
rule about databases — it was a rule about writes that nobody had applied to
deletes. It ran against dev, which is why it became a law rather than an outage.

### 6.2b — IN PROGRESS. Steps 1–2 done (2026-07-28)

**The phone check found the gap 6.2a left: there was no settings UI.** The
endpoints, the `Avatar` component and the rendition helper all shipped and
worked, and no route or form reached any of them. Verified by curl and by tests,
never by asking whether a person could do it.

**Step 1 — the settings page.** `/settings`, declared above `/:username` (the
catch-all that App.tsx already warns about for the email routes). Entry is an
**"Edit profile" button on your own profile**, not a nav link — the nav already
wraps to three rows at 380px, and a seventh link would worsen that on the exact
device this is tested on. `Profile.tsx` already computed `isMe`, and
`FollowButton` already returned null there, so the button is a pure addition.

The structural decision, because every later control inherits it: **one
scrolling page where each section is its own form, with its own submit, busy
state and error.** Not a page-wide Save. §6 wants every mutation to fail
visibly, and one Save across six controls cannot say *which* failed — a partial
failure leaves the page showing values that never persisted. Section order is
descending frequency, ascending consequence: Profile → Account → Privacy → Plan
→ Danger. Privacy's slot is reserved and renders nothing until enforcement
lands, so the layout does not shift under a user later.

Two things aimed squarely at the test device:

- **`accept="image/jpeg,image/png,image/webp"`, never `image/*`.** An iPhone
  photo library hands over HEIC when the input accepts anything; Safari
  transcodes to JPEG only when it sees concrete types. A wide accept turns
  "pick a photo" into a 400 on the most common device we have. No `capture`
  attribute, which would force the camera and remove the library.
- **HEIC is named in both the client guard and the server's rejection.** The
  server sniffs the ISO-BMFF `ftyp` brand, so an MP4 is not mistaken for a
  photo. "That file is not a JPEG, PNG or WebP" is true and useless to someone
  looking at a picture they can plainly see.

**Live demo at 375px** drove the real page: save → `Saved` and the nav updating
to the new display name (cross-surface propagation); an `http://` link →
`role="alert"` with a message naming https, the Saved badge cleared, and the
typed value kept so it can be fixed; corrected → persisted, confirmed by reading
the row back off the server rather than believing the UI; upload → circular,
centre-cropped, serving the **w384 candidate on a DPR-2 viewport**; HEIC →
refused client-side with no request made; remove → glyph fallback, label
reverted, **zero files on disk**.

**A bug the demo caught that tests would not have.** On a successful upload the
component kept showing the local `blob:` preview instead of the served
rendition. Not cosmetic: the stored master is centre-cropped square, so the
uploader would see an uncropped picture while everyone else saw the crop, and
they would only find out on somebody else's screen. Fixed by clearing and
revoking the preview once the real URL lands — and it is now the thing one of
the tests asserts.

**Step 2 — reserved usernames.** There was no reserved list at all: username
validation was length plus `[a-z0-9_]`. Because `/:username` is routed last as a
catch-all, **eight segments were already registerable as names whose owner would
have a permanently unreachable profile** — `diary`, `explore`,
`forgot-password`, `lists`, `login`, `reset-password`, `search`,
`verify-email`. None were taken on production (checked), so this closed a latent
hole rather than repairing a live one; `/settings` would have made nine.

The list lives in the **backend**, not `@soundlog/shared`, because shared is
deliberately not a backend dependency and this is a validation rule that has to
be enforced where accounts are created. The drift risk — someone adds a route
and forgets to reserve it — is covered by `App.reservedRoutes.test.ts`, which
reads both files from disk and fails **in the web package**, where the route was
added. It also asserts it found the routes at all, so a restructured App.tsx
cannot make it pass vacuously.

Also reserved: names we will plausibly route later (cheap now, impossible once
someone holds them) and names that should never be a person — `admin`,
`support`, `official`. That last group is not a routing problem: an account
called `support` messaging users is a phishing primitive.

Final: backend **37 files / 372 tests**, web **30 / 230**, typecheck clean.

#### Phone-check findings on steps 1–2, both fixed (2026-07-28)

**Links saved into a void.** The editor persisted them and showed them back, and
no surface rendered them — because the **public profile endpoint never returned
the field**. So it was missing in `users.ts`, in the shared `Profile` type *and*
on the page, not merely in `Profile.tsx`. A value that only ever returns to the
person who typed it has not been published, and the display surface was part of
step 1's definition of done.

**A real phone photo returned a bare `API error 413`** — three faults, none
covered by a test:

- The **container nginx had no `client_max_body_size`**, so nginx's 1m default
  refused the body two hops before Express. The API advertises 5 MB and the
  gauntlet answers oversize with a reason; neither is worth anything if a proxy
  overrules them first. Now `6m`, deliberately **above** the app's 5 MB, because
  only the app can say *why* while nginx can only emit a status. Host nginx was
  already 12m; Varnish was never involved (2 MB straight at Varnish → 401, i.e.
  it reached the app).
- Above 5 MB, **body-parser throws before any route runs**, and that fell
  through `errorHandler` to a generic **500**. §1's mistake in another costume:
  a definite, caller-fixable condition reported as an opaque server fault.
- The client printed `API error ${status}` whenever a response was not JSON —
  which is exactly what a proxy returns. A status code is not an error message.

The gauntlet's own size check moved 400 → 413 so one condition cannot answer
differently depending on how far the bytes got.

**Why 6.2a's live verification missed all of it: the edge check used a 30 KB
image.** That proves a happy path and nothing whatsoever about a ceiling. The
regression test is now sized at the real boundary — a 4 MB JPEG through the app,
and an oversize body asserted to be 413-with-reason and explicitly *not*
"internal server error". Verified through the full production chain afterwards
at **4,846,606 bytes → 200**.

**Cleanup also exposed a step-6 gap:** purging a test account left **5 orphaned
avatar files**. Deleting a user cascades their rows and removes nothing from
disk. Identified against the DB, confirmed unreferenced, removed by explicit
path (§10). `deleteAvatarFiles` already exists; account deletion just has to
call it — alongside the CDN purge, since one clears our disk and the other the
edge, and 5.1.1(v) needs both.

### 6.2b step 3 — Account: password and email (2026-07-28)

Both re-authenticate with the current password. The access token proves the
session authenticated in the last fifteen minutes, not that the owner is the one
holding the device — and these are precisely the two actions that would let
somebody else *keep* the account.

**Email changes do NOT take effect on request.** `email` is the login
identifier, so writing a new address immediately means one typo locks someone
out of their own account with nothing to sign in with and no mailbox to receive
a reset at. The new address is held in `pendingEmail` (new migration) and only
becomes the login address when the link sent **to it** is clicked. Until then
the old address still signs in, and an unconfirmed change simply expires. That
is what "with re-verification" has to mean when the address is the identifier.

`pendingEmail` is deliberately **not unique**: two people may hold the same
pending address, the first to confirm takes it, and the loser is refused at
confirmation where we can say so plainly. A unique constraint would instead fail
the *request*, leaking that the address is spoken for.

Two emails go out, and the second is the interesting one. The confirmation goes
to the **new** address — clicking it is the proof. A notice goes to the **old**
address **at request time, not on completion**: if someone else has taken the
account, the owner's only warning is a message where they still receive mail,
and by the time a hostile change completes the attacker holds the mailbox the
confirmation went to. That notice deliberately carries **no link** — a tripwire
with a button on it is one more thing to phish.

Both actions revoke every refresh token. A password change that leaves other
sessions minting access tokens is theatre; a completed email change is a change
of *who can get in*. The password path then issues a fresh pair so the person
who made the change is not signed out of the device they made it on — a security
control that punishes the people who use it is one they stop using.

Confirmation is unauthenticated by necessity (it is clicked from a mailbox,
often on another device) and re-checks the address at confirm time as well as at
request time.

**Live demo** drove the real page at 375px: wrong password → *"That password is
not correct."* on both forms; correct → pending state showing the old address
unchanged with a cancel affordance, DB confirming `email` untouched,
`pendingEmail` set and a live token at ~1h58m; cancel clearing both the column
and the outstanding token; password change → confirmation, new password signs
in, old one 401s, and this browser stays signed in.

**Running it caught a §8 violation the tests did not:** both forms had a field
labelled *"Current password"*, so two controls on one page shared an accessible
name — a screen reader user hears it twice with no way to tell which form they
are in. Relabelled.

Final: backend **39 files / 393 tests**, web **31 / 233**, typecheck clean.

### 6.2b step 4 — visibility enforcement, across both stores (2026-07-28)

**What PRIVATE means, decided and written down once** (`visibilityService.ts`):
you do not **broadcast**. Hidden — the profile page and every tab, presence in
member search, activity in other people's feeds, and reviews in the
popular-reviews discovery feed. **Not** hidden, and the settings copy says so in
as many words: a review still sits on the release page it was written about, and
a public list is still public.

The line is **discovery versus context**. A private account should not be
browsable or findable *as a person*; it does not retroactively unpublish things
someone deliberately posted onto shared pages where others have already replied
and liked. The field is named `profileVisibility`, not `accountPrivacy`, and
promising the second while shipping the first is the gap that only surfaces when
it matters.

**Elasticsearch DELETES the document rather than filtering it.** §5 makes the
index a second place the same fact lives, and the one most likely to answer a
question nobody remembered to guard. A query-time filter must be applied at
every call site forever; an absent document cannot be returned by any query
anyone writes later. Follows `indexList`, which already de-indexes a list the
moment it stops being public. Re-indexing runs on **every** profile write, not
only on a visibility change — `displayName` and `bio` in the document go stale
otherwise, which is the ordinary version of the same bug.

**One chokepoint, not nine checks.** Every read in `users.ts` goes through
`visibleUserByUsername`; nine call sites each remembering a rule is nine chances
to forget, and the one that forgets is the leak. In the feed, the filter is
applied to the **actor map** rather than per activity type — the loop already
drops an activity whose actor is missing, so one filter covers every type
including ones added later. `403`, not `404`: the username is already public
wherever this person posted, so pretending the account doesn't exist protects
nothing while making a private profile look like a typo.

Two bugs found while wiring it: `/ratings` and `/diary` had **no `optionalAuth`
at all**, so there was no viewer id — a private owner could not have seen their
own tabs. And popular reviews excludes private members *unconditionally* rather
than per-viewer, because that response is Varnish-cached for 5 minutes when
anonymous and a viewer-dependent result would make the shared cache entry a lie.

**The §5 bar, met against the live index rather than the code path.** Before:
document present, raw search returns 1 hit. After flipping to private through
the real API: `GET /users/_doc/<id>` → **404**, raw `multi_match` → **0 hits**,
and a `match_all` over the whole index (2 documents) does not contain the user.
Not filtered — absent. Reversible: back to public restores the document and the
profile.

**The tests were then checked for vacuity, which mattered.** `indexUser`
swallows ES failures by design (§5), so every "is it gone?" assertion passes for
the wrong reason on a dead index. Each now asserts presence *first*, in the same
test. Proven by **stopping Elasticsearch and re-running**: before the
preconditions, one test still passed; after, all five fail. The API-level member
search needed the same treatment for a sharper reason — search degrades to `[]`
when ES is down, so "not in the results" is exactly what an outage looks like.

**Live demo** at 375px: toggle flips, server agrees immediately (403 on the
public profile), owner still sees their own profile and all tabs, a signed-out
stranger gets **"This profile is private."** rather than "we couldn't find that
member", and every one of the nine endpoints returns 403 to strangers and 200 to
the owner.

Final: backend **40 files / 406 tests**, web **31 / 233**, typecheck clean.

#### 6.2b step 4 leak — a private member's reviews were public (2026-07-28)

**Found on the phone check, in production.** With the account private, its
reviews — full text — still appeared on the logged-out home page.

**Neither of the two suspected causes.** Not the Varnish shadow: the anonymous
cache holds `^/api/(releases|search|feed/popular|health)` and the leaking
endpoint matches none of them, so this was immediate and permanent rather than
TTL-bound. And not the activity feed: `Home.tsx` renders that behind
`{user && <FeedSection />}`, so it never appears logged out at all.

The actual surface was **`/api/reviews/recent`** — `RecentReviewsSection`, the
logged-out home page's review feed — which had no visibility filter of any kind.
Reproduced on production before touching anything: register, review, flip
private, and the canary text came straight back one second later.

**The audit that followed found a second one.** `getSimilarListeners` selected
members with no filter — "Listeners like you" actively suggests a private
account as somebody to go and follow, which is discovery in its purest form.

**The lesson is not "add two filters".** Step 4 enforced surface-by-surface from
a written checklist, and the checklist was not exhaustive — which is precisely
what `visibleUserByUsername`'s own comment warns about ("nine call sites each
remembering a rule is nine chances to forget it"). That chokepoint was built for
`users.ts` and never carried across service boundaries. There is now one
importable `discoverableUser` filter, and `visibilityDiscovery.test.ts`
enumerates every anonymous-readable surface and asserts against a **canary
string in the raw response body**, so a payload that nests a user somewhere new
is still caught. Confirmed to catch the real bug by reverting the fix and
watching it fail.

That file also pins the line in the **other** direction: the review must still
appear on the release page it was written about. PRIVATE means *do not
broadcast*, not *unpublish* — and an over-correction that silently retracts
writing other people have replied to would be caught as loudly as a leak.

**Deferred, filed:** settings as a first-class nav destination goes to Phase 7's
mobile nav redesign rather than being bolted on now. The profile-page entry
point stays.

### 6.2c — the American Football identity collapse (2026-07-28)

**Reported as** "the 1999 debut shows the 2014 album's cover". **The production
evidence inverts that**, and the inversion is the whole diagnosis.

The row stored `musicbrainzId = f98334d4…`, which is not a release id at all —
a release lookup on it returns nothing. It is the **release-group id of the 2016
self-titled album**. Its cover decodes (the proxied URL encodes its upstream,
§7) to CAA release `91e25eef…`, whose release-group is that same `f98334d4`. So
**art and identity agreed**; the `releaseDate` of 1999-09-14 belonged to
`8e40a68c…`, a different group. A chimera: 2016's identity wearing 1999's date.
By §3's own rule — identity is the MBID — the art was right and the date was
wrong.

MusicBrainz lists **four** distinct self-titled American Football albums (1999,
2016, 2019, 2026) with byte-identical titles and artist names. **Three** code
paths matched on those strings while ignoring MBIDs that already said the
records differed:

1. **`dedupeMerge`** — the title+artist tier fired even when both candidates
   carried MBIDs that disagreed, collapsing four albums into one whose fields
   came from whichever arrived first (`mergeInto` uses `??=`). That is how one
   album's year landed on another album's MBID.
2. **`findExistingRelease`** — fell through to a title+artist `findFirst` even
   when the candidate *had* an MBID. Clicking the 1999 album missed on id,
   name-matched the seeded 2016 row, and returned it as "the existing release";
   the caller then healed that row with 1999 data — and §4 permits a date to
   move *earlier*, so the wrong date was written by a rule doing exactly what it
   was designed to do. The same shape as the *Bodycage* / *Live At The Liquid
   Room* incident already in §3.
3. **`searchCatalog`'s seeded-key suppression** — once one self-titled album was
   seeded, every other one vanished from search *by name*. Not mis-linked:
   unfindable, with no way to seed the one you wanted.

**The unifying rule**, which §3 already states and `idsContradict` now encodes:
name matching is admissible only when **no id evidence contradicts it**. Two
candidates both carrying an MBID that disagree are different releases —
MusicBrainz has answered, and no string similarity outranks that. The fallback
keeps its real job: collapsing one release across sources that share no id.
Suppression now keys on MBID, resolved from Postgres rather than the search
index, which does not carry it (§5).

**Healing needed its own script.** `reenrichReleaseDates()` only moves dates
*earlier* — correct for reissue-pressing rows, useless here, where 1999 had to
become 2016. `audit-release-identity.ts` is dry-run by default and prints every
before → after.

**The audit found 12 disagreements, and they are two different findings.** Only
American Football was the identity bug (1999-09-14 → 2016-09-30, a different
album's date). The other **eleven were `YYYY-01-01 → YYYY-MM-DD` within the same
year** — rows seeded from a year-only source (a Discogs master year parses to
January 1) where MusicBrainz holds the precise day. Imprecision, not corruption;
healed in the same pass because they are corrections toward the same MBID truth,
and no displayed year changed.

**Verified through the real edge:** the row now reads 2016-09-30, agreeing with
both its MBID and its art, and a search for "American Football" returns **four
distinct self-titled albums** — 2016 (seeded), 2019, 1999 and 2026 — where
before the seeded row hid all the others. The 1999 debut is clickable again.

The regression test uses the **real MBIDs**, and was verified against the bug by
removing the guard: three albums collapse into one and the year lands on the
wrong MBID.

**One self-inflicted §7a moment worth recording:** a dropped SSH left an
orphaned audit running, and starting a second one meant two processes each
honouring the 1 req/s MusicBrainz gate and together making 2 req/s — precisely
the failure §7a describes. Both were killed before `--fix` ran. A long remote
sweep should be started detached once and polled, not re-launched.

Final: backend **42 files / 422 tests**, typecheck clean.

~~Still open in 6.2b: the Pro row and the `runTag` sweep.~~ **Both done — 6.2b is
closed.** See the close-out section below.

**Filed out of step 6, deliberately not done there:** the orphaned-`Activity`
sweep for `COMMENT` and `REVIEW` rows pointing at cascade-deleted targets. Step 6
clears the `FOLLOW` variant, which names a deleted person directly; the wider
sweep is a general cleanup that a deletion path should not be quietly performing
on everyone else's rows.

### 6.2b step 6 — account deletion, to App Store 5.1.1(v) (2026-07-28)

**The largest remaining 6.2b piece, and the survey moved its shape before any
code was written.** Five findings, two of which were latent bugs rather than
missing features.

**1. OAuth-only accounts could not have deleted themselves.** `reauthenticate`
answers **409** when `user.password` is null. Building deletion on step 3's
password re-auth — the obvious move, and the one the brief implied — would have
left every Spotify and Google member permanently unable to erase their account:
*precisely* what App Store review tests, on a sign-in path no local test walks.

The fix is that the deliberate act is **typing the username**, required of
everyone, with the password as an *additional* check wherever one exists. Nobody
gets a one-tap irreversible button and nobody gets locked out. `hasPassword` is
now on the own-profile payload solely so the form can ask for a password only
when there is one.

**2. `deindexUser` had no caller anywhere.** It existed and was reached only
*internally* by `indexUser` on a flip to PRIVATE.

**3. Cascade-deleted lists orphaned their Elasticsearch documents.**
`deindexList` is called only from the explicit list-delete route, so deleting a
User removed the `List` rows in Postgres and touched ES not at all. Every public
list a deleted member made would have stayed searchable — the same shape as the
1,070 orphaned documents 5.5 found.

**4. The Cloudflare purge is load-bearing, and that was measured rather than
assumed.** Avatars are served `public, max-age=31536000, immutable` on `.webp`,
which Cloudflare caches by default. Probing production's one live avatar:

```
w48  MISS → HIT      (cached by the probe itself)
w96  MISS → HIT
w192 HIT, age: 59345   ← 16.5 hours old, from the step-1 phone check
w384 HIT, age: 59345
```

Under a one-year lifetime. So deleting the row and unlinking the disk bytes does
**not** stop the edge serving a deleted member's photograph. Two further things
fell out of that measurement: any width is pullable by anyone who constructs the
URL (w48/w96 were cold until a probe asked), so the purge covers **all four**
rather than the ones the UI requests; and **avatar replace and remove already
deleted disk files while purging nothing**, so a member who changed their
picture twice left two prior faces at the edge. Fixed as a class — one
`purgeAvatar` path, three call sites.

**5. Varnish is not an avatar layer.** `cache-policy.vcl` PASSes `^/avatars/`,
so no VCL change was needed. The API TTLs it *does* hold (releases/search 60s,
`feed/popular` 300s) are bounded and self-expiring, and are enumerated rather
than purged.

**The ordering is the design.** The Postgres delete is irreversible and there is
nobody left to retry afterwards — the user cannot authenticate to try again. So
everything that can fail retryably is done, or **proven possible**, first:

```
preflight the purge credential  ─┐  fail here → nothing deleted, 503 +
de-index user + lists (strict)  ─┘  Retry-After, the user simply retries
──────────────────────────────────  the point of no return
delete from Postgres · deny the tokens · unlink the bytes · purge the edge
```

The purge runs *after* the row and bytes are gone, so the gap between purging
and deleting cannot re-cache the image being purged; the preflight is what makes
that ordering safe. Anything failing after the point of no return is **reported,
never swallowed** — a **502 carrying `accountDeleted: true`**, which says both
true things at once. `ApiError` now carries the parsed body so the client can
tell that 502 apart from a failure worth retrying.

**A deliberate §5 departure, flagged as §9 requires.** Everywhere else an ES
failure is swallowed because Postgres is truth and the index is rebuildable.
Deletion is the one caller for which that is exactly wrong: a surviving document
*is* the harm. `deindexUserStrict` / `deindexListStrict` throw, and they stop the
delete while it is still stoppable.

**The access-token window is closed with a Redis denylist** (Blake's ruling).
`requireAuth` was stateless JWT verification, so a deleted account kept working
for up to `JWT_ACCESS_TTL`. The TTL is derived by **signing a probe token and
reading its own claims** rather than re-parsing the `ms` string, so a second
parser cannot disagree with the first. It **fails open** — a Redis outage
reopens the window rather than signing out the whole site — and that limitation
is written at the top of the file rather than implied.

Making both guards async carried a trap worth naming: Express 4 catches a
*synchronous* throw out of middleware and does **not** catch a rejected promise,
so the moment these gained an `await`, every `throw` became a 401 that never
arrives and a request that hangs — the "no error anywhere" symptom class the
day-one rating bug taught us to distrust. Every path routes through `next(err)`,
and `next()` is called once, outside the try.

**Two bugs found in my own work, both by drills rather than by the happy path.**

- **The residue check for disk files could never have fired.**
  `deleteAvatarFiles` swallows every unlink error by design, so awaiting it
  proves nothing — a residue branch behind it reads as coverage while detecting
  nothing. Now `avatarFilesRemaining` **verifies** afterwards. "Unreachable
  because nobody can guess the name" is a fine argument for a replace and is not
  the claim 5.1.1(v) is about.
- **With Elasticsearch stopped, deletion answered `500 Internal server error`.**
  Blocking is correct there; the *shape* was §1's mistake in the 413 incident's
  costume — a definite, retryable, caller-actionable condition dressed as an
  opaque server fault. Now **503 + Retry-After** with nothing deleted, and the
  contract is pinned by a test.

**The anti-vacuity discipline, applied and then proven.** Every "is it gone?"
assertion is preceded *in the same test* by the assertion that the thing was
there first — because `indexUser` swallows failures, so absence checks pass for
the wrong reason on a dead index. Proven by **stopping Elasticsearch and
re-running**: 4 of 5 tests fail, and the first fails on its *presence*
precondition rather than its conclusion.

**Live demo** at 375px on the real page: the section renders folded shut (one
button, zero inputs — no irreversible field one mis-tap away); expanding shows
the username and password fields with **zero duplicate accessible names across
the whole page** (§8 — `Your password` is distinct from Account's
`Current password` and `Your password, to confirm it's you`); `DEMODEL5994`,
` demodel5994 ` and `demodel599` all leave the submit **disabled** and only the
exact string enables it; submitting returned **200** and landed on the
signed-out home. Verified after, against the stores rather than the UI: Postgres
user/review/rating/list/activity/refreshToken **all 0**, both the `users` and
`lists` documents **absent**, **zero** avatar files on disk, the denylist key
present and the pre-deletion access token **401**. The purge reported
`skipped-unconfigured` locally, which is the honest outcome with no token
configured and is never collapsed into `purged`.

*Reported rather than hidden:* the browser pane was hidden for this session, so
synthetic pointer input did not land and the form was driven through its real
React handlers via scripted submit. That exercises the component and the whole
network path; it does **not** re-prove hit-target geometry, which step 1 already
established for this page. The production pass below is the one that closes it
on real touch hardware.

#### Production pass — two throwaway accounts, every layer (2026-07-28)

Deployed at `dd572a0`; the purge credential was added on the box with `read -s`
so it never entered a shell history or this repo (§7), and the preflight was run
against the live token **before** any account was created — the check that turns
a wrong scope into a refusal rather than a half-finished delete.

Two accounts on `@soundlog.test` (RFC 2606, already recognised by
`scripts/lib/fixtures.ts`). **A reviewed an already-seeded release** —
*OK Computer* — so the exercise created **zero** catalog rows. A carried an
avatar, a review with a canary string, a rating, a log, a public list, a like and
a comment on B's review, follows in **both** directions, and an unconfirmed
email change with two live verification tokens. All four edge renditions were
warmed to `HIT` first, so the purge had something real to clear.

**A was deleted through the real UI on a phone.** The near-miss guard held on
touch hardware: the capital-D variant left the button disabled, and only the
exact username plus the password enabled it.

| Layer | Before | After |
|---|---|---|
| `User` | 1 | **0** |
| `VerificationToken` (from `pendingEmail`) | 2 | **0** |
| `Review` · `Rating` · `Log` · `List` | 1 each | **0** each |
| `ReviewLike` · `ReviewComment` (on B's review) | 1 each | **0** each |
| `Follow` A→ / →A | 1 / 1 | **0 / 0** |
| `Activity` by A | 6 | **0** |
| `Activity` → A in **B's** feed (`FOLLOW`) | 1 | **0** |
| `RefreshToken` | 1 | **0** |
| ES `users/_doc` | found | **found:false**, and absent from `match_all` |
| ES `lists/_doc` | found | **found:false**, and absent from `match_all` |
| Avatar files on disk | **5** (master + 4) | **0** |
| Cloudflare `w48` | HIT | **404 · MISS** |
| Cloudflare `w96` | HIT | **404 · MISS** |
| Cloudflare `w192` | HIT | **404 · MISS** |
| Cloudflare `w384` | HIT | **404 · MISS** |
| `/api/reviews/recent` canary | 1 hit | **0** |
| `/api/feed/popular` canary | 1 hit | **0** |
| `/api/users/<A>` | 200 | **404** |
| member search for A | — | **0 hits** |
| A's pre-deletion access token | 200 | **401** (denylist key present) |

B was then deleted through the API, and `purge-test-fixtures.ts --dry-run`
reported **0 fixture rows and 0 orphaned documents** across all five indices,
with the catalog back at its exact baseline: **109 releases, 31 artists, 2
users**.

**A third bug in my own work, found by the B deletion.** B had no avatar, and
the response reported `purge: "skipped-unconfigured"` — on a box where the
credential was present and working. Both values are honest about not having
purged, which is what stops a non-purge reading as a purge, but they say
different things about the *system*, and an operator reading "unconfigured" on a
correctly-configured host would go hunting a token that is not missing. Split
into `skipped-no-avatar` vs `skipped-unconfigured`, and pinned by a test.

*Not a defect, recorded so it is not re-investigated:* B's first delete returned
401 because its access token had aged past the 15-minute TTL during setup. A
fresh login deleted it cleanly.

**The carried caveat is closed (2026-07-28).** The production pass had exercised
the purge only through the *deletion* path; replace and remove were covered by
tests alone. Both are now verified on production, on a throwaway account rather
than a real one — identical code path, and no reason to replace a real member's
photograph with a generated test image to prove it:

| Step | Before | After |
|---|---|---|
| **Replace** — upload avatar 2 over avatar 1 | avatar 1: all four widths **HIT** | avatar 1: all four **404 · MISS** |
| **Remove** — `DELETE /api/me/avatar` | avatar 2: all four widths **HIT** | avatar 2: all four **404 · MISS**, response `purge: "purged"` |
| Disk, both hashes | 5 files each | **0** |

The `skipped-no-avatar` fix from the same session was confirmed live in passing:
deleting that account afterwards reported `skipped-no-avatar` rather than
`skipped-unconfigured`, on a box where the credential is present and working.

**Two items for the ledger from the phone pass:**

- **Login requires an email address, not a username.** Filed as a Phase 7 UX
  item: accept either. Someone who has just typed their *username* into a
  delete-confirmation field and then cannot sign in with it is being asked to
  hold two different identifiers for one account.
- **`@soundlog.test` addresses register and sign in normally through the real
  form**, which is what makes them usable as throwaway verification accounts:
  the reserved TLD never resolves, so no mail escapes, and the fixture purge
  already recognises them.

### 6.2b step 5 — the Soundlog Pro row (2026-07-28)

Groundwork, and deliberately nothing more: no upgrade button, no price, no
waitlist. Each of those is a promise with a date attached, and the honest form of
"not built yet" is a sentence rather than a control that does nothing when
tapped. The test asserts **zero** buttons, links, textboxes and checkboxes in the
section — so if billing ever arrives, that assertion is the thing someone has to
change on purpose rather than quietly outgrow.

`plan` is **read-only** here. Unlike `profileVisibility` — which the Privacy
section writes, and which was withheld through 6.2a precisely until enforcement
was real — there is nothing behind `PRO` to enforce yet. A control that could set
it would grant a tier the product does not implement: the same mistake as a
privacy toggle that hides nothing, with money attached.

With this the settings page is complete at all five sections, in the order fixed
up front — Profile, Account, Privacy, Plan, Danger. That order was chosen in step
1 so the layout would not shift under a returning user as sections landed, and
it held across five separate landings.

### 6.2b — the `runTag` sweep (2026-07-28)

All **eighteen** remaining integration fixture files moved off
`Date.now().toString(36)` to `runTag()`. The three `tests/unit` files that still
use a time-derived tag are **deliberately left**: the collision is an
Elasticsearch analyzer artifact, and unit tests never reach the index. The two
remaining mentions in integration files are comments describing the bug.

Also added: an explicit `username.length > 24` guard in the five fixture helpers
that concatenate a caller-supplied tag with `RUN`. `runTag()` is 12 letters where
the old tag was 8, and `p3_logcount_<RUN>` now lands at **exactly 24** — at the
cap with no headroom. Without the guard, one longer tag would fail as a 422 whose
only symptom is a `TypeError` on `res.body.user.id`. `suffixHeal` needs no guard:
it writes via `prisma.user.create`, which bypasses the zod cap entirely.

**Two things this turned up, both worth keeping.**

- **`tsc` does not typecheck the tests.** `backend/tsconfig.json` is
  `include: ["src"]`, so the whole `tests/` tree is outside it. This surfaced
  because a scripted edit inserted an import *inside* a multi-line import block
  in two files, and `npx tsc --noEmit` reported **clean** while those files were
  syntactically invalid — the failing vitest run is what caught it. So "typecheck
  green" in the §9 ritual has always meant *src only*, and the suite's own
  esbuild transform is what validates test syntax. Filed rather than fixed here:
  a `tsconfig.test.json` would close it properly, and doing that mid-close-out
  risks surfacing a pile of pre-existing test type errors.
- **A read-back that checks the wrong property proves nothing.** The sweep's
  read-back confirmed `const RUN = runTag()` was present and the import string
  existed — both true in the two broken files. It did not confirm the file still
  parsed. §10's discipline is about reading back *the thing that could be wrong*,
  and "the string I inserted is there" is not that. The suite was the real check.

### 6.2b — CLOSED (2026-07-28)

All six steps done, deployed and verified on production:

| Step | What |
|---|---|
| 1 | Settings page, avatar field, profile form |
| 2 | Reserved usernames |
| 3 | Password change + email change via `pendingEmail` |
| 4 | Profile visibility across Postgres **and** Elasticsearch (+ the discovery leak fix) |
| 5 | Soundlog Pro coming-soon row |
| 6 | Account deletion to App Store 5.1.1(v), across five stores |

Plus **6.2c**, the American Football identity collapse, which ran inside the
phase. Final: backend **43 files / 428 tests**, web **33 / 242**, typecheck clean
in both packages (with the caveat above about what backend typecheck covers).

#### Carried to the profiles slice — the remaining avatar surfaces

Named explicitly rather than left implicit, because the 6.2 work built the whole
avatar pipeline and then rendered it in **two places**. Avatars appear only on
the **profile header** and in **Settings**. Everywhere below, `avatarUrl` is
*already in the payload* and simply is not drawn — so these are client-side
additions, not API work:

- **`ReviewCard`** — the big one. Every review, on release pages, profile tabs
  and the home feed. Data present via `publicUser` in `reviews.ts`.
- **`CommentThread`** — comment authors, same select.
- **`FeedList`** — activity rows, both the actor and the `FOLLOW` target.
  Data present via `feedService`'s `publicUserSelect`.
- **Lists surfaces** — `Lists.tsx` / `ListDetail.tsx`, the list owner. Data
  present via `publicUser` in `lists.ts`.
- **Follower / following lists** — `FollowUser extends User`, and `users.ts`
  selects `publicUserSelect`, so the field is there.
- **`Nav`** — the signed-in user's own avatar; the session user carries it.

One surface genuinely needs backend work: **member search**. The Elasticsearch
user document holds `username`, `displayName` and `bio` only (§5 — the index is
deliberately thin), so search hits would need hydrating from Postgres rather than
a wider select.

**Mobile renders no images at all**, by design — there is no `<Image>` anywhere
in `apps/mobile`, which is why this is Phase 7 scope there rather than an
omission here.

#### Server housekeeping — DONE 2026-07-29

Executed as its own task, in the filed order: fresh dump → verify → 18 updates →
reboot → full-chain verification.

**The dump was verified the way the backup script's own bug taught.** A fresh
manual backup was taken rather than trusting the 03:17 nightly, and checked with
`pg_restore -l` against a **real file path inside the container, never a pipe** —
a custom-format archive must be seekable, and piping it is precisely what made
`verify_archive` reject every good dump in 6b. Result: byte-identical transfer
(80,474 bytes host and container), exit 0, **102 TOC entries**, and all **16
tables carrying data**. An empty archive passes a `tar tzf`; it does not pass
that. The avatar leg passed too — 1 master file of 1 expected.

**18 updates applied**, the 3 security ones being glibc (`libc6`, `libc-bin`,
`locales` → 2.39-0ubuntu8.8). `needrestart` restarted host nginx among others and
**deferred `docker.service`**, so no container was bounced before the reboot; the
site was confirmed 200 through the real edge in between.

**Rebooted into `6.8.0-136-generic`** from `6.8.0-117`, reboot-required cleared.

| | |
|---|---|
| Reboot issued | 04:21:27Z |
| Kernel boot | 04:21:44Z (**17s**) |
| All six containers started | 04:21:54Z |
| Full green through the edge | ~04:22:2xZ |
| **Actual origin downtime** | **~60 seconds** |

**The 2–4 minute estimate was wrong, and the reason is worth keeping.** All six
containers started **simultaneously at 04:21:54**, not in dependency order:
on a host reboot Docker's `restart: unless-stopped` policy starts everything at
once, and **`depends_on` + healthcheck gating does not apply** — that ordering is
a `compose up` behaviour only. Elasticsearch was therefore not waited on, which
is also why the backend logged `[boot] Elasticsearch unavailable — continuing`.

That line is §5 working exactly as designed rather than a fault, but it was
**verified rather than assumed**: search was exercised after boot and returns
releases, artists and members, with all five indices intact at counts matching
Postgres (109 releases, 31 artists, 58 labels, 2 users). The indices live on a
volume, so a boot-time ES gap cannot lose them — but "the health check says ok"
would not have proven the fan-out recovered.

**Post-boot verification, through the real chain and not loopback:**

- all six containers **auto-started** and healthy, no manual intervention
- `/api/health` **200** with `postgres`/`redis`/`elasticsearch` all `ok`, read
  through Cloudflare → nginx → Varnish → backend. Trustworthy here specifically
  *because* Varnish's cache is memory and started empty, so the known 60s
  health-cache open item cannot be masking a stale 200
- site shell **200** through the edge
- **an avatar and a cover both served** — checked through the edge *and* against
  the origin directly, since a Cloudflare HIT alone proves nothing about the
  origin. The cover was a CF **MISS**, i.e. it genuinely round-tripped to the
  origin and returned 200 with real bytes
- `[prewarm] catalog pre-warming every 60m` present in the boot log — timer
  restarted

**UptimeRobot could not be verified from here** and is Blake's to check: there is
no API key in the repo or on the box, and the monitor runs on a **5-minute
interval** against a **~60-second** outage. A window that short can fall entirely
between two checks, so *no recorded incident is the likely outcome and is not
evidence the site stayed up*.

#### The §9 typecheck gap, closed (2026-07-29)

`backend/tsconfig.json` is `include: ["src"]`, so `tsc -p tsconfig.json --noEmit`
— the command every phase has reported clean — never looked at `tests/`.

`backend/tsconfig.test.json` now covers `src`, `tests`, `scripts` and the vitest
configs, with `noEmit` and a widened `rootDir`. A separate file rather than a
wider `include` on the base config, because widening it would drag tests into
`rootDir` and emit them into `dist/`, shipping test code in the production image.
Wired up as `pnpm typecheck:all` alongside `pnpm typecheck`.

**It surfaced 6 pre-existing errors, all type-level friction in test harness
code. Zero in `src/` or `scripts/`** — so the production code was already clean
and the gap was genuinely only about tests. Triaged, not fixed:

| File | Error | Assessment |
|---|---|---|
| `authResilience.test.ts:26` | `MockInstance` variance on a `vi.spyOn` of the ES client | Harness typing. No runtime meaning. |
| `coverProxyRoute.test.ts:57` | `Buffer` not assignable to `BodyInit` | Node/undici types disagree; `Buffer` is valid at runtime. |
| `avatarService.test.ts:99` | `GPS` not in sharp's `Exif` type | **Worth a second look** — it is the EXIF-strip test. sharp accepts the key at runtime and the strip is separately proven live, so the assertion holds; the type is narrower than the API. |
| `emailService.test.ts:75,86,86` | casting `[]` to a `[string, RequestInit]` tuple | Assertions on mock call args. Harness typing. |

None indicate a product defect, which is why none were fixed tonight. The value
already banked is that the gap is now visible and runnable; the honest caveat is
that **`typecheck:all` is not yet green**, so it cannot join the §9 ritual as a
gate until those six are cleared.

#### Server housekeeping — as originally filed

Read off the box 2026-07-28, not estimated:

- **18 updates pending, 3 of them security.**
- **Restart required**, and it is a kernel bump specifically: running
  `6.8.0-117-generic` against an installed `6.8.0-136-generic`, plus
  `linux-base`. Up 4 days 22 hours.
- `unattended-upgrades` is **enabled**; disk is at **30%** (22G of 75G).

Deliberately its own task rather than a ride-along on a phase close-out, and the
reason is §7a: **the API is single-instance**, so a reboot is real downtime, not
a rolling restart. It wants a chosen quiet window, a database dump taken first
(the nightly runs at 03:17 UTC, so "since the last one" is up to 24 hours of
writes), and a post-boot check that all six containers came back and
`/api/health` answers through the full chain rather than just on the loopback.

### Privacy policy and site footer (2026-07-29)

The last Kickstarter / App Store prerequisite. `/privacy` serves the policy Blake
wrote, and a **site footer** — which did not previously exist — links it from
every page along with the support address. A policy nobody can find is not
published, and "discoverable" has to mean from anywhere rather than from the one
page that happens to link to it.

**A component rather than a fetched document.** Static prose with no data
dependency: no request, no loading state, no failure mode. More importantly it is
**versioned in git alongside the behaviour it describes** — every claim in it is
a claim about code in this repo, and a policy that can drift from the code
independently is a policy that will.

**The claims are load-bearing, and each one is true of shipped code.** Listed at
the top of `Privacy.tsx` with the file that implements each, so the next person
to change one of them finds out that the policy says something about it:

| Claim | Implementation |
|---|---|
| EXIF including GPS is stripped from uploads | `avatarService.ts` — the deliberate absence of `withMetadata()` |
| Private hides discovery, not contributions | `visibilityService.ts` — the field is `profileVisibility`, not `accountPrivacy` |
| Deletion clears Postgres, ES, disk and the CDN | `accountDeletionService.ts` (5.1.1(v)) |
| Avatar URLs are unguessable but **not access-controlled** | the avatars route authenticates nothing |
| Deleted data persists in backups up to 14 days | `backup-db.sh` retention |
| One cookie, cookieless analytics | the refresh cookie; Cloudflare Web Analytics |

Two of those are there because omitting them would have been the dishonest
option: the avatar URLs are genuinely readable by anyone holding the URL
regardless of visibility, and "deletion is immediate and complete" needs the
backup qualifier or it is not true for 14 days.

**The tests do not snapshot the prose.** A snapshot fails on every wording change
and asserts nothing about meaning. What is pinned is the small set of claims
above, the named processors, the effective date, the working contact address, and
that the Settings links exist — because the policy tells EEA readers that access,
correction and deletion are self-serve, and that stops being true the moment the
link does.

**`privacy` was already reserved**, speculatively, under "routes we are likely to
add" — which is precisely the case that section exists to produce: adding the
route cost nothing. Moved into "static routes that exist today". The
`App.reservedRoutes.test.ts` drift guard was **proven to cover it** by removing
the entry and watching the test fail naming `privacy`, rather than assumed from a
green run.

**Live demo at 375px:** all ten sections render, no horizontal overflow
(scrollWidth 375 = clientWidth), prose measure capped at 343px on mobile and
680px on desktop rather than the 960px container — 960px of running text is well
past a comfortable measure, and this is the only page in the app with paragraphs
long enough for that to matter. Contrast measured rather than eyeballed: body
prose **16.45:1** at 15px/1.65, footer links **5.53:1**, footer text **6.79:1**,
all clearing AA. Footer confirmed present with a working `/privacy` link on `/`,
`/explore`, `/search`, `/login` and `/privacy`.

Final: web **34 files / 247 tests**, backend **43 / 428**, typecheck clean in
both.

### 6.2d — the launch-prep performance investigation (2026-07-29)

Reported as a widespread production slowdown. **It was not a regression, and it
was not the server.** Five deploys and a reboot were all exonerated by
measurement before anything was changed.

**Ruled out, with numbers:**

| Suspected | Measured |
|---|---|
| Resource exhaustion | load **0.30** on 4 cores *mid-burst*, 5.6 Gi free, disk 33% |
| The reboot | zero container restarts, zero OOM kills, all six up since 04:21:54 |
| Elasticsearch | heap 51%, **zero** old-GC collections |
| The application | origin-local **1–7ms** on every endpoint including the profile |
| Cover cache thrash | 88 MB against a 1 GiB ceiling |
| The 974 cover 404s | every sampled one is a genuine upstream 404 — correct §1/§7 behaviour |
| Cover serving | 120 cached covers at 40 concurrent left the profile API at **5–7ms** |

**What the HARs actually showed.** Run B's profile API was **220ms with
`blocked` 0.0** — as fast as the control. The API was never slow. The symptom
was the *tiles*:

| Run B covers (1,647 requests) | `blocked` (client queue) | `wait` (server TTFB) |
|---|---|---|
| p50 | **15.6s** | **17.4s** |
| p90 | 46.3s | 20.3s |

**778 of them never left the browser** — `blocked` ≈49,000ms, `wait` 0, no
server IP, no HTTP version — queued client-side and abandoned on navigation.
Run C was worse: `blocked` p50 **29.3s**.

**The mechanism is request VOLUME saturating two independent queues.** Scrolling
a large discography emits ~1,600 cover requests to one origin; Firefox's H2
stream cap queues most of them, and the ones that land wait behind a correctly
bounded 12-wide CAA gate serving ~800 speculative discovery covers against a
degraded upstream. Opening the profile puts its tiles at the back of a
~1,600-deep client queue. This is the 6.1.4 class at a scale 6.1.4 never tested
— **it measured 37 tiles; this is 1,647**, 45×.

**The tier system is exonerated by its own new instrumentation.** The gate
warning added the same day (`a144640`) records **zero** interactive waits over
2s across all three runs. Priority is working; the gate is not the bottleneck.
Worth keeping: that instrumentation existed only because the *pre-existing*
warning covered the opposite direction, so "no warnings" had previously been
evidence of nothing at all.

**Anti-fixes, ruled explicitly:** CAA concurrency and the tier system stay
untouched. Raising concurrency moves the queue and re-earns the 6.1.1 429s.

#### Next: the cover-volume fix (not started)

1. **IntersectionObserver with a tight `rootMargin`**, replacing reliance on
   native `loading="lazy"` — which is present and working, but Firefox's eager
   viewport margin still fires hundreds in a dense grid.
2. **Hard-cap speculative discovery covers for un-seeded groups.**
   **Ruled by Blake:** a cap, *not* zero — a mostly-placeholder discography guts
   browsing, and the cap plus the observer together should kill the storm while
   keeping visible tiles rich. If the rerun shows the cap insufficient,
   tightening to zero is one constant.
3. **Paginate the discography.**

**Verification bar:** a rerun of the Run B protocol showing request count
collapsed from **~1,600 to double digits**, and the profile's tiles arriving
mid-storm.

Related but deliberately separate: the pre-warming scope-up would make major
artists warm and moot item 2 for them — a complement, not a substitute, since
pre-warming cannot fix a client-side queue.

### 6.2d — cover fix verified and closed (2026-07-30)

Blake's re-verification on the deployed revision (`index-CnlPo0ZY.js`): The Cure's
Singles row filled within ~1s when parked, the boundary gone, Compilations filling
on scroll with artless tiles correctly staying placeholder; Zappa's Show-all tail
got art; the profile arrived seamlessly mid-storm; logout instant.

**The split verdict is the diagnostic part.** Warm artists (Cure, Zappa — cached
from the day's runs) were fluid; a fully cold John Coltrane with a large
discography loaded everything but visibly lagged the scroll. So the residual
sluggishness is **concurrency × cold-fetch latency**, not the concurrency constant
alone — which is what makes pre-warming, not a bigger `MAX_IN_FLIGHT`, the right
next move. Raising `MAX_IN_FLIGHT` is **deferred until warming lands** and then
re-evaluated against a cold long-tail artist. Worth recording that it is *not* the
anti-fix ruled out above: that ruling was about the server-side 12-wide CAA gate;
`MAX_IN_FLIGHT` is the client's 6-slot LIFO window from `ac5d6dd`.

**LIFO fill order stays.** On slow scrolls the fill order is visible — in
Coltrane's Live section, early and late albums filled before the middle. Ruled
acceptable texture: LIFO is what makes the tile under the thumb win, and a
smoothing heuristic would compete with the visibility signal that just fixed the
storm. If it ever grates, the cheap version is ordering *within* the visible set
by document position while keeping LIFO *across* sets.

### 6.2e — artist pre-warming (IN PROGRESS 2026-07-30)

The anticipation half for artists we do **not** hold, and the decision
`prewarmService.ts` deferred in 6.1.4 ("whether to seed *popular un-seeded*
entries … belongs to a decision, not to a background job that quietly started
doing it"). Blake ruled: **hybrid** — a chart-derived mainstream spine plus a
curated long-tail drawn from the content catalogue, with the list as **data, not
code**, designed for a succession to user-aggregated measurement once real
engagement exists.

**The finding that made it cheap: warming creates nothing.** The deferral assumed
"pre-warm popular artists" meant "bulk-seed their releases" — overturning the
bulk-seed law and costing ~13 minutes of throttle per artist. It does not have to.
`discographyService` already renders un-seeded entries straight from MB data, and
`materializeArtistByMbid` reads `lookupArtist`, which is cached. So a fully warm
artist is four Redis keys plus disk renditions and **zero rows**:

| layer | key | makes instant |
|---|---|---|
| artist search | `mb:artist:search:<name>` | the search box's last keystroke |
| release search | `mb:rg:search:<name>` | the same query's album hits |
| artist lookup | `mb:artist:v2:<mbid>` | the click that materializes the row |
| discography | `mb:artist:discography:<mbid>` | the grid |
| covers | `caa:rg:urls:<mbid>` + w200 on disk | the tiles |

**Not pre-creating the Artist row is load-bearing, not laziness.**
`searchArtists` computes `releaseCount` as a live count for *seeded* artists, so
an Artist row with no releases returns **0**, and `Search.tsx:208` renders 0 as
`"0 releases"` — which its own comment calls a dead end — where `null` renders
"Not in the catalog yet — open to add". Materializing the list would convert every
invitation on it into a row that looks broken.

**Costed on a real sample**, the nine discographies in local Redis (Miles Davis
794 release-groups → 8 MB pages, Taylor Swift 421 → 5, Guns N' Roses 316 → 4,
Elliott Smith 124 → 2, Cocteau Twins 66 → 1, The Avalanches 41 → 1): mean **3.5
pages/artist**. Redis measured at ~165 B/release-group; w200 renditions at 8,118 B
(6.1's figure).

**Run mechanics — the 7-day TTL governs.** Every MB cache in
`musicbrainzService` is `WEEK`, so there is no one-off run: tonight's warming is
cold again in seven days. Rather than a weekly 30-minute cliff, the sweep
refreshes only what is within 26 hours of expiring (26, not 24, so a drifting
nightly timer cannot skip a target and leave it cold for an hour). With a 7-day
TTL that is naturally the expiring seventh per night. Warming is idempotent for
free — every layer goes through `cached()`, so a warm target costs Redis reads and
no upstream call — and the TTL selection exists to bound how much *real* work a
night may start, not to avoid harmless repetition.

Ruled out explicitly: **raising `PREWARM_BATCH_SIZE` cannot do this work.** That
sweep selects `Release` rows missing a cover or label and never touches an artist,
a discography or a search string. This is a sibling job, not a bigger dial.

**What shipped**

- `WarmTarget` table + `WarmTargetSource` enum (`CURATED | CHART | AGGREGATED`).
  `source` + `weight` are the succession seam: `warmService` reads `enabled`
  ordered by `weight` and never learns which produced a row, so replacing
  curation with measurement is a **new writer and no consumer change**. In
  Postgres rather than a file because a file in the image needs a deploy and a
  file on a volume is outside `backup-db.sh` (§5).
- `warmService.ts` — per-layer fault isolation, `background` tier throughout,
  Redis sweep lock, `lastWarmedAt` (attempt) kept separate from `lastResult`
  (outcome), which is 6.1.5's lesson about `warmed N` written into the schema.
- `coverPrefetchSet` exported from `discographyService` so the warmer warms
  **exactly** the set the discography page prefetches. Two copies of that rule
  would drift invisibly — the symptom would only ever be "warming didn't help".
- `scripts/warm-resolve.ts` (names → MBIDs, refuses to guess),
  `scripts/warm-targets.ts` (ingest, dry by default), `scripts/warm-run.ts`
  (watched foreground sweep, because `setInterval` has no leading call).
- `ttlOf` in `cache.ts`; `WARM_INTERVAL_MINUTES` / `WARM_BATCH_SIZE`, both off by
  default for `PREWARM_*`'s reason.

**Ingestion refuses ambiguity, by construction.** Resolution is a separate script
that writes nothing: a name resolves only when exactly one candidate matches after
normalization, and normalization decides whether to *ask*, never which candidate
to *pick*. Two survivors is a question for a human. MusicBrainz's `score` is
reported and never acted on — it ranks text similarity, which is precisely what §3
says is not identity. Burzum and Death in June are excluded from warming by
Blake's ruling: organic seeding stays possible, the catalog stays neutral, the
warming *list* is editorial.

**Blake's list is 489 names, not the ~290 its own header claims** — the sections
sum to 199 spine + 291 tail. Flagged rather than silently trimmed; Blake ruled
**keep all 489**, costs accepted (~3,200 MB requests ≈ 55 min for the cold pass,
~24 MB Redis, ~95 MB of cover renditions → ~18% of the 1 GiB ceiling).

#### The bug the resolution run found: a degraded discovery search was cached

Resolving 489 names against the real MusicBrainz surfaced a **§1 violation in the
discovery path**, and it is the expensive shape: a retryable condition turned into
a permanent answer, then cached so the retry never happened.

`searchMusicBrainzArtists` caught `UpstreamUnavailableError` **inside** the
`cached()` callback and returned `[]`. A returned value is a written value, so a
single transient 503 stored "no artist matches this query" **for seven days**.

Measured, not theorised: **18 of 489 names** were left holding `[]` with a full
week to live — including *The Beatles*, *Stevie Wonder*, *Kate Bush*, *Pavement*,
*Talking Heads*. At launch, with every artist cold, that is a search box that
silently stops finding an artist because MusicBrainz hiccuped once. It also made
this job actively harmful: the nightly sweep calls that function for all 489
names, so every bad MB night would have poisoned ~10 query strings for a week.

The fix is the placement of a `try` — outside `cached()` rather than inside, so a
throw prevents the write (§2's mechanism, the same one that keeps a partial
discography assembly out of the cache). §7's "one attempt, degrade to empty" is a
policy about how hard we **try**; degrading the *response* is right, persisting
the degradation is not — the same distinction §7 already draws for cover art
("the answer is still 503, never 404"). A genuine empty (a 200 with no artists)
still caches, because that is a real answer.

**A systematic sweep of all 23 `cached()` call sites found one more.**
`findReleaseGroupMbid` had the identical shape, and a sharper consequence: it
cached `null` on a 503, which **defeated the recovery its own comment promised**.
Seeding without an MBID is acceptable only because `enrichExisting` attaches it on
a later access — but that access called the same function, hit the cached `null`,
and attached nothing. The row stayed without the canonical identity §3 is built on
for a week. `getCoverArtUrls` (rethrows), both Last.fm sites and
`findSpotifyMatch` were already correct.

Both fixed, with `discoveryCaching.test.ts` covering four properties: a degraded
search is not cached, it recovers on the next call, a genuine empty IS still
cached, and the release-group match behaves the same. **The regression test was
verified against the pre-fix code** — 3 of 4 failed, and the one that passed was
"a genuine empty still caches", confirming the fix is surgical rather than a
blanket stop-caching.

Poisoned dev keys were purged by explicit list after a read-back of all 18 (§10),
and those names re-resolved cleanly: **0 no-match**. Final resolution: **339
resolved, 150 ambiguous, 0 no-match**, with the 150 bounced to Blake as 59
genuinely contested plus 91 clear-leader cases. **The production instance of this
bug is unfixed until this ships** — every user search that hits an MB 503 poisons
that query for seven days.

A method note worth keeping: the first count of degraded names was **11, and it
was wrong** — it was measured from a log file the command had piped through
`tail -30`, so it held only the run's last 30 lines. The real figure surfaced only
because "The Beatles returns no candidates" is obviously false. A count taken from
a truncated source reads exactly like a complete one.

#### Ingested — 490 targets (2026-07-30)

Blake's rulings on all 150 ambiguous names: Section A candidate 1 throughout
except **Bedhead** and **Love**, both → candidate 2; Section B accepted as
suggested; plus **Captain Beefheart & His Magic Band** warmed alongside the Person
entity, so neither is missed whichever one MusicBrainz hangs the release-groups
on. 489 names + 1 addition = **490 targets, 199 CHART / 291 CURATED, 490 distinct
MBIDs**, exclusions absent.

**The two exceptions are the report justifying itself.** Score ranked an impostor
first in both: `=LOVE`, a Japanese idol group (score 100), above Love the 1965 US
psych band (97); and `bedhead2001`, 2020s emo pop (100), above Bedhead the Dallas
slowcore band (97). Ingestion re-derives the report's ordering and **verifies the
two ruled MBIDs against the ones Blake quoted**, refusing to write if they
disagree — an off-by-one in the numbering would otherwise have warmed the impostor
silently, the exact failure the report existed to prevent.

**Two file-format bugs, both found by the ingestion refusing to look right.**

- Python's `csv` writes **CRLF**, so the header key became `mbid\r`, `row.mbid`
  was `undefined`, and all 150 overrides silently became empty strings. The run
  reported those names as *unresolved* — a parse bug that degrades to "nothing
  matched" is indistinguishable from a correct refusal, which is why it took a
  full pass to see.
- Python's `csv` also **quotes** any field containing a quote, and the naive
  split stored the artifacts as the name: `"Bonnie ""Prince"" Billy"` and
  `"Lee ""Scratch"" Perry"` reached the table. Not a crash, not a mismatch —
  simply wrong data that looks fine until an operator reads it. Both MBIDs were
  correct throughout; only the display name was corrupt.

`parseTsv` now strips `\r` and unwraps CSV quoting, and the two rows were repaired
by re-running ingestion — the dry run showed `0 to CREATE, 2 to UPDATE` with the
before/after of each, which is §10's read-back for an overwrite: identical filter,
exact rows, exact change. Verified afterwards: 0 rows carrying quote artifacts.

**Staged, not run.** `warm-run.ts --dry-run` reports **488 of 490 due**; the two
already warm are Cocteau Twins (156h TTL) and Miles Davis (85h), which is the
26-hour selection window working. The watched cold pass is Blake's to start.

#### The test poisoned 20 real artists, which is the §2 lesson from the other side

The first full suite run *after* ingestion failed one assertion — and the
assertion was the least of it. `warmOnce` sweeps the whole enabled list, the
fixtures carried `weight: 0`, and the ingested rows carry weights up to 1,000,000.
So the fixtures sorted **below all 490 real targets**, the batch of 5 selected
*The Beatles, The Rolling Stones, Led Zeppelin…*, and the stubbed `fetch` cached
**`[]` as their discography and `{}` as their artist lookup, for seven days**.

That is the poisoned-cache failure this very phase had just fixed in
`searchMusicBrainzArtists`, reintroduced from the test side within the hour. The
`{}` lookup is the worse half: `materializeArtistByMbid` reads `mb?.name`, so
The Beatles' artist page would have failed for a week.

**What did not break is worth as much as what did.** The `mb:artist:search` keys
were untouched, because the resolve run had already cached real answers and
`cached()` returns a hit without calling `fetch` at all. The cache defended
itself; the two layers that were cold did not.

Cleaned: 40 keys deleted by explicit list after reading all 40 back (20 `[]`,
20 `{}`), and the 20 rows' `lastWarmedAt`/`lastResult` reset — §10 throughout.

**The fix is structural, not arithmetic.** `warmOnce` takes an `only?: string[]`
of artist MBIDs, and every sweep in the test names its own fixtures, so the query
*cannot select* a row the caller did not name. Scoping by batch size would have
been a rule that has to be got right every time a test is added; this one cannot
be got wrong. The option is not a test-only seam either — `warm-run.ts --only
<mbid>` is the operator path for re-warming an artist whose layer failed, without
waiting behind the list.

Backstopped anyway: the test's `afterAll` **fails the run** if any non-fixture
`WarmTarget` has a `lastWarmedAt`, because the damage is otherwise silent — a real
artist with `[]` cached reads exactly like a real artist with no releases.

#### The first warm run, and the bellwether it disproved (2026-07-30)

**470 warmed, 20 already warm, 490 considered, 115m55s, zero failures** — and zero
rows carrying a `failed` `lastResult`, which is the independent check, since the
log reports attempts and only the column reports outcomes. **71,229
release-groups** cached, **7,609 cover renditions** on disk.

The 55-minute estimate was wrong: the spine is far deeper than the six-artist
sample used to cost it (mean **397** release-groups per artist against an
estimated 294, **4.5** MB pages against 3.5, deepest **2,141**). The rate improved
from 19s to ~14.8s per target as the run crossed from CHART into CURATED, exactly
as the spine/tail split predicts.

**The spot-check is what earned its keep.** Slint (tail) had all four layers warm.
The Beatles (spine) had a warm discography — 1,041 groups, 142h — and **both
search keys absent**, `lastWarmedAt` NULL, zero appearances in the run log.

`needsWarming` checked only the discography, on the stated ground that "every
layer is written in the same sweep, so they expire together — checking one is
checking all of them." That holds only while every layer was written *by* a sweep.
Two ordinary things break it: a layer invalidated on its own (the §1 cleanup
deleted `mb:artist:search:the beatles` hours earlier), and ordinary browsing,
which warms a DISCOGRAPHY without ever writing the search keys because nobody
searched that exact string.

**14 of the 20 skipped targets had cold search keys** — Radiohead, The Beatles,
Pink Floyd, Aphex Twin, Portishead, Burial. The optimisation was selecting
*against* the names it existed to serve, because being browsed is precisely what
warmed those discographies in the first place.

Worth recording: **the `--only` escape hatch could not fix it**, because `only`
narrows selection and `needsWarming` still gates afterwards. The operator path
built for exactly this case did not reach it.

Fixed by taking the **minimum TTL across all four keyed layers** rather than
flagging around it. Four `TTL` reads per target instead of one — under 2,000 Redis
reads a night. Cover renditions stay out: they are per-release-group on disk with
no single TTL, and `ensureVariant` re-checks the disk itself.

The cache keys are now built in **one place each** and exported
(`artistSearchCacheKey`, `releaseGroupSearchCacheKey`, `artistLookupCacheKey`,
beside the existing `discographyCacheKey`), because the sweep would otherwise
re-type them. The `v2` in the artist key is the standing proof of why: that key has
been versioned once already, and a hand-copied duplicate would not have moved with
it — it would silently have read a key nothing writes.

Regression test verified against the old logic: it fails with `expected [] to
include …`, the target skipped, and passes with the fix.

**The preview had the same bug, and it lied about the fix.** `warm-run.ts
--dry-run` re-implemented the selection rule inline rather than calling it, so
after `needsWarming` was corrected the dry run silently kept the old single-key
check and reported **2 targets due where the real sweep would take 61** — while
being the exact command an operator runs to decide whether to start a two-hour
job. It now calls `needsWarming` directly and honours `--only`. Same class as the
cache keys: a rule written down twice is a rule that gets fixed once.

**The re-run found 61, not the 14 predicted.** The extra 47 were targets warmed
during the first run whose *search* layer hit an MB 503 and — correctly, under the
§1 fix shipped hours earlier — cached nothing. The old bellwether saw a fresh
discography and hid every one of them. So the two fixes compose: not caching a
degraded answer is what leaves the hole, and checking every layer is what finds
it.

61 warmed in **7m58s**, 429 already warm, zero failures. Verified afterwards: The
Beatles (1,041 groups), Radiohead (583), Aphex Twin (119) and Slint (18) all carry
**all four layers**. Live through the edge, signed out: `radiohead` 722ms,
`the beatles` 605ms, `slint` 633ms, each returning 8/8/3 artists with the right
act on top.

The cover fix confirmed itself in the same log — `(attempt 1/1) — giving up`,
where the first run read `attempt 1/3 — retrying`.

A residue of 4 remains due, being targets whose layers degraded during *this* run.
That is the steady state working, not a defect: the nightly sweep collects them.

#### The §1 fixes deployed alone (2026-07-30, ~01:40)

Shipped on their own the same night, ahead of the warming work, because a live
seven-day search poisoning is not something to sleep on. Deployed **by SHA**
(`git checkout 0b72943`, the README's rollback form) rather than by pulling
`main`, so the warming migration stayed out of production.

> **Production is on a DETACHED HEAD at `0b72943`.** Tomorrow's deploy is
> `git checkout main && git pull --ff-only origin main`, not a bare `git pull`.

Verified out of the **running image**, not the disk file: `/app/dist/services/
musicbrainzService.js` shows `try` at 178, `cached()` inside at 182, `catch` at
187 — outside the callback. Six containers healthy, `verify-prod-stack.sh` exit 0
with 13 `ok` and no failures, and the boot log carried the correct *silence* — no
`[warm]` line, because that service is not in this commit.

**Production Redis carried 15 poisoned keys**, the organic equivalents of the 18
the resolver hit: 2 artist searches (`fiona apple`, `my bloody va`), 9
release-group searches, and 4 `mb:rg:match:*` nulls. Cleared by explicit list
after a read-back of all 15 under the identical list (§10) — 11 `[]`, 4 `null`,
none missing — then verified all 15 absent.

Two things the audit showed that are worth more than the cleanup:

- **`my bloody va` and `my bloo` / `my blood` / `my bloody` are real users' partial
  keystrokes**, each cached as its own key. That is the as-you-type prefix problem
  in the Open item above, observed in production rather than reasoned about.
- **All 4 `rg:match` nulls were blocking real rows.** *Live At The Liquid Room -
  Tokyo* (Jeff Mills), *Etta James Rocks The House*, *Archie, Marry Me* (Alvvays)
  and *Selected Ambient Works Volume II (Expanded Edition)* all still carry **no
  MBID** in the catalog, so the cached null was suppressing the very heal that
  would attach the canonical identity §3 is built on.

Deleting a legitimately-empty entry costs one re-fetch that re-caches the same
answer; leaving a poisoned one costs a week of wrong answers. That asymmetry is
why borderline keys (a test fixture, a prefix that may genuinely match nothing)
were cleared rather than adjudicated.

**Live demo:** `https://soundlog.app/api/search?q=fiona apple&tab=artists` now
returns **8 artists** — the seeded *Fiona Apple* plus cold MusicBrainz candidates
— where the poisoned key had reduced it to the single Elasticsearch hit with no
fan-out at all. The key re-cached with genuine data (TTL 604,763).

### 6.2f — the seed-path slack audit (2026-07-30)

The question: does the first-seed path carry recoverable latency **independent of
MusicBrainz gate physics**? Answer: yes, and it is one constant.

**Method.** Six production seeds captured before the container was recreated
(Pornography, Faith, Seventeen Seconds, The Head on the Door, A Love Supreme, The
Olatunji Concert), plus a controlled cold/warm pair run on dev against the real
MusicBrainz — seed *Spiderland* cold, delete the row via `deleteReleaseEverywhere`
(§5), re-seed with every upstream cache warm.

| Spiderland (Slint), dev, real upstreams | cold | warm |
|---|---|---|
| wall-clock response | **2.72s** | **0.071s** |
| `persistRelease` totalMs | 1,568 | 52 |
| `servedAs` | skeleton | enriched |
| stages completed | `persist.skeleton` **only** (12ms) | **all seven**, 13ms total |

#### Finding 1 — `ENRICH_BUDGET_MS` is ~115× oversized and buys nothing

The warm path completes every stage — covers 1ms, artist 3ms, label 2ms, genres
1ms, releaseDate 1ms, cover-tint 2ms — in **13ms**. The cold path spends the full
**1,500ms** and finishes nothing beyond the 12ms skeleton.

So the budget is simultaneously ~115× more than the warm path needs and hopeless
for the cold path, which needs 4–6s of gate-serialised calls. All six production
seeds pinned to 1,510–1,523ms and every one returned `skeleton`: **6 of 6 paid the
full budget and got nothing for it.**

A cold seed's 2.72s decomposes as ~1.15s (one MB gate slot inside
`lookupRelease`, before `persistRelease` starts) + 12ms of real work + **1,500ms
of waiting for an answer that was never going to arrive**. That 1.5s is 55% of the
response and is the recoverable latency the audit was looking for.

**Recommended: `ENRICH_BUDGET_MS` 1500 → 250.** Cold seeds drop from ~2.72s to
~1.25s (**-54%**) with 4.8× headroom over the measured warm response.

**The trade, stated rather than buried:** a *partially* warm seed — MB cached, CAA
cold, where `covers` measured 960–1,102ms in production — returns `enriched` today
and would newly return `skeleton`. That is not a content regression. The client
already polls `enrichmentState` (6.1.1) and the page fills a second later, instead
of the response blocking for 1.3s to deliver the same thing. Better for the
reader, and it is the machinery 6.1.1 exists to provide.

#### Finding 2 — the rest is gate physics, and is not ours

A cold seed makes up to five gated calls: `lookupRelease`, `lookupReleaseGroup`,
`lookupArtist`, `getReleaseGroupLabel`, `lookupLabel` — each ≥1.1s apart, a ~5.5s
floor. That is MusicBrainz's policy (§7), not a knob. **Pre-warming is the only
thing that removes it**, which is precisely why 6.2e is the complement to this
audit rather than an alternative to it.

#### Finding 3 — the stages are serial but independent (time-to-ready, not time-to-response)

`covers` / `artist` / `label` / `genres` / `releaseDate` are mutually independent;
only `cover-tint` depends on `covers`. Serial today ≈ 6–7s cold; parallelised ≈
max(MB chain 4.4s, covers+tint 2.4s, genres 0.3s) ≈ 4.4s, about **40% off
time-to-complete**. It does **not** speed up the response, which is budget-capped
either way — so it ranks below Finding 1.

**And it carries a trap.** `cached()` has **no in-flight dedupe**, unlike
`ensureVariant` and `getDiscographyState`, which both keep in-flight maps.
`resolveArtistId` and `groupLevelReleaseDate` both call `lookupReleaseGroup(mbid)`
on the same key; run concurrently they would both miss and both take a gate slot —
two slots for one resource, making a "parallel" version *slower*. Hoist that one
lookup ahead of the fan-out, or give `cached()` a single-flight map, before
parallelising anything.

#### Finding 4 — `await indexRelease(release)` sits on the response critical path

It runs between the skeleton write and the enrichment race. Its errors are already
swallowed (§5), and Elasticsearch is eventually-consistent, so awaiting it does not
make the release searchable any sooner — it only delays the response. ~39ms of the
warm path's 52ms falls outside the timed stages, across two ES writes and two DB
reads. Small, free, and §5-aligned.

#### Finding 5 — warming retries cover fetches three times (found in the live run)

`isDiscoveryCoverUrl` matches only `/release-group/<id>/front[-N]`, but
`getCoverArtUrls` returns CAA image URLs shaped `/release/<id>/<image>-500.jpg`.
So every cover the warm sweep fetches is classified as a **lookup** and retries
3×. Observed live: `[covers] HTTP 500 … (attempt 1/3) — retrying`, 6 times in the
first 55 targets.

For artwork attached to release-groups we hold no row for, §7's own reasoning says
one attempt. It is bounded at 12-concurrent so it is not a storm, but it spends
CAA capacity on artwork nobody has asked for yet.

**Fixed by the caller declaring intent, not by widening the URL rule.**
Broadening `isDiscoveryCoverUrl` to match `/release/…` would have been wrong in
the other direction: that is precisely the shape of a stored `coverUrl` for a
release we DO hold, where someone is looking at the page and retrying is correct.
The URL genuinely cannot separate the two cases — only the caller knows — so
`ensureVariant` takes `{ speculative }`, and the warm sweep sets it. Pinned by a
test asserting both halves in one place: the same `/release/…` URL retries as a
lookup and is tried exactly once as speculative.

**Landed after the first warm run finished, not mid-flight** — changing the
retry policy of a job while it is running would have split the run across two
behaviours and made its own log unreadable as evidence.

### 6.2g — the warm sweep was a no-op for six nights (2026-08-05)

Found during a routine pre-launch health pass, not by a symptom. Everything
reported healthy: six containers up, backups current, five nightly sweeps each
logging `0 with failures`, and **zero** targets carrying a `failed` `lastResult`.
The table said the job was working. It was not.

**`cached()` returns a hit without touching the expiry.** So `warmTarget`'s
layers — all plain `cached()` calls — read the cache and extended nothing. A
target selected *because* it was inside the 26-hour refresh window was "warmed"
and expired on its original schedule anyway. Only a genuinely ABSENT key was
ever re-fetched.

The measurement, six days after the cold pass:

| layer | absent | inside 26h window | healthy |
|---|---|---|---|
| discography | 2 | 477 | 11 |
| artist:v2 | 2 | 471 | 17 |
| search.artist | 0 | 473 | 17 |
| search.rg | 1 | 469 | 20 |
| **total** | **5** | **1,890** | **65** |

**1,890 of 1,960 layers inside the window at once**, and the only 65 with healthy
TTLs were the ones that had genuinely expired and so were genuinely re-fetched —
the mechanism confirming itself. A TTL histogram dated the cliff: **1,898 of
1,960 keys expiring in one 12-hour block on 08-06**, median 14:57 UTC. At
`WARM_BATCH_SIZE=100` that is a five-night recovery ending 08-10, the day before
the Kickstarter launch.

Two causes compound. The fleet was written in a single 4-hour pass on 07-30, so
it was born synchronized; and because a warm hit never rewrites, **it could never
desynchronize on its own**.

**The fix is two things, and one of them is not the obvious one.**

- `cached()` takes `{ refresh, jitterSeconds }`. `refresh` skips the read and
  re-fetches. An `EXPIRE` on the existing value was **rejected deliberately** —
  it would keep week-old data alive forever on the strength of having looked at
  it. A TTL exists for freshness, so the only honest way to re-date one is to ask
  upstream again. Throwing still prevents the write, so §1/§2 are untouched.
- Warm writes **jitter** the TTL by up to 4 days, subtracted never added, so a
  TTL stays a bound on staleness. Without this the refresh fix alone would have
  re-synchronized the fleet into an identical cliff on ~08-13, two days into the
  live campaign. Blake caught that; the first proposal had it as optional.

**Covers get the jitter but NOT the refresh.** `needsWarming` does not gate on
cover URLs, so refreshing them would put ~2,000 Cover Art Archive requests a
night on the one upstream §7 records us having overloaded. The renditions live on
disk with no TTL and `ensureVariant` re-checks the disk, so an expired
`caa:rg:urls` costs one bounded, single-attempt discovery lookup — never the
image bytes.

**The regression test was verified against the pre-fix code**, and the first
draft of it was worthless. The jitter assertion originally counted *distinct*
TTLs and **passed** against the old code, because `redis.ttl` ticks down by a
second or two while a sweep runs. Rewritten to measure spread: the old code
produced **25 seconds** against a 3,600s threshold; the fix produces days. The
re-fetch assertion failed with `expected 0 to be greater than 0`. A third test —
a freshly warmed target must still be *skipped* — passes both before and after,
which is what makes the change surgical rather than "re-fetch everything nightly".

**The deploy reset the sweep timer, which nearly undid the point.**
`startWarming` uses `setInterval` with no leading call (recorded in 6.1.4 and
true again here), so recreating the backend at 18:47 UTC moved the first sweep
from 08-05 19:52 to **08-06 18:47** — roughly four hours *after* the fleet's
median expiry. The fix would have shipped correctly and still let the cliff
happen. Corrected by running the operator path immediately:
`warm-run.ts` detached via the `migrate` maintenance image. Its `--dry-run`
reported **490 of 490 due**, which is both the cliff and the 6.2e dry-run fix
still holding.

**What this says about the logs is the part worth keeping.** `lastResult`
recorded the outcome of an *attempt* and was honest about it; what nothing
recorded was whether the attempt did any work. Six nights of `0 with failures`
described a job that was almost entirely no-ops. The check that would have caught
it is the one the fix's test now encodes — *did upstream actually get asked, and
did the TTL actually move* — and neither is visible in a success count. Same
class as 6.1.5's `warmed N`: a number that counts intentions reads exactly like
one that counts results.

**Verified live, from production Redis, mid-run.** Before: every layer bunched at
22–26h. After the first six targets: TTLs spread across **74h–162h** (3.1–6.7
days), a different value for every layer of every artist — jitter doing exactly
what it exists to do.

#### The one key that did NOT move, and why that is the fix working

`mb:artist:search:the beatles` stayed at 22.1h while The Beatles' other three
layers re-dated. The run log has the reason: `HTTP 503 on /artist/?query=The
Beatles` → `artist search degraded`. Under §1 a degraded discovery answer is not
cached, so the callback threw, `cached()` never reached its write, and **the
existing entry was left alone rather than replaced by an empty one**. That is the
documented contract for `refresh` and it held on its first night in production.
`needsWarming` will select the target again tomorrow, since 22.1h is inside the
window.

**But `lastResult` says `ok: 1042 release-groups, 19 covers`.** A degraded search
layer is invisible in the outcome column, because `searchMusicBrainzArtists`
catches `UpstreamUnavailableError` internally and degrades to `[]` per §7 — so
`warmTarget`'s `layer()` wrapper sees no throw and records the layer as warmed.
The row reports a clean sweep for a target where one layer of four did nothing.

Filed rather than fixed, deliberately: changing the reporting mid-run would split
this run's log across two behaviours and make it unreadable as evidence — the
same reasoning 6.1.5 applied to the cover retry policy. It is a smaller sibling
of the bug above and belongs with it: **`ok` is once again describing an intention
rather than a result.**

## Brand v3 — the eighth-note/L identity (DONE 2026-07-30)

The Groove glyph was always a placeholder, and Phase 7 item 2 said so. The
finalized mark landed, so the placeholder and **the machinery that generated it**
are both gone: `scripts/generate-icons.mjs`, its `src/lib/iconGeometry.json`
input, the `pnpm icons` script, and all seven files in `public/icons/`. The old
`icons/README.md` had asked for exactly this — *"delete the generator rather than
re-running it"* — which is the useful shape for a placeholder to have: it named
its own disposal condition while it was still the thing in use.

**The mark is an `<img>`, not inline SVG, and that is the one real decision
here.** The v3 artwork is a gloss rendition — an eight-stop gradient plus a
specular overlay — and the identity sheet's first guardrail is that it is never
recoloured. Inline SVG puts those stops in JSX, one `currentColor` or CSS
`filter` away from a call site that means well. Referencing the shipped file
makes "as authored" the only reachable state, and costs nothing: it is one
cacheable request already shared with the favicon ladder.

**Sizing was measured, not assumed — and the first answer was still wrong.** The
`size` prop was *documented* as cap height; it is the font size, and Archivo
800's real cap ratio is 0.687, so `size={20}` is a **13.74px** cap (measured
against the loaded face via canvas `TextMetrics`). That much the first pass got
right, and it shipped 28px on the strength of it.

The part it missed: **the sheet's "336u mark" is the artwork's INK, not the SVG
box.** `Soundlog_Mark_v3.svg` is a 512 viewBox whose content bbox is ~340u — ink
fills only 66.4% of the box height. Sizing the *box* against cap height
therefore renders the *ink* a third smaller than the sheet asks, while looking
arithmetically correct in the code, which is exactly why it survived a review.
Solving for the box instead — `1.68 × cap / 0.664` — gives **35px**, with the
gap likewise 0.25 of *ink* (≈6px, not 8). Verified after the change: ink sits at
**1.691× cap** against the sheet's 1.68.

Blake settled this rather than the code guessing: 28px was defensible optically,
35px is sheet-faithful, and the two readings of "336u" cannot both be right. The
derivation now lives in the `MARK_SCALE` docstring so the next person does not
re-derive it from the wrong end. Expressed as `size * MARK_SCALE` so display
lockups at `size={32}`+ keep the relationship instead of growing type around a
fixed mark.

`?v=3` on the favicon hrefs is load-bearing: Vite fingerprints what it *bundles*,
but `public/` is copied verbatim, so a favicon has no content hash and browsers
cache them hard and per-origin. Without the query a returning visitor keeps the
Groove glyph in the tab indefinitely.

Two things found while grepping: the app had **no `og:image` or `twitter:image`
at all** — never did, so every pasted link unfurled bare — and the 380px nav grew
146px → 158.5px with the larger mark. No 5.5 invariant moved (no horizontal
overflow at 380px, targets unchanged). The first of those was closed immediately
after; see *Social share cards* below.

Master kit archived at `brand/`; the seven files the web app actually serves are
copied into `apps/web/public/`. Lockups and the avatar cut are in the kit but
unreferenced — deliberately not shipped to a static dir that every deploy copies.

### Small renditions use the FLAT build — resource-dependent geometry is not safe (2026-08-07)

**Rule: at small sizes the mark is `Soundlog_Mark_v3_Flat.svg`. The gloss build
is for renditions where the emboss actually reads — `og.png`, the app icons, the
favicon ladder.**

Blake reported the nav mark rendering in Safari as a solid gold gradient TILE
with no glyph, wordmark correct beside it. Intermittent: two consecutive loads,
first wrong, second right.

**The mechanism is in how the gloss build draws.** It does not fill a glyph path.
It defines the glyph as `clipPath#mc` and paints gradient-filled `<rect>`s
*through* that clip — the shape exists only as a clip reference. An unresolvable
`clip-path` renders **unclipped**, and unclipped here is literally
`rect x=60 y=70 w=460 h=380 fill="url(#mg)"`: a gold gradient rectangle. The
reported symptom is not a corrupted file, it is the correct file painted one step
too early.

**Everything else was eliminated first**, and the elimination is the useful part:

- the file — glyph present, in-bounds (ink x 91–492, y 92–432 in a 0–512
  viewBox), not flattened; renders correctly in Chromium and in WebKit at 512,
  140, 70 and **35px**, the nav size;
- the DOM/CSS — `<img>`, not inline, so ID collision and bundler rewriting of
  `url(#mc)` are both impossible; `.wordmark-glyph` applies no filter or mask;
- nginx — `/Soundlog_Mark_v3.svg` resolves via `try_files $uri` and the file
  exists, so the SPA fallback is unreachable. It could not explain the symptom
  anyway: index.html would be a **broken image**, not a tile;
- Varnish — never sees the path (only `/api/`, `/covers/`, `/avatars/` proxy);
- the origin — 60 forced fetches returned one cluster: `200`, 4,991 bytes, one
  sha256, `image/svg+xml`. Origin logs show only `304`s. No second cluster.

So the server is deterministic and the race is in WebKit's SVG-as-`<img>` paint
path. **We cannot fix the race. What we can fix is the blast radius**, and that
is the actual defect: the gloss build makes the glyph's EXISTENCE depend on a
resolvable reference, so a resolution hiccup costs the entire shape rather than
the sheen. `_Flat.svg` is the same path data and the same `translate(-37.6 -6)`
with a flat `--gold` fill: **8 `url(#…)` references become 0**. The failure mode
is unreachable by construction rather than unlikely.

Sizing did not move — identical geometry means the ink bbox `MARK_SCALE` is
derived from is unchanged, and the nav measures 61px as before.

The general lesson, worth applying beyond this mark: **an asset whose geometry
depends on an internal reference fails catastrophically, not cosmetically.** A
gradient that fails to resolve costs you a colour; a clip that fails to resolve
costs you the drawing. Prefer builds where the shape is a filled path wherever a
failure would be visible and you are not there to see it.

## Social share cards (DONE 2026-07-30)

A pasted soundlog.app link had unfurled bare since launch — no `og:image`, no
`twitter:image`, never any, in any form. Now: the full Open Graph + Twitter card
set in `index.html`, and `og.png` (1200×630, opaque RGB, 55KB) served from
`apps/web/public/` with its master at `brand/Soundlog_OG_1200x630.png`.

**Static markup, and that is not a style preference.** Slack, iMessage,
Twitter/X, Discord and Facebook fetch the HTML and parse it; not one of them runs
our JavaScript. A `<meta>` injected by React after hydration is invisible to
every unfurler there is, so a per-route head library would look correct in
devtools and change nothing in a paste. Verified rather than assumed that none
exists: no react-helmet, no unhead, no `document.title` manipulation anywhere in
the app — `index.html` is the only head there is.

**Absolute URLs throughout.** Unfurlers resolve `og:image` against nothing, so a
relative path is dropped and the card degrades to text with no error surfaced
anywhere. `og:*` uses `property`, `twitter:*` uses `name`, per each spec.

**The near-miss worth recording.** The tags were committed one step ahead of the
artwork, and the gap would not have announced itself. nginx serves
`try_files $uri /index.html`, so a missing `/og.png` is **not a 404** — it is a
`200` carrying `text/html`. A crawler asks for an image, gets a web page, and
drops it silently; the tags look present in View Source and the card is bare
anyway. Nothing in the build, the typecheck or 707 tests observes this. The
check that catches it is the one that fetches the URL and asserts on the
*content-type*, which is now the receipt for any future artwork swap.

Two live consequences, filed rather than defects:

- **The card is identical for every route.** `/release/…` and `/user/…` unfurl as
  Soundlog, not as the album or the person. Per-route cards need the server to
  render per-route HTML for crawler paths — a backend change, not a tag.
- **`og:image:width`/`height` are a contract**, declared 1200×630. Replacement
  artwork must be exactly that or the card crops wrong.

## The muted text tier goes warm (DONE 2026-08-07)

`--text-muted` was `#9c978b`, a near-neutral grey, and is now **`#E3CDA6`**. A
design change, not a fix — but it could not be made as a value change, and the
reason is the part worth keeping.

**One token was doing two jobs.** Thirteen call sites, and they split cleanly:

- **Secondary CONTENT** — `.meta` (162 uses), `.section-label` (21),
  `.settings-label`, page ledes, bios, list descriptions. Quiet because the
  information is secondary.
- **The RESTING state of a control** — `.nav-links a`, `.tab`, `.btn-ghost`, the
  Profile tab button. Quiet *relative to something else*, which is the whole job.

Warm gold breaks the second kind, and the measurement says why: **`#E3CDA6` is
12.76:1 on ink-0, brighter than `--gold-bright` (11.66) and `--gold` (8.22).** It
would have become the second most luminous thing in the system, above every
accent. A control resting in it outshines its own active state. Hence
`--text-inactive`, holding the old `#9c978b` for those four sites, and
`--text-faint` picking up the avatar fallback glyph (a placeholder, not a rest
state, and a non-text graphic answering to 1.4.11's 3:1 — 4.74 clears it).

**The first split was drawn in the wrong place, and the app said so.**
`.artist-link` went to the grey tier on the strength of its hover inverting
(rest 12.76 → hover `--gold` 8.22 is a link that *darkens* when you point at it).
But `.artist-link` is not artist links — it is the class for **any metadata
link**; `ArtistCredit` defaults to `className="artist-link meta"`, and
`Release.tsx` puts it on the year and the label too. So the split landed on
**markup rather than meaning**, and it showed immediately: "Slint" rendered grey
directly above "1991" in cream inside one caption, and the *same* year rendered
warm in a grid tile but grey on the release page. Measured on the live page: 13
grey / 14 warm across 27 `.meta` elements, in one view.

The sharper criterion, which is what the token comment now carries: **grey is for
a control with a SIMULTANEOUSLY VISIBLE active sibling.** You must tell at a
glance which tab is active. A hover link has no such sibling — its resting state
is never on screen beside its own hover — so metadata links are content and stay
warm, with hover moving to `--gold-bright`: 12.76 → 11.66 barely moves contrast
while saturation jumps 52% → 71%, so the link lights up instead of dimming.
Confirmed by eye on the running app, and by computed colour: hovered
`rgb(230,195,106)` against a resting sibling at `rgb(227,205,166)`.

Final: `--text-muted` 8 sites, `--text-inactive` 4, `--text-faint` gains the
avatar glyph. All 27 `.meta` elements now compute to one colour.

**Contrast.** 12.76 / 11.96 / 10.95 on ink-0 / ink-1 / ink-2. Every site is
normal-size text — the largest is 15px, and WCAG's large-text allowance needs
18.66px bold or 24px regular — so 4.5:1 is the bar at all of them. Worst case is
`.meta` on a raised surface at 10.95, past AAA's 7:1. The ratio method was
validated by reproducing every figure already published in `theme.css`.

**Mobile is deliberately untouched.** `apps/mobile` hardcodes `#9c978b` in four
places, all Job A. Those screens are rebuilt in Phase 7 and pick up the decision
then; swapping them now buys a divergence with no surface to show it on.

**Deployed and verified** at `8e7b6bf`. `verify-prod-stack.sh` green end to end;
the live hashed asset `/assets/index-3QDKkTBS.css` carries the three tokens and
the `.artist-link` pair, and all 29 `.meta` elements on soundlog.app compute to
one colour. Suites: web 264, backend 469.

**The deploy reset the warm timer again, and the operator path was run** — the
same correction 6.2g needed, and now filed as Phase 7 item 6. The dry run is the
useful number: **16 of 490 due**, against **490 of 490** at the cliff on 08-05.
The 6.2g recovery is done and the jitter is visibly holding — TTLs spread
26h–127h rather than bunched at 22–26h. The sweep warmed all 16 in 04m12s
(4,909 release-groups cached, 273 cover renditions on disk).

**Verified by re-running the dry run rather than by trusting the tally**, which
is 6.2g's own lesson — `warmed N` counts attempts, not outcomes. After: **6 of
490 due**. The TTLs demonstrably moved (Drake 37h→120h, Townes Van Zandt
57h→126h, Darkthrone 113h→86h, Prince 100h→83h — every one rewritten with a
fresh jitter). Two of the residual six are newly crossing the threshold; the
other four had just been warmed, which is consistent with §1 doing its job: a
layer whose discovery call 503'd is not cached, so it stays due rather than
caching a degraded answer — the same mechanism 6.2g recorded for
`mb:artist:search:the beatles`. Not chased: 6 of 490, self-correcting on the
next sweep. **MusicBrainz 503'd nearly every discovery call during this run**
while lookups succeeded on retry; discovery gets one attempt by §7 and degraded
harmlessly, but the rate is worth watching if it persists into launch week.

## One-off — Kickstarter announcement recipient export (2026-08-12)

Not a phase. A read-only export of eligible recipients from production Postgres,
for a one-time Kickstarter campaign announcement sent via Resend Broadcasts.

**4 recipients.** Written outside the repo, to a file that is not under version
control and is not committed here; the addresses are deliberately not recorded
in this log. Eligibility was every verified account: `emailVerifiedAt IS NOT
NULL`, deduped case-insensitively on `lower(email)`, structurally-invalid
addresses dropped, `email` and `displayName`/`username` selected and nothing
else.

Read-only was enforced by the session, not by the role — the only login role on
the box is `soundlog`, which is superuser, so the query ran under
`PGOPTIONS=-c default_transaction_read_only=on`. No writes, no migrations, no
application-code change.

**Two schema facts the export turned up, both worth keeping:**

- **There is no soft-delete on `User`.** `deleteUserEverywhere` hard-deletes the
  row (`accountDeletionService.ts`), so "not deleted" needs no filter — a
  deleted account is absent, not flagged. Any future export that assumes a
  `deletedAt` column is wrong about this table.
- **There is no marketing-consent or opt-out column, and no unsubscribe path in
  our own code.** `emailVerifiedAt` proves an address is real; it does not
  record that anyone agreed to hear from us about anything but their account.
  Every send to date has been transactional (`emailService.ts`). A campaign
  announcement is the first non-transactional use of these addresses, and the
  only unsubscribe mechanism in play is the one Resend Broadcasts adds — theirs,
  not ours, so a suppression recorded there is invisible to Postgres and the
  next export would re-add anyone who opted out. If we send campaign mail again,
  a stored preference column comes first.

## Phase 6.3 — wrong and missing cover art (code DONE 2026-08-15)

Reported as two symptoms on Tom Waits' pages, confirmed on release detail pages
as well as the discography grid — so a shared, PERSISTED resolution path, not a
grid-rendering bug. It turned out to be **three defects**, and the leading
hypothesis going in was wrong in an instructive way.

**The hypothesis that was wrong.** The obvious read — "we pick release-level art
from an arbitrary release instead of using the release-group endpoint" — was
refuted in the first twenty minutes. `Release.musicbrainzId` holds a
release-GROUP MBID (`musicbrainzSource.lookupRelease` → `rg.id`), and
`getCoverArtUrls` already called `/release-group/{mbid}`. For *Small Change* the
archive's group JSON returns an approved `types:["Front"]` as `images[0]`, and
`/front-500` answers 200. The archive was healthy and the endpoint was right.

**A — the Discogs fallback served vinyl LABEL scans.** `pickSquarestImage`
ranked purely on aspect ratio and never read Discogs's `type` field, where
`primary` IS the declared front. A record label is a circle cropped to a perfect
square, so it scores 0.0000 and beats a real sleeve every time. Proven end to
end: *Small Change*'s stored `coverUrl` decoded to
`s3://discogs-database-images/R-725926-1415564276-3493.jpeg` at 600×600 — the
Asylum Records "SIDE ONE" label — against a `primary` front of 550×545 (0.0091).

The fix could not simply invert to "always trust primary": `discogsSource.ts`
avoided `primary` on purpose, because it is sometimes a full gatefold spread
that crops to a smear. `pickCoverImage` trusts the declaration **unless it is
measurably a spread**, which satisfies both shapes, and unmeasurable dimensions
keep the declaration rather than handing the tile to the one image we CAN
measure — the label.

**B — a Cover Art Archive 500 was cached as "no art" for a week.** One line:

    if (!res.ok) return null; // 404 = no art on file

The comment describes a 404; the branch caught every 5xx, and `cached()` wrote
that `null` under a 7-day TTL. **This is §1's own bug, one layer below the
MusicBrainz call §1 was written for.** The archive's release-group endpoint
answers a *persistent* 500 for real groups — *Blue Valentine*,
*Swordfishtrombones*, *Downtown Train*, verified 5/5 attempts — while the
releases INSIDE those groups serve approved fronts perfectly well. Every one of
those albums was blank across the whole app because a server error had been
written down as "this record has no artwork".

Now split properly: 404 → `null` (cacheable), 5xx/429/timeout →
`UpstreamUnavailableError` (never cached), and a **release-level walk inside the
group** — earliest pressing first, MBID-only — before concluding anything.
Selection also now requires an **approved front**; the old `?? images[0]`
fallback handed the cover slot to whatever was uploaded first, commonly a
`Medium` label or disc scan. A deliberate placeholder beats a wrong cover: wrong
art reads as our data being wrong, absent art reads as absent.

**C — nothing ever revisited a cover, which made A and B permanent.** The heal
in `catalogService` is guarded `if (!existing.coverUrl)`, so a WRONG cover was
never re-examined, and a MISSING one only re-ran during a seed (a GET by
internal id is a `findUnique` and nothing more — this file has said so since
6.1.1). The warm fleet did not rescue it either: it resolved art into Redis and
rendered the tiles, then **threw the answer away**. *One From the Heart* was the
proof — `caa:rg:urls:69393ad0…` held a valid archive URL while its `coverUrl`
column was NULL and the page was blank. The cache had the answer and no way to
hand it over.

`persistResolvedCover` closes it: the sweep now writes resolved art onto the
release row when the stored cover is missing or Discogs-sourced. It upholds the
"creates NOTHING" contract — an UPDATE to a row that already exists, matched by
MBID, a no-op for a release we do not hold. A Cover Art Archive cover we already
hold is canonical (§3) and is left alone, so the sweep converges instead of
flip-flopping between sources nightly.

**Blast radius (production, 2026-08-15):** 39,185 releases — **7,848 NULL
covers (20.0%)** and **9,695 Discogs-sourced (24.7%)**, the latter being the
pool at risk of defect A. 21,560 are archive-sourced.

**What the live demo cost, and what it taught.** Two bugs in the new code were
found by running it against the real archive rather than by the suite:

- **`?? "9999"` does not catch `""`.** MusicBrainz returns `date: ""` for an
  undated pressing, which sorts *before* `"1978"`, so the earliest-first walk
  put a dateless reissue ahead of the original sleeve. `|| "9999"` — and the
  test now pins the empty-string shape specifically.
- **2,500ms was the wrong timeout for the release probe.** Measured live, the
  per-release lookups took 1.64–1.98s, close enough to trip the abort under
  load. The walk skipped the 1978 *Blue Valentine* (art intact) and landed on a
  2018 reissue **whose image bytes 500**. That timeout is right for the GROUP
  lookup, where the archive is one source in a chain and moving on is cheap; it
  is wrong for a probe that only runs BECAUSE the chain came up empty. 6,000ms.

Both were invisible to a green suite and obvious the moment real MBIDs went
through the resolver. Live-demo-before-done earned its place in §9 again.

**Verified live, through the fixed resolver, bytes rendered and eyeballed:**
*Small Change* → its true front; *Blue Valentine*, *Swordfishtrombones*,
*Heartattack and Vine*, *One From the Heart* → resolved via the release-level
walk. *Downtown Train* correctly raises retry-able rather than caching a false
"no art" — the archive is genuinely unreachable for that group right now, and
saying so is the point.

Backend 483 tests / web 264 tests / both typechecks green. Three new suites:
`coverImageSelection` (pins the label-scan bug by asserting the OLD function
still picks the label), `coverFrontSelection`, `warmCoverRepair`.

### 6.3a — the warm sweep is not a repair tool (2026-08-15)

Deployed `dda5d39`, cleared the 25 live `caa:rg:urls` keys for Tom Waits (83
read back, 25 removed, 58 already absent, all 83 absent afterwards) — and then
the **dry run refused to do anything**: `0 of 1 target(s) due`.

Two independent reasons, both of which would have made a repair run report
success while accomplishing nothing — 6.2g's failure mode exactly, reached
through a different door:

- **`needsWarming` gates on the four METADATA layers**, never on covers. Tom
  Waits had been swept the day before, so its layers sat ~6 days from expiry and
  the target was skipped no matter how broken its artwork was.
- **`coverPrefetchSet` is studio albums/EPs capped at 24**, and Tom Waits has
  213 release-groups. It excludes SINGLES outright — so *Downtown Train*,
  *Goin' Out West*, *Hold On* and *Bottom of the World*, four of the reported
  blanks, are unreachable by a sweep at any TTL.

Neither is a bug. `WARM_COVER_CACHE_OPTS` deliberately omits `refresh` (§7: a
refreshing covers layer is ~2,000 archive requests a night, ~9,800 on a full
pass), and the prefetch cap is "the default view", which is the depth warming
was scoped to. **The sweep is the self-maintaining half; it was never the
repair half.** Asking it to be both is what the dry run caught.

So the shared rule moved to `coverRepair.ts` — `isRepairableCover`,
`persistResolvedCover`, `repairCover` — and `scripts/repair-covers.ts` is the
scoped operator path. It refuses to run without `--artist` or `--all`, prints
the selection with counts before writing, and `--dry-run` resolves upstream and
shows every before/after without touching a row. Demonstrated end to end on dev
against the live archive: the *Small Change* label scan → the true front, then
re-run to confirm it is **idempotent** (the repaired row is no longer a
candidate).

**A scope limit that matters for the catalog-wide pass, not for Waits.** Repair
resolves by release-group MBID, and not every row has one:

| population | count | reachable by MBID repair |
|---|---:|---|
| blank covers | 7,918 | **all** — 0 lack an MBID |
| Discogs-sourced | 9,704 | **4,468** — 5,236 (54%) have no `musicbrainzId` |

Those 5,236 were seeded from Discogs and never matched to MusicBrainz. They
cannot be repaired through the archive, and inventing an MBID for them by
title/artist search is precisely the identity-by-name that §3 forbids. The
honest second path is to re-run the FIXED `pickCoverImage` against their
existing `discogsId` — same record, same id, better image choice — which is
identity-safe. Not built yet; it is the first thing the widening needs.

**Tom Waits is unaffected by that limit:** 83 rows, **0 without an MBID**, 35
blank and 12 Discogs-sourced, so the scoped run covers 100% of its population.

### 6.3b — the Tom Waits repair run (DONE 2026-08-15)

Deployed `4cefdcf`. Before/after snapshots of all 83 rows, diffed:

    rows before=83 after=83   changed=25
      21  BLANK   -> CAA
       4  DISCOGS -> CAA
      stale tints cleared: 4
      rows that went blank: 0
      untouched rows: 58, of which changed anyway: 0

**25 repaired, not the 22 the dry run projected** — three of the six
`unavailable` resolved on the second attempt. That is the §1 fix paying for
itself in the most literal way available: under the old code those three would
have been written down as "no artwork" and cached for a week.

Residual, as accepted: **14 still blank** (19 `no-art` less the ones that
resolved) and **8 still Discogs-sourced**, of which three are perfect squares —
*God's Away on Business (live)*, *Romeo Is Bleeding*, *Shadows of Intolerance*.
I pulled the stored bytes for *Romeo Is Bleeding*: a **CD disc scan**, the same
defect as the vinyl label with a different disc shape. The archive has nothing
for those groups, so only the `discogsId` re-pick path can fix them.

**The tint bug the dry-run table caught, before the write.** `coverColor` is
server-sampled and `CoverImage` PREFERS it over browser extraction whenever it
is set. Repairing `coverUrl` alone would have painted *Small Change*'s true
sleeve on the blue of the Asylum label — permanently, on the exact row being
fixed, since the client only extracts when the column is null. Nulled on repair
(`4cefdcf`). Reading the table rather than trusting the tally is what found it.

**No Varnish ban was needed, and none was issued.** `cache-policy.vcl` PASSes
`^/covers/` outright (Varnish's store is memory; image bytes would evict the
JSON the cache exists for), and `^/api/(releases|search)` carries
`beresp.ttl = 60s`. Every affected object had expired long before the run
finished. Verified rather than assumed: the live API answered `x-cache: MISS`,
`age: 0` with the new cover. Cloudflare needed no purge either — a repaired row
gets a NEW proxied path, because the URL encodes its upstream (§7), so there is
no stale object to invalidate, only a cold one to populate.

**Spot-checks, all on the live site:**

- *Small Change* — true front on its detail page AND in the discography grid.
- Former blanks — *Blue Valentine*, *Heartattack and Vine*, *One From the
  Heart*, *Swordfishtrombones* all render in the grid.
- **Boris** (160 releases, 1 in catalog — the UN-SEEDED `caaThumb` path) renders
  normally. Tiles are slow on first paint because discovery fetches and encodes
  on demand; they populate.
- **Swans** (73 releases, 72 seeded — the STORED-cover path) renders normally.
  Its remaining blanks are its own 19 NULL covers, the same defect B, untouched
  by this run and repairable by the same script.
- Regression: the 58 untouched Waits rows are byte-identical before and after —
  stronger evidence than a screenshot, and *Rain Dogs* et al. render unchanged.

**Still open:** the `discogsId` re-pick path (path 2), which the catalog-wide
sweep needs before it can claim to fix label scans; and widening itself —
7,918 blanks and 4,468 archive-reachable Discogs rows, plus the 5,236 that only
path 2 can reach.

## Phase 6.3c/6.3d — the frontend floor, and the demo repair pass (2026-08-19)

Reported as "Bob Dylan's canonical albums render blank, same class as Waits,
blast radius fleet-wide". **The hypothesis was refuted**, and the refutation is
the useful part.

**Dylan's canonical albums were never poisoned.** Four independent checks
disagreed with the premise: 11 of 13 named titles held Cover Art Archive covers
in Postgres; the discography API returned every one as `seeded` WITH a
`coverUrl`; all of those URLs served 200 through the proxy; and the live page
rendered them. The capture had been taken mid "Re-pulling from MusicBrainz…",
exactly as the brief itself cautioned.

What the page actually showed was **load progress**. Dylan's Albums tab is 163
entries of which **138 are un-seeded** — no Release row at all, artwork fetched
at render time off the release-group MBID. Measured cold through our own proxy,
one such tile took **2.2-5.8s** to fetch, resize and encode. A hundred-odd of
those is a minute of progressive fill.

**Three premise corrections worth keeping.** There is no art-state column, no
not-found flag, and no `createdAt` on `Release`, so "rows written before the fix
deploy" is unanswerable — there is nothing to compare. "Not-found" already has a
TTL: it is `caa:rg:urls:*` at 7 days, jittered. And the write-once guard is not
what freezes blanks — `if (!existing.coverUrl)` blocks REPLACING a cover, and a
NULL passes it freely; what blocks healing is that the guard only runs on the
seed path, and **"Refresh discography" only deletes the discography list key**
(`bustArtistDiscography` is a one-line `invalidateCached`), so it never touches
artwork at all.

### 6.3c — a tile must look like which of the three things it is

The one genuine defect. `DiscographyGroups` never passed `pending`, so three
states painted an identical flat `--ink-2` box: loading, genuinely absent, and
**failed** — and un-seeded tiles are discovery, so they get one attempt (§7) and
a failure is final for that page view. A policy about how hard we try upstream
was rendering as a broken page.

Now: shimmer while loading, a deliberate record-disc mark when absent, and the
**same mark** for a spent attempt (`.cover-absent::after { content: none }` —
a sweep promises something that is never coming). Not the Soundlog mark, per
Wordmark.tsx's guardrail that it is never recoloured or redrawn.

Two things this cost, both worth recording:

- **I nearly shipped an invisible mark.** `--line` is the decorative-hairline
  token and measures **1.19:1** against the `--ink-2` tile. A "deliberate mark"
  nobody can see is the blank box we were fixing. `--text-muted` at 0.3 alpha =
  2.17:1. Computing the contrast rather than eyeballing it is what caught it.
- **The first cut gated the shimmer on `withheld`, which was wrong.** `withheld`
  is true both for off-screen tiles AND for on-screen tiles waiting their turn
  in `coverLoadQueue` — so the fix skipped precisely the tiles a person was
  looking at. Now gated on `(!defer || visible)`. The regression test was
  verified to FAIL against the old line before being kept.

**A verification lesson that cost a deploy.** The production measurement that
condemned the first cut was taken in a non-painting browser pane
(`document.hidden`, `innerHeight: 0`), where IntersectionObserver never fires
and lazy images never load. Pre-fix and post-fix runs produced near-identical
numbers because the harness, not the code, dominated them. The logic bug was
real and the unit test proves it independently — but the production evidence
offered for it was worthless, and it was reported as fact. **Check that the
instrument is reading before trusting what it reads.**

### 6.3d — scoped repair over the 20 demo artists (blanks only)

`--blanks-only` added: a blank tile can only improve, while replacing a
Discogs-sourced cover is a judgement about which of two real images is the
front — and the `discogsId` re-pick path is still unbuilt. Different decisions,
different flags.

**118 rows repaired · 200 genuinely artless · 1 upstream-unavailable**, across
20 artists. Includes *Dylan* and *Pat Garrett & Billy the Kid* — the only two
canonical Dylan titles that were genuinely blank. Biggest gains: Coil 23,
Swans 22, Mobb Deep 12, Joni Mitchell 10.

Two operational notes:

- **The first runner processed 1 of 20 and reported a clean finish.**
  `docker compose run` consumes stdin — the same descriptor the `while read`
  loop was reading the artist list from — and swallowed the remaining 19. The
  fix is `< /dev/null` on the docker line. A job that exits 0 having done 5% of
  its work is the 6.2g failure mode wearing a different hat.
- Scope is `contains`, not exact, so `Coil` matched 10 distinct artist names and
  `Swans` 19. Left as-is deliberately: repair is MBID-keyed and blanks-only, so
  extra rows can only improve and no wrong-artist contamination is possible.

### The warm pass

Deliberately NOT a Varnish warm: `cache-policy.vcl` gives `/api/(releases|search)`
a **60s** TTL, so anything warmed there is gone before morning. What survives
cold is the **on-disk rendition cache (no TTL)** and Cloudflare's copy, both
populated by requesting each rendition once. **1,128 tiles requested across 20
artists — 889 served art, 239 answered 404** (genuinely no front, now rendering
the absent mark), **51/51 detail pages OK, zero errors, zero 5xx.**

I did NOT delete the 80 metadata cache keys to force `needsWarming`. 72 of 80
were live and healthy; dropping them would have forced a full MusicBrainz
re-fetch of every discography hours before a demo, trading known-good state for
risk. The metadata was already warm; artwork was the thing that was cold.

**Cold spot-checks after the pass** (24 album tiles each):

| artist | discography API | tile median | p90 | 5xx |
|---|---|---|---|---|
| Bob Dylan | 0.89s | 0.16s | 0.18s | 0 |
| Tom Waits | 0.46s | 0.15s | 0.18s | 0 |
| Boris | 0.65s | 0.16s | 0.18s | 0 |

Against the 2.2-5.8s measured cold before the pass, that is roughly a **20x**
improvement, and every tile is now either art (200) or the deliberate mark
(404) — never a bare box. Dylan's first screen measured 11 art + 1 mark + **0
raw**.

**Still open:** the `discogsId` re-pick path; the hardened fleet-wide backfill
(17,354 blanks, ~44% repairable by sample); and the scrolled-in-tile case, which
this browser tooling cannot measure trustworthily.

## Phase 6.3e — the empty answer that meant two things (2026-08-24)

> Full write-up:
> [`docs/incidents/2026-08-24-search-starvation-degraded-200.md`](docs/incidents/2026-08-24-search-starvation-degraded-200.md)
> — includes the tripwire autopsy, the four dead premises, the two near-misses
> (a defanged assertion and Prisma's NULL/`[]` coercion), the "laws this
> validated" section and the gap it names, and the 54% proposal.


Reported as three artists returning nothing on the site — **The Chromatics**,
**The Blue Nile**, **Xiu Xiu** — plus Bob Dylan's page stuck at "200 of 1192".
Four hypotheses arrived with the report and **all four were wrong**; the useful
part is what replaced them.

### What it actually was

`searchArtists` is Elasticsearch-first with a MusicBrainz fan-out, and the artist
index only ever contains artists we have already **seeded**. So for an un-seeded
artist the entire result rests on one MusicBrainz call — and
`searchMusicBrainzArtists` caught `UpstreamUnavailableError` and returned `[]`.
An outage and an absence were **literally the same value**.

Two things made it stick:

- **One attempt.** §7 gives discovery a single try, correctly. But §7 also says
  what the answer must be when that try fails — *"the answer is still 503, never
  404"* — and the code returned an empty array instead.
- **A week-long memory of nothing.** MusicBrainz answers `?query=` from a Solr
  index that is a **separate service from its main database** and degrades
  independently. A degraded Solr does not error: it returns **HTTP 200 with zero
  results**, byte-identical to a genuine miss. That was cached for `WEEK`.

Measured during the alias backfill on 2026-08-24: **MusicBrainz returned 503 on
37 of 68 requests — 54%.** `lookupArtist` retries four times and survived every
one (0 failed). A search gets one attempt. That is the whole asymmetry.

**Why the "MusicBrainz is fine" check missed it.** A manual `curl` returning 200
cannot distinguish a healthy Solr from a degraded one, because both return 200.
The **result count** was the discriminator, and the status was what got checked.

### Bob Dylan, 200 of 1192 — starvation, and a tripwire that lied

Not truncation and not display paging: `MAX_BROWSE_PAGES` is 40 (cap 4,000), and
there is no `200` limit anywhere in backend or web. 200 is exactly two pages of
`BROWSE_PAGE_SIZE`. Discography assembly runs at the **`browse`** tier, and
`upstreamPriority.ts` said in writing that strict priority can starve it and that
measuring the wait was enough. **That bet lost.** Page 3 never won a slot,
`onProgress` never fired again, the `Assembly` carried no error because nothing
had *failed*, and every poll answered `assembling` — forever.

The tripwire meant to catch this **could not fire**. `starvationWarnMs` computed
`waited` inside `take()`, i.e. **at dispatch**. A waiter that is never dispatched
is never measured, so the warning could only report starvation that had already
**ended**. During the wedge it emitted nothing, and its silence read as health.
A tripwire that fires on recovery rather than on the fault is worse than none,
because it is trusted. Pinned by a test that was verified to fail first.

### Four premises that did not survive

- **"Hollow/dropped index."** Counts matched Postgres exactly (68/68, 168/168).
- **"Never ingested, therefore invisible."** True that all three were absent from
  both stores — but the fan-out exists precisely for that case, and it works.
- **"A serialized ingest worker wedged behind Dylan."** There is no ingest queue.
  The only BullMQ queue is `soundlog-activity`; there is no worker container in
  either compose file. Ingest is synchronous and in-request. Nothing was queued
  behind anything.
- **"Job lifecycle states are missing."** `enrichmentState.ts` has had
  `pending`/`ready`/`failed` with a sticky `failed` since 6.1.1.

### The fixes

- **A thin answer is cached briefly, a real one for a week.** `CacheTtl` gained
  an object form (`{full, thin, isThin}`). Empty search results now live 10
  minutes. `refresh: true` keeps the full TTL, because the warm sweep re-asks
  nightly *and* because letting the two search layers expire in minutes would
  make every target look permanently due — the 6.2g failure from the other side.
- **Degrading is now the caller's decision.** `searchMusicBrainzArtists` and
  `searchReleaseGroups` propagate. `searchArtists` serves seeded results when it
  has them and surfaces the outage when it has none; `searchCatalog` throws only
  when **every** source failed and nothing is seeded. Route answers 503 +
  Retry-After. Still one attempt — this was never about trying harder.
- **Priority ageing** (`AGE_PROMOTION_MS`, 15s). A waiter older than the
  threshold is dispatched ahead of higher tiers. Priority is preserved for every
  shorter wait; only the tail becomes finite. **The rate is untouched** — ageing
  reorders, it never dispatches faster.
- **A tripwire that fires during the fault**, sampled from `pump()` while the
  waiter is still queued, routed through `onStarvation()` so it can page instead
  of whisper (default `console.error`, `[ALERT]` prefix).
- **Assembly watchdog.** Heartbeat on every landed page; no progress for 90s is a
  terminal `DiscographyStalledError`, evaluated on the poll rather than a timer.
  "In progress" is no longer a state with no exit.
- **`/api/health/upstream`** — queue depth, **oldest-wait**, in-flight assemblies
  and their age, starvation counters. Depth says how busy; **age** says whether
  anything is stuck, and only age separates a fast queue of forty from one waiter
  parked for minutes.

### Bug 1, and the alias finding that changed the plan

**MusicBrainz does not list "The Chromatics" as an alias for Chromatics.** Its
only alias is `KRMTX`, and there are three unrelated bands *literally* named "The
Chromatics", all outranking the Portland one. So alias indexing — the specified
primary fix — **does not fix the reported bug**. The zero-result **article
fallback** does.

Both shipped. The fallback is a fallback and never an analyzer rule, because the
analyzer cannot tell "The Chromatics" (an article a user added) from **The The**,
**The Who**, **The Band** (artists whose names *are* the article). Index-side
stripping makes the canonical spelling unfindable in order to help the colloquial
one. Aliases are worth having anyway: `aliases` column + ES field (added to the
live mapping with `putMapping`, since `ensureArtistIndex` early-returned and the
change would otherwise have worked only on machines that had never run).
Backfill: **45 of 68 artists, 0 failed** — `MBV`, `Floyd`, `ピンク・フロイド`,
`ae`, `オウテカ`, and `Radio Head` → Radiohead, live through the API.

### Cover art

`caa:rg:urls:<mbid>` was already MBID-keyed and `cached()` provably cannot write
on a throw, so nothing was poisoned — 118 keys scanned, 112 legitimate cached
nulls. Neu! resolves and renders end to end (8,984 / 36,150 bytes). Two real
defects found anyway:

- **The warm sweep warmed a key nothing reads.** CAA serves `image` as cleartext
  `http://` on older records (`Neu! ’75` is one), and `ensureVariant` keys on
  `sha256(upstreamUrl)`. Every other consumer normalises the scheme first; the
  sweep did not, so it wrote `w400/b2/b2ac3a1b…` while the route read
  `w400/f0/f0ea25d6…`. Same image, two entries — full fetch-and-encode, put where
  nothing would read it, charged twice against the LRU bound, and the visitor
  still paid cold cost on exactly the covers we had "warmed".
- **Colliding name-derived keys.** `discogs:covermatch:${artist}:${title}` and
  three siblings interpolated raw values around a `:` delimiter. `Songs: Ohia` is
  in the catalog, and that key holds an **artwork URL** — so a collision serves
  one record's sleeve for another. Now `keyPart()`-encoded and version-bumped.

### What would have caught this

`scripts/search-canary.ts` — deploy-time, end to end, deliberately crude, because
every sophisticated check passed while search was broken: ES was green, the API
returned 200, MusicBrainz answered a manual curl, and the route logged nothing
because an empty result is not an error. It asserts known-indexed artists are
findable, index-vs-Postgres drift, the article fallback, and alias search.
Verified by deleting one ES doc: **`FAIL find artist "Autechre"`**, exit 1;
restored, exit 0. It does not call MusicBrainz — a canary that fails when a third
party does trains everyone to ignore it.

`scripts/audit-discography-completeness.ts` compares the discography view's
**total shown** (MusicBrainz's `release-group-count`) against what is **loadable**
(the cached assembly). It deliberately does *not* flag held-vs-upstream deltas:
Soundlog does not mirror MusicBrainz, so holding 17 of Bowie's ~1,000 groups is
the product working, and a report where every line is a false positive is one
nobody reads. Verified by planting a short cached discography — flagged
`INCOMPLETE` with a targeted `del`, never a global purge.

**Test-contract changes (§9), all three deliberate.**

1. `discoveryCaching.test.ts` no longer asserts a degraded ARTIST search returns
   `[]` — that degradation *was* the bug.
2. `findReleaseGroupMbid`'s "a weak or absent match is definitive and stays
   cacheable" is now a short TTL: true of a healthy Solr, false of a degraded
   one, and the response cannot tell them apart.
3. `searchReleaseGroups` no longer swallows either. This one was found by
   reading the diff rather than by a failing test, and it mattered:
   `musicbrainzSource.search` is its only caller, and `searchCatalog` decides
   "every source failed" by counting sources that THREW — so while this
   swallowed, that count could never include MusicBrainz and the outage branch
   was structurally unreachable for the primary source.

**And one near-miss worth recording.** Changing the `mb:rg:match` key format to
`v2` silently defanged an assertion: the test rebuilt the key by hand in the OLD
format, so `expect(await redis.get(key)).toBeNull()` began passing because it
was reading a key nothing ever writes. It would have kept passing if the caching
bug came back. The key is now exported (`releaseGroupMatchCacheKey`) and the test
asserts against the same string the implementation writes. A test that passes
for the wrong reason is the same failure mode as a tripwire that fires on
recovery — both report health they never actually measured.

**Still open:** per-page offset checkpointing for discography assembly (a retry
still restarts at page 1); production onset dating, which needs logs this
environment cannot reach; and the release-search analyzer asymmetry —
`autocomplete_search` uses the letter-only `lowercase` tokenizer, so `Neu! '75`
and `Neu! 75` both tokenize to `["neu"]` and indexed digits can never be matched.

## Then — Phase 7

Now downstream of **6.2**: the mobile app consumes the Settings & Profiles API,
and account deletion in particular is what App Store review will be looking for.

What Phase 7 carries, in the order the work naturally falls:

1. **The mobile app's missing surface** — auth, release detail, and the write
   actions. Mobile currently ships a feed tab and a placeholder profile, which
   is why two 5.5 items are *blocked* rather than pending: no screen fires a
   haptic intent, and there is no release detail screen to host a native star
   input. Both are unblocked the moment those screens exist.
2. ~~**Real icon design.**~~ **Done** — see *Brand v3* and *Social share cards*
   above. All that remains of this item is a **monochrome cut** for Safari
   pinned tabs.
3. **Navigation component.** The 380px nav wraps to three rows (~158px, ~20% of
   the viewport — the v3 mark added ~12px over the placeholder glyph). The
   wordmark home link is 41.5px tall, still under the 44px touch floor the rest
   of the nav clears; pre-existing, and the larger mark moved it closer. Blake
   ruled it **good under a thumb** during the launch journey, so this is a
   nicety, not a defect — a disclosure menu or tab bar is a new component, not
   polish.
4. **Desktop half-star hit targets** — still 8×24, pre-existing and tight even
   for a mouse. Touch was fixed in 5.5; desktop was out of that brief.
5. **Sign in with username OR email.** The login form takes an email address
   only. Found on the 6.2b step 6 phone pass, and the reason it is worth fixing
   rather than filing forever: the delete-account form asks a person to type
   their **username** to confirm, so the product now demands they know two
   different identifiers for one account and is picky about which goes where.
   `verifyCredentials` looks up by email today; accepting either means one
   lookup that tries both, with the same uniform "invalid email or password"
   answer so it cannot be used to probe which usernames exist.
6. **The warm sweep's schedule must survive a restart.** `startWarming`
   (`warmService.ts`) is a `setInterval` with **no leading call**, so the first
   sweep is one full interval — 1440m in production — after boot, and **every
   deploy resets it**. This has now bitten three times: recorded in 6.1.4, again
   in 6.1.5 as the thing that made a pre-warming verification plan
   unfalsifiable, and again in 6.2g, where recreating the backend at 18:47 UTC
   moved the first sweep to four hours *after* the fleet's median expiry and
   nearly undid the fix being deployed. On 2026-08-07 two deploys in one day
   deferred it twice. **Deploys landing more often than every 24h mean the sweep
   never runs at all** — 6.2g's failure mode (a job that silently accomplishes
   nothing) reached through deployment cadence instead of through `cached()`.

   Filed as a fix rather than a known nuisance, and **deliberately not done in
   launch week**. Two candidate shapes, and the cheap one is not obviously right:

   - **A leading call on boot** is nearly one line, but it makes every deploy
     start a full sweep — half an hour of upstream work against a cold list,
     repeatedly, exactly during a deploy-heavy period. That cost is why the
     current shape exists; it is not an oversight.
   - **A persisted last-sweep timestamp** (Postgres, beside `WarmTarget`) with
     the interval computed against it, so a restart resumes the schedule rather
     than restarting it. More work, and the correct answer: it fixes the reset
     without converting every deploy into an upstream burst, and it makes "when
     did the sweep last actually run" answerable — which it currently is not,
     because container recreation resets the logs.

   Whichever ships, `warm-run.ts` stays: an operator path that runs in the
   foreground and reports what it did is worth having regardless of the timer.

7. **The post-launch checklist above**, which is dated rather than blocked.

Before starting **either phase**, read the **Production operations** section of
the README — everything from here on ships to a live site with real users' data
on it, which was not true of any previous phase. It also carries **Debugging a
production incident**, the log-first workflow that resolved the day-one rating
bug in one session.
