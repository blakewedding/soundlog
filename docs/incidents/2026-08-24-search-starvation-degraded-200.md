# Search returned nothing, and a wedged page said "assembling" forever

**Date:** 2026-08-24 · **Phase:** 6.3e · **Commits:** `80e6218`, `1440c87`
**Reported:** three artists unfindable site-wide (The Chromatics, The Blue Nile,
Xiu Xiu); Bob Dylan's artist page stuck at "Fetching from MusicBrainz — 200 of
1192 releases (17%)".

---

## Summary

Two independent faults, both of which reduce to the same mistake: **a state that
we could not tell apart from a different state, rendered as that different
state.**

1. **Search.** An unreachable MusicBrainz and a genuinely unknown artist produced
   the identical empty array, and the empty array was cached for a week.
2. **The Dylan wedge.** A starved background job and a job making progress
   produced the identical `assembling` response, forever, because nothing had
   *failed*.

Neither was detected by monitoring. Every component reported health throughout:
Elasticsearch green, Postgres up, the API returning HTTP 200, MusicBrainz
answering a manual `curl` with 200, and no error logs — because **an empty
result is not an error**.

---

## Root causes

### 1. A degraded 200 cached as a definitive answer for seven days

MusicBrainz answers `?query=` from a **Solr index that is a separate service
from its main database and fails independently**. When that index is degraded it
does not return an error — it returns **HTTP 200 with zero results**, which is
byte-identical to "no such artist".

`searchMusicBrainzArtists` did `return data?.artists ?? []` *inside*
`cached(key, WEEK, …)`. So one bad minute upstream wrote `[]` to
`mb:artist:search:<query>` and every visitor read "this artist does not exist"
for the next seven days.

This only became user-visible because of a second property: `searchArtists` is
Elasticsearch-first with a MusicBrainz fan-out, and **the artist index only ever
contains artists we have already seeded**. For an un-seeded artist the entire
result rests on that one cached call. Bob Dylan was unaffected precisely because
he *is* seeded and never reaches the fan-out — which is why the symptom looked
arbitrary rather than systemic.

The same hole existed in `findReleaseGroupMbid`. Its 6.2e fix moved the `try`
outside `cached()` so a *thrown* failure was not cached — but a degraded 200
does not throw: `top` is `undefined`, `null` is returned, and `null` was cached
for a week. Under §3 no MBID means no `caa:rg:urls:<mbid>` lookup, so **cover art
failed through the same hole as search**.

`searchReleaseGroups` had it too, and worse: because it swallowed
`UpstreamUnavailableError` into `[]`, and `musicbrainzSource.search` is its only
caller, `searchCatalog`'s "every source failed" check — which counts sources that
*threw* — was **structurally unreachable for the primary source**.

### 2. A tripwire that could only fire after the fault ended

`upstreamPriority.ts` documented, deliberately, that strict priority can starve
`browse` work and that measuring the wait was sufficient:

> "Rather than build ageing for a load this site does not have, the wait is
> **measured and logged**: `starvationWarnMs` turns a hypothetical into a log
> line the day it stops being hypothetical."

The measurement was taken in `take()` — **at dispatch**:

```ts
const waiter = this.queues[tier].shift();
const waited = Date.now() - waiter.queuedAt;
if (tier !== "interactive" && waited >= this.starvationWarnMs) { … }
```

A waiter that is never dispatched is never shifted, so `waited` is never
computed. **The warning could only ever report starvation that had already
ended.** During the Dylan wedge it emitted nothing at all, and its silence read
as health.

This is the finding worth keeping from the whole incident. A tripwire that fires
on recovery rather than on the fault is **worse than no tripwire**, because it is
trusted. Pinned now by a test verified to fail against the old line.

### 3. No watchdog: "in progress" was a state with no exit

Discography assembly runs at the `browse` tier. Under sustained interactive load
page 3 never won a slot, `onProgress` never fired again, and the `Assembly`
carried no error *because nothing had failed*. Every poll answered
`{status: "assembling", progress: {fetched: 200}}` indefinitely.

`enrichmentState.ts` had modelled `pending`/`ready`/`failed` correctly since
6.1.1 — but discography assembly had its own in-flight registry that had never
been given the same treatment.

### 4. Cover renditions keyed by a URL whose scheme varied

The Cover Art Archive serves `image` as **cleartext `http://`** on older records
(`Neu! ’75` is one). `ensureVariant` keys the disk cache on
`sha256(upstreamUrl)`. Every persist path normalises the scheme with
`toSecureUrl` first; the nightly warm sweep did not.

```
warm sweep wrote  sha256("http://…")  -> w400/b2/b2ac3a1b….webp
serving route read sha256("https://…") -> w400/f0/f0ea25d6….webp
```

Same image, two entries. For every cleartext-CAA cover the sweep did the full
fetch-and-encode, stored it where nothing would read it, and charged it **twice**
against the LRU bound — while the visitor still paid full cold cost on precisely
the covers we had "warmed". It reported success throughout.

### 5. Name-derived cache keys with an unescaped delimiter

`discogs:covermatch:v4:${artist}:${title}` and three siblings interpolated raw
values around a `:` delimiter:

```
artist "Songs: Ohia", title "Didn't It Rain"     -> …:songs: ohia:didn't it rain
artist "Songs",       title "Ohia:Didn't It Rain" -> …:songs: ohia:didn't it rain
```

`Songs: Ohia` is in the catalog today, and that key holds an **artwork URL** — so
a collision serves one record's sleeve for another. The wrong-cover failure §3
exists to prevent, arriving through the cache rather than through identity
resolution.

---

## The four premises that did not survive

Each arrived as a confident diagnosis. Recording them because the *refutations*
were the fastest route to the real cause.

| Premise | Evidence against it |
|---|---|
| Hollow or dropped Elasticsearch index | Counts matched Postgres exactly: artists 68/68, releases 168/168, cluster green |
| The three artists were never ingested, therefore invisible | True that all three are absent from both stores — but the MusicBrainz fan-out exists *precisely* for un-seeded artists, and it works: traced end to end, all three returned 8 correct results with the right artist first |
| A serialized ingest worker wedged behind the Dylan job, with the three artists queued behind it | **There is no ingest queue.** The only BullMQ queue is `soundlog-activity` (social fan-out); no worker container in either compose file; ingest is synchronous and in-request. Nothing was queued behind anything |
| Job lifecycle states (`pending`/`complete`/`failed`) are missing and must be built | `enrichmentState.ts` has implemented exactly that, with a sticky `failed`, since 6.1.1 |

A fifth, from the original brief: **the Bob Dylan cover-art "poisoning" never
happened.** PROGRESS.md 6.3c records that hypothesis as refuted — what looked
like blank art was load progress on un-seeded tiles. There was no poisoning sweep
to re-run, and this incident found no poisoned entries either: 118
`caa:rg:urls:*` keys scanned, 112 legitimate cached nulls, and `cached()`
provably cannot write on a throw.

**Bug 3's discriminator matched neither branch it was given.** Postgres held
**1** Dylan release, not ~200 (ingest truncation) and not ~1192 (display paging).
There is no `200` limit anywhere in backend or web; `MAX_BROWSE_PAGES` is 40
(cap 4,000). 200 is exactly two pages of `BROWSE_PAGE_SIZE`, and the "1192" is
MusicBrainz's own `release-group-count` surfaced through `onProgress` — a total
from one source sitting above a list from another.

---

## Two near-misses, both about tests reporting health they never measured

These belong in this document because they are the same failure as the tripwire,
one layer over.

### The defanged assertion

Renaming the release-group match key to `v2` (for the delimiter fix above)
silently neutered an existing assertion. `discoveryCaching.test.ts` rebuilt the
key **by hand in the old format**:

```ts
expect(await redis.get(`mb:rg:match:${artist}:${title}`.toLowerCase())).toBeNull();
```

After the rename that reads a key nothing ever writes, so it passes
unconditionally — and would have kept passing if the caching bug returned. The
suite stayed green and lost a guarantee. The key is now exported
(`releaseGroupMatchCacheKey`) so the test asserts against the string the
implementation actually writes.

### NULL is not "we never asked" — and Prisma cannot say otherwise

The alias backfill skipped the write when MusicBrainz reported no aliases, so 23
rows kept SQL `NULL` while 45 held values — making "checked, genuinely none"
indistinguishable from "never checked", with the Redis cursor as the only record
of progress.

The first fix was wrong in an instructive way. It guarded on
`artist.aliases === null`, which **can never be true**: Prisma coerces a NULL
scalar list to `[]` on read. Verified directly — Prisma reports `[]` for a row
where SQL says `aliases IS NULL` is `t`. The distinction is unrepresentable
through the client no matter what is stored, so leaving NULLs preserved a
difference nothing could observe.

Fixed at the schema level (`@default([])` plus a migration normalising existing
rows) rather than in application code. **A distinction your data layer cannot
express is not a distinction you have.**

---

## Measurements

- **MusicBrainz returned 503 on 37 of 68 requests (54%)** during the alias
  backfill, ~20:15–20:20 UTC. `lookupArtist` retries four times and survived
  every one (0 failures); a discovery search gets **one** attempt. That asymmetry
  is the mechanism by which a flaky upstream became "this artist does not exist".
- `mb:artist:search:xiu xiu` TTL measured at **604,632s = 7.0 days**.
- 118 `caa:rg:urls:*` keys: 112 cached nulls, 5 https, 1 cleartext — the cleartext
  one being `Neu! ’75` itself.
- Article-fallback mechanism reproduced against the live index with the verbatim
  production query shape: `"Swans"` → 1 hit, `"The Swans"` → **0 hits**.

---

## Fixes shipped

| Area | Change |
|---|---|
| Cache | `CacheTtl` gains `{full, thin, isThin}`. Empty searches live 10 minutes, real results a week. `refresh: true` keeps the full TTL — the warm sweep re-asks nightly, and short-lived search layers would make every target look permanently due (6.2g from the other side) |
| Error semantics | `searchMusicBrainzArtists` / `searchReleaseGroups` propagate instead of swallowing. `searchArtists` serves seeded results when it has them, surfaces the outage when it has none. `searchCatalog` throws only when *every* source failed and nothing is seeded → 503 + `Retry-After`. **Still one attempt** (§7) — this was never about trying harder |
| Scheduling | Priority ageing (`AGE_PROMOTION_MS`, 15s) bounds the low tiers' wait. Reorders only; the 1 req/s rate is untouched |
| Observability | Starvation sampled from `pump()` **while the waiter is still queued**, routed through `onStarvation()` so it can page instead of whisper |
| Jobs | Discography assembly gets a heartbeat and a 90s watchdog → terminal `DiscographyStalledError` |
| Health | `/api/health/upstream`: queue depth, **oldest-wait**, in-flight assemblies and their age, starvation counters. Depth says how busy; age says whether anything is *stuck* |
| Search | Leading-article zero-result fallback — never an analyzer rule, because `The The`, `The Who` and `The Band` are artists whose names *are* the article |
| Search | Artist aliases: column, ES field added to the live mapping via `putMapping`, resumable rate-safe backfill (68/68 accounted: 45 with aliases, 23 explicitly none) |
| Covers | `toSecureUrl` in the warm path, so one image has one cache entry |
| Covers | `keyPart()` encodes name-derived key parts |
| UI | Degraded state distinct from empty: its own banner, `role="alert"`, gold accent edge (7.05:1, computed), retry affordance, auto-retry honouring `Retry-After`, and shown during retries via `failureReason` rather than only after they exhaust |

**A finding worth stating plainly:** MusicBrainz does **not** list "The
Chromatics" as an alias for Chromatics — its only alias is `KRMTX` — and three
*unrelated* bands are literally named "The Chromatics". Alias indexing, specified
as the primary fix, does not fix the reported bug. The article fallback does.
Aliases were shipped anyway for coverage (`MBV`, `Floyd`, `ピンク・フロイド`, `ae`,
`オウテカ`, `Radio Head` → Radiohead) but should never have been sold as the fix.

---

## Laws this validated, and the gap that let it hide

**Caught things, or would have:**

- **§1 (three outcomes)** is the law this whole incident is about, and it held
  everywhere it had been *applied*. `cached()` provably cannot write on a throw;
  `mbFetch` distinguishes definitive from retryable correctly; `errorHandler`
  maps `UpstreamUnavailableError` to 503 + `Retry-After`. The bug was in call
  sites that collapsed the third outcome back into the second **after** the
  machinery had correctly produced it.
- **§2 (never cache a partial assembly)** worked exactly as designed —
  `assembleDiscography` threw rather than persisting a short read, which is why
  the Dylan wedge was a hang and not silent data loss.
- **§3 (MBID-only identity)** meant the cover pipeline had almost nothing to fix:
  `caa:rg:urls:<mbid>`, the proxy path, and the disk cache are all
  identity-derived. The two defects found were at the *edges* of that discipline
  — a URL scheme and a key delimiter — not in identity itself.
- **§5 (Postgres is truth)** made the "hollow index" hypothesis cheap to refute
  and made the canary's drift check obvious to write.
- **§9 (flag deliberate test-contract changes)** did real work: three changes
  flagged, and the discipline of writing them down is what surfaced the defanged
  assertion.
- **§10 (read-back before a destructive query)** was applied to the alias
  migration's `UPDATE` and to every cache deletion in this investigation.

**The gap: there is no law about observability of silent degradation.**

Every CLAUDE.md rule governs what the code must *do*. None governs what the
system must be able to *say about itself* — and both faults here were invisible
precisely because the silent path was the successful one:

- a degraded 200 went down the success path and logged **nothing**;
- a starved waiter was never dispatched and so was never **measured**;
- a warm sweep wrote to an unread cache key and reported **success**;
- `docker compose logs` only holds the current container, so a deploy **destroys**
  the evidence needed to date the onset.

The nearest existing rule, §5's "Log ES failures with enough detail to diagnose",
is about a *failure* that we already know occurred. The condition that hurt here
is the one where nothing failed. A candidate rule, offered rather than assumed:

> **A degraded success must be as visible as a failure.** Any path that can
> return a *thin but successful* answer from a third party — an empty search, a
> short list, a partial assembly — must either distinguish that answer in its
> response or emit a signal that it happened. A metric that can only be observed
> at completion cannot describe a thing that never completes.

---

## Follow-ups

| # | Item | Status |
|---|---|---|
| 1 | **The 54% question.** Determine whether MB's 503 rate is load-shaped (ours) or upstream health. **No gate changes ship until prod-side measurement exists.** See proposal below | **Open — blocked on measurement** |
| 2 | **`push` ≠ `deploy`.** There is no CI/CD in this repo — no `.github/workflows`, no auto-deploy. Pushing to `main` publishes code and nothing else; production is deployed by hand. This is why `search-canary.ts` could not be wired in as a required post-deploy gate: there is no pipeline to wire it into | **Open** |
| 3 | Wire `search-canary.ts` in as a required post-deploy gate (exits non-zero on failure; verified by deleting an ES doc → `FAIL find artist "Autechre"`, exit 1) | **Blocked on #2**; run manually after every deploy meanwhile |
| 4 | Per-page offset checkpointing for discography assembly — a retry still restarts at page 1 and re-spends the MB budget | Open |
| 5 | Production onset dating — needs prod logs; see the Redis-TTL method, which survives log rotation and dates poisonings precisely | Open |
| 6 | Release-search analyzer asymmetry: `autocomplete_search` uses the letter-only `lowercase` tokenizer, so `Neu! '75` and `Neu! 75` both tokenize to `["neu"]`. The index side sets `token_chars: ["letter","digit"]`, so indexed digits can **never** be matched | Open |
| 7 | The MB gate bounds dispatch **rate** but not **concurrency**, unlike the CAA gate. Slow upstream responses mean unbounded in-flight requests | Open — folded into #1 |

### Proposal for #1 — measure before retuning

Deliberately **not implemented**. The 54% sample was taken from a single window,
single IP, **strictly sequential and rate-compliant** (one request in flight,
≥1.1s apart, `background` tier). That makes it more alarming, not less: we were
provably polite and still saw 54%. It also means gate retuning may not help at
all, because the sample cannot distinguish "our pattern is wrong" from
"MusicBrainz was unwell today".

**What we know about our own compliance:**

| | |
|---|---|
| Dispatch spacing | `MIN_REQUEST_GAP_MS = 1100` → 0.909 req/s, under MB's 1/s |
| Retries | Ride the same gate — a retry cannot exceed the rate |
| User-Agent | `Soundlog/0.1.0 (hello@soundlog.app)` — app, version, contact. Compliant |
| Concurrency | **Unbounded.** The gate spaces *starts*, not in-flight requests |
| `Retry-After` | **Ignored.** Backoff is fixed exponential (250ms → 2s) |
| Coalescing | **Absent.** `cached()` has no in-flight dedupe, so N simultaneous identical misses make N upstream calls |
| Fan-out per search | `tab=all` issues 2 concurrent MB calls (artist search + release-group search) |
| Discography burst | `ceil(N/100)` sequential calls — 12 for Dylan, ~13.2s minimum |

**Step 1 (proposed first, cheap, ships alone): instrument, don't tune.** Add
rolling counters to `/api/health/upstream`:

- requests by tier and by outcome (`ok` / `retryable` / `definitive` / `threw`)
- HTTP status histogram, 503 specifically
- observed inter-request gap (p50/p99) — proves what we *actually* emit, versus
  what the gate is configured to permit
- retry counts, and how often a retry succeeded
- **`Retry-After` values MB sends us**, which is the clearest signal of whether
  it considers us the problem
- rolling windows (1m / 15m / 24h) so a spike is distinguishable from a baseline

That turns the retuning decision into an evidence-based one and costs a few
counters. **It also tests the hypothesis directly:** if prod's 503 rate is near
54% while p50 inter-request gap is ≥1.1s, the cause is not our rate.

**Step 2 (only if the data justifies it):**

- **Request coalescing** in `cached()` — an in-flight map keyed by cache key, so
  simultaneous identical misses share one upstream call. `coverCache` and
  `discographyService` already do this; `cached()` is the gap. Expected impact:
  strictly fewer upstream calls, no latency cost, and the biggest win exactly
  when load is highest. This is the one change I would argue for regardless.
- **Honour `Retry-After`** on 503 with jitter, instead of fixed exponential
  backoff. Expected impact: slightly longer worst-case search latency, materially
  less pressure during an upstream incident.
- **Bound MB concurrency** as well as rate, mirroring `coverArtGate`.
- **Gate retuning** (raising `MIN_REQUEST_GAP_MS` for headroom) **last, and only
  if the gap data shows we are exceeding 1 req/s in practice.** Expected cost:
  proportional slowdown of prolific-artist assembly — Dylan's 12 pages go from
  ~13.2s to ~14.4s at 1.2s spacing — for no benefit if the 503s are upstream-side.
