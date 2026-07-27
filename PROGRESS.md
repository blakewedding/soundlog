# Soundlog — Progress

Execution state. `CLAUDE.md` holds the binding patterns (read it first);
`README.md` holds the build plan and v1.1 backlog. This file is the "where are
we, what's live, what's next" for a session starting cold.

**Repo:** https://github.com/blakewedding/soundlog · `main`
**Last updated:** 2026-07-26 — Phase 6.1.4 done, deployed and phone-checked
(6.1 · 6.1.1 · 6.1.2 · 6.1.3 · 6.1.3b · 6.1.4). Next: **6.1.5**, the `CoverImage`
load-event race. Pre-warming ships disabled — enable tomorrow as its own step.

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
| IPv4 | `95.216.158.204` |
| IPv6 | `2a01:4f9:c015:2f9f::1` (host address; Hetzner assigns the `/64` `2a01:4f9:c015:2f9f::/64`) |
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

`CLIENT_URL` flipping from `http://95.216.158.204` to `https://soundlog.app` was
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

**Kickstarter / App Store prerequisites, gated on email routing:** a privacy
policy page and a support contact. Both are blocked behind inbound email routing
for `hello@soundlog.app` (see the Cloudflare Email Routing item in the
post-launch checklist).

## Then — Phase 7

Now downstream of **6.2**: the mobile app consumes the Settings & Profiles API,
and account deletion in particular is what App Store review will be looking for.

What Phase 7 carries, in the order the work naturally falls:

1. **The mobile app's missing surface** — auth, release detail, and the write
   actions. Mobile currently ships a feed tab and a placeholder profile, which
   is why two 5.5 items are *blocked* rather than pending: no screen fires a
   haptic intent, and there is no release detail screen to host a native star
   input. Both are unblocked the moment those screens exist.
2. **Real icon design.** The current set is geometrically faithful and correct
   as files, but it is a placeholder — small-size optical refinement, iOS
   squircle fitting, the full platform size ladder and a monochrome cut. A
   drop-in file swap; see `apps/web/public/icons/README.md`.
3. **Navigation component.** The 380px nav wraps to three rows (~146px, ~18% of
   the viewport). Blake ruled it **good under a thumb** during the launch
   journey, so this is a nicety, not a defect — a disclosure menu or tab bar is
   a new component, not polish.
4. **Desktop half-star hit targets** — still 8×24, pre-existing and tight even
   for a mouse. Touch was fixed in 5.5; desktop was out of that brief.
5. **The post-launch checklist above**, which is dated rather than blocked.

Before starting **either phase**, read the **Production operations** section of
the README — everything from here on ships to a live site with real users' data
on it, which was not true of any previous phase. It also carries **Debugging a
production incident**, the log-first workflow that resolved the day-one rating
bug in one session.
