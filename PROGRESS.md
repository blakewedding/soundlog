# Soundlog — Progress

Execution state. `CLAUDE.md` holds the binding patterns (read it first);
`README.md` holds the build plan and v1.1 backlog. This file is the "where are
we, what's live, what's next" for a session starting cold.

**Repo:** https://github.com/blakewedding/soundlog · `main`
**Last updated:** 2026-07-24 — **LAUNCH DAY**

## Status

# 🎉 SOUNDLOG IS LIVE AT https://soundlog.app

**Phase 6b is COMPLETE.** Phases 0 through 6b are done. The site is public,
served over TLS from a Hetzner VPS in Helsinki, with real users able to
register, verify an email address, and log music.

Suites green: **backend 231 + web 150 + mobile 38 = 419 tests**, all three
packages typecheck clean, `expo-doctor` 18/18.

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

**Next: Phase 7** — the mobile app's missing surface (auth, release detail,
write actions), real icon design, and the navigation component the 380px
three-row nav is standing in for. See the README.

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
## Next session — Phase 7

Phase 6b is done and the site is live. What Phase 7 carries, in the order the
work naturally falls:

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

Before starting, read the **Production operations** section of the README —
anything Phase 7 ships now has to be deployed to a live site with real data on
it, which was not true of any previous phase.
