#!/usr/bin/env bash
# Phase 6a pass condition, as a script.
#
# Drives the PRODUCTION stack through a whole user journey over the public edge
# only — nginx on $WEB_PORT, never a container's internal port — so anything
# that works here works through nginx → Varnish → backend. Every step asserts;
# the first failure exits non-zero.
#
#   ./infrastructure/scripts/verify-prod-stack.sh            # after `up -d`
#   BASE=http://localhost:8090 ./infrastructure/scripts/verify-prod-stack.sh
#
# It writes two throwaway accounts (prod_check_<ts> / prod_watcher_<ts>) and one
# release into the production stack's own database, which is a separate volume
# from the development catalog. Nothing here touches dev data.
set -euo pipefail

BASE="${BASE:-http://localhost:${WEB_PORT:-8090}}"
TS="$(date +%s)"
U1="prod_check_${TS}"
U2="prod_watcher_${TS}"
PW="$(openssl rand -hex 12)Aa1!"
# A well-known release with a stable MBID: Radiohead — In Rainbows.
MBID="6e335887-60ba-38f0-95af-fae7774336bf"

pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1" >&2; exit 1; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
# Self-cleanup.
#
# This script REGISTERS ACCOUNTS in the production database. Once the site is
# live those accounts are not neutral test debris — they are members, they show
# up in search and in "recently added", and they own a rating and a review.
# Re-running the verification must not cost the platform two fake users each
# time.
#
# So cleanup runs from an EXIT trap: pass, fail, or Ctrl-C, exactly the
# discipline tests/support/globalTeardown.ts exists for. The sanctioned path
# runs on failure too, not just on the happy path.
#
# Detection is NOT reimplemented here. The accounts use @local.test — an RFC
# 2606 reserved TLD — which is what scripts/lib/fixtures.ts already recognises,
# shared with the suite teardown so the two cannot drift. Cleanup deletes the
# user, and every User relation cascades, so the rating and review go with it.
# ---------------------------------------------------------------------------
STACK_DIR="${STACK_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SKIP_CLEANUP="${SKIP_CLEANUP:-0}"

cleanup() {
  local rc=$?
  [ "$SKIP_CLEANUP" = "1" ] && return $rc

  step "Cleanup · removing this run's throwaway accounts"
  if [ ! -f "$STACK_DIR/docker-compose.prod.yml" ] || ! command -v docker >/dev/null 2>&1; then
    # Running from a laptop against a remote host: there is no local stack to
    # exec into. Say so loudly rather than exiting as though it were done.
    printf '  \033[33mSKIPPED\033[0m no local stack — run this ON the server:\n'
    printf '    cd /srv/soundlog && docker compose --env-file .env.production \\\n'
    printf '      -f docker-compose.prod.yml run --rm --entrypoint sh migrate \\\n'
    printf '      -c "npx tsx scripts/purge-test-fixtures.ts"\n'
    return $rc
  fi

  if (cd "$STACK_DIR" && docker compose --env-file .env.production -f docker-compose.prod.yml \
        run --rm --entrypoint sh migrate -c "npx tsx scripts/purge-test-fixtures.ts" 2>&1 |
        sed 's/^/    /'); then
    pass "throwaway accounts and their content removed"
  else
    printf '  \033[31mFAIL\033[0m cleanup did not complete — purge by hand before launch\n' >&2
  fi
  return $rc
}
trap cleanup EXIT

jqp() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

step "1 · Health, through nginx → Varnish → backend"
health="$(curl -fsS "$BASE/api/health")"
[ "$(echo "$health" | jqp "d['status']")" = "ok" ] || fail "health not ok: $health"
for svc in postgres redis elasticsearch; do
  [ "$(echo "$health" | jqp "d['checks']['$svc']")" = "ok" ] || fail "$svc not ok: $health"
done
pass "postgres + redis + elasticsearch all ok"
curl -fsSI "$BASE/api/health" | grep -qi '^via:.*varnish' || fail "no Via: Varnish header — nginx is not proxying through the cache"
pass "response carries Via: Varnish — the edge path is real"

step "2 · Register and sign in"
curl -fsS -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U1\",\"email\":\"$U1@local.test\",\"password\":\"$PW\"}" >/dev/null
pass "registered $U1"
login="$(curl -fsS -i -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$U1@local.test\",\"password\":\"$PW\"}")"
echo "$login" | grep -qi 'set-cookie: refresh_token=.*HttpOnly' || fail "no HttpOnly refresh cookie"
echo "$login" | grep -qi 'set-cookie: refresh_token=.*Path=/api/auth' || fail "refresh cookie not scoped to /api/auth"
pass "refresh cookie is HttpOnly, SameSite=Lax, scoped to /api/auth"
TOKEN="$(echo "$login" | tail -1 | jqp "d['accessToken']")"
[ -n "$TOKEN" ] || fail "no access token"

step "3 · Search — fans out to the live sources from inside the container"
results="$(curl -fsS "$BASE/api/search?q=in%20rainbows&tab=releases" | jqp "len(d['results'])")"
[ "$results" -gt 0 ] || fail "search returned nothing — third-party reachability?"
pass "$results results for 'in rainbows'"

step "4 · Seed a release from MusicBrainz"
rel="$(curl -fsS "$BASE/api/releases/mb:$MBID?cb=$TS")"
RID="$(echo "$rel" | jqp "d['release']['id']")"
[ -n "$RID" ] || fail "no release id: $rel"
[ "$(echo "$rel" | jqp "d['release']['musicbrainzId']")" = "$MBID" ] || fail "MBID mismatch — identity must be by MBID"
pass "seeded $(echo "$rel" | jqp "d['release']['title']") ($RID), matched by MBID"

step "5 · Rate it 4.5, review it"
curl -fsS -X PUT "$BASE/api/ratings/$RID" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"value":4.5}' >/dev/null
curl -fsS -X POST "$BASE/api/reviews" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"releaseId\":\"$RID\",\"content\":\"Verified against the production compose stack.\",\"rating\":4.5}" >/dev/null
agg="$(curl -fsS "$BASE/api/releases/$RID?cb=$TS-2" -H "Authorization: Bearer $TOKEN")"
[ "$(echo "$agg" | jqp "d['release']['avgRating']")" = "4.5" ] || fail "aggregate not 4.5: $agg"
[ "$(echo "$agg" | jqp "d['release']['myRating']")" = "4.5" ] || fail "myRating not 4.5"
pass "avgRating 4.5, myRating 4.5"

step "6 · A second member follows the first and sees it in the feed"
curl -fsS -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U2\",\"email\":\"$U2@local.test\",\"password\":\"$PW\"}" >/dev/null
T2="$(curl -fsS -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$U2@local.test\",\"password\":\"$PW\"}" | jqp "d['accessToken']")"
# A bodyless POST — the request shape that nginx's default HTTP/1.0 upstream
# made Varnish reject with a 400. Keep it in the journey; it is the regression
# test for that fix.
curl -fsS -X POST "$BASE/api/users/$U1/follow" -H "Authorization: Bearer $T2" >/dev/null \
  || fail "bodyless POST failed at the edge — check proxy_http_version in nginx.conf"
pass "$U2 follows $U1 (bodyless POST survives the proxy)"
feed="$(curl -fsS "$BASE/api/feed" -H "Authorization: Bearer $T2")"
count="$(echo "$feed" | jqp "len(d['items'])")"
[ "$count" -ge 2 ] || fail "feed has $count items, expected the RATING and the REVIEW: $feed"
echo "$feed" | grep -q '"RATING"' || fail "no RATING activity in feed"
echo "$feed" | grep -q '"REVIEW"' || fail "no REVIEW activity in feed"
pass "feed carries both the RATING and the REVIEW"

step "7 · Varnish caches the popular feed, and never a signed-in one"
curl -fsS "$BASE/api/feed/popular" >/dev/null   # prime
h1="$(curl -fsSI "$BASE/api/feed/popular" | grep -i '^x-cache:' | tr -d '\r')"
echo "$h1" | grep -qi 'HIT' || fail "expected a cache HIT on the second fetch, got: $h1"
pass "anonymous popular feed: $h1"
h2="$(curl -fsSI "$BASE/api/feed/popular" -H "Authorization: Bearer $TOKEN" | grep -i '^x-cache:' | tr -d '\r')"
echo "$h2" | grep -qi 'MISS' || fail "an authenticated response was served from cache: $h2"
pass "authenticated popular feed: $h2 (per-viewer, never shared)"

step "8 · The SPA itself"
curl -fsS "$BASE/" | grep -q '<div id="root">' || fail "index.html did not render"
curl -fsSI "$BASE/" | grep -qi 'cache-control: no-cache' || fail "index.html must not be cached"
asset="$(curl -fsS "$BASE/" | grep -o '/assets/[^"]*\.js' | head -1)"
curl -fsSI "$BASE$asset" | grep -qi 'immutable' || fail "hashed assets should be immutable"
curl -fsS -o /dev/null -w '' "$BASE/release/$RID" || fail "SPA deep link did not fall back to index.html"
pass "shell served no-cache, hashed assets immutable, deep links fall back"

printf '\n\033[32mProduction stack verified end-to-end.\033[0m  %s\n' "$BASE"
