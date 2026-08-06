#!/usr/bin/env bash
#
# Soundlog — warm-fleet health check (6.2g).
#
# Answers the four questions that six nights of clean sweep logs could NOT
# answer, because a success count describes intentions rather than results:
#
#   1. did the last sweep run, and what did it claim
#   2. does any target carry a non-ok lastResult
#   3. are the fleet's TTLs SPREAD, or bunched into one expiry cliff
#   4. is the canary target's search layer being refreshed
#
# Question 3 is the one that matters. Before the 6.2g fix, 1,890 of 1,960 warmed
# layers sat inside the 26-hour refresh window simultaneously and every nightly
# log still read `0 with failures`. Bunching is the signal; the counts are not.
#
# Read-only: SELECTs and Redis TTL reads. It changes nothing, so it is safe to
# run by hand at any time.
#
# Installed as a ROOT CRON entry, deliberately, and not as anything session-
# bound — the predecessor to this script was an in-memory scheduler inside a
# Claude session, which died with the session and took the check with it. This
# lives next to backup-db.sh and is scheduled the same way, because that entry
# has fired every night without supervision.
#
#   53 11 * * * /srv/soundlog/infrastructure/scripts/warm-health.sh >> /var/log/soundlog-warm-health.log 2>&1
#
# 11:53 UTC is 07:53 US/Eastern. The box runs UTC; cron has no TZ set.

set -uo pipefail

PG=soundlog-prod-postgres-1
RD=soundlog-prod-redis-1
API=soundlog-prod-backend-1

# The canary. Its search layer degraded under a MusicBrainz 503 during the first
# refreshed run and was correctly NOT cached (§1), so it is the target most
# likely to reveal a search layer that is silently not being refreshed.
CANARY_NAME="the beatles"
CANARY_MBID="b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d"

echo "════════════════════════════════════════════════════════════════"
echo "warm-health  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "════════════════════════════════════════════════════════════════"

echo
echo "── 1. last sweep ───────────────────────────────────────────────"
docker logs "$API" --timestamps --since 48h 2>&1 |
  grep -E '\[warm\] (warmed|artist pre-warming)' | tail -3 ||
  echo "  (no [warm] lines in the last 48h — the timer resets on every container"
echo "   recreate, so a recent deploy delays the first sweep by up to 24h)"

echo
echo "── 2. lastResult ───────────────────────────────────────────────"
# `lastResult` is free-form text ("ok: 32 release-groups, 14 covers"), never the
# literal "ok" — matching on equality reports every row as failed.
docker exec "$PG" psql -U soundlog -d soundlog -t -A -P pager=off -c \
  "SELECT 'ok=' || count(*) FILTER (WHERE \"lastResult\" LIKE 'ok:%')
        || '  failed=' || count(*) FILTER (WHERE \"lastResult\" IS NOT NULL AND \"lastResult\" NOT LIKE 'ok:%')
        || '  no_result=' || count(*) FILTER (WHERE \"lastResult\" IS NULL)
        || '  of ' || count(*) FROM \"WarmTarget\" WHERE enabled;" |
  sed 's/^/  /'
docker exec "$PG" psql -U soundlog -d soundlog -t -A -P pager=off -c \
  "SELECT '  NOT OK: ' || name || ' — ' || COALESCE(\"lastResult\",'(null)')
     FROM \"WarmTarget\"
    WHERE enabled AND (\"lastResult\" IS NULL OR \"lastResult\" NOT LIKE 'ok:%') LIMIT 20;"

echo
echo "── 3. TTL spread (the cliff detector) ──────────────────────────"
docker exec "$PG" psql -U soundlog -d soundlog -t -A -F'|' -P pager=off -c \
  'SELECT name, "artistMbid" FROM "WarmTarget" WHERE enabled;' |
  python3 -c '
import sys, subprocess
from collections import Counter

RD = "'"$RD"'"
rows = [l.strip().rsplit("|", 1) for l in sys.stdin if l.strip() and "|" in l]

keys, meta = [], []
for name, mbid in rows:
    for label, k in (("discography", "mb:artist:discography:%s" % mbid),
                     ("artist:v2",   "mb:artist:v2:%s" % mbid),
                     ("search.artist","mb:artist:search:%s" % name.lower()),
                     ("search.rg",   "mb:rg:search:%s" % name.lower())):
        keys.append(k); meta.append(label)

def q(k):
    return "\"%s\"" % k.replace("\\", "\\\\").replace("\"", "\\\"")

out = subprocess.run(["docker","exec","-i",RD,"redis-cli"],
                     input="".join("TTL %s\n" % q(k) for k in keys),
                     capture_output=True, text=True).stdout
ttls = [int(v) for v in out.split() if v.lstrip("-").isdigit()]
if len(ttls) != len(keys):
    print("  WARN: %d ttls for %d keys" % (len(ttls), len(keys)))

HOUR = 3600.0
short = Counter(); band = Counter()
for label, t in zip(meta, ttls):
    if t < 0 or t < 26 * HOUR: short[label] += 1
    band[int(max(t,0) // HOUR // 12) * 12] += 1

total = len(ttls)
print("  buckets (12h):")
for lo in sorted(band):
    print("    %3d-%3dh  %4d  %s" % (lo, lo + 12, band[lo], "#" * (band[lo] // 8)))
occupied = sum(1 for v in band.values() if v)
top = max(band.values()) if band else 0
print()
print("  %d keys across %d occupied buckets; largest bucket %d (%.0f%%)"
      % (total, occupied, top, 100.0 * top / total if total else 0))
if total and top > total * 0.5:
    print("  *** BUNCHED — over half the fleet expires in one 12h window.")
    print("  *** This is the 6.2g cliff shape. Check that warming still passes")
    print("  *** refresh+jitter (warmService WARM_CACHE_OPTS).")
else:
    print("  spread looks healthy (no bucket holds a majority).")
print()
print("  below the jittered band (TTL < 26h or absent), by layer:")
for label in ("discography", "artist:v2", "search.artist", "search.rg"):
    flag = "" if short[label] == 0 else "   <-- not refreshing"
    print("    %-14s %4d%s" % (label, short[label], flag))
print("  NOTE: search.* are DISCOVERY layers. Under §7 they get one attempt and")
print("  degrade to empty, and under §1 a degraded answer is not cached — so a")
print("  MusicBrainz 503 leaves them on their OLD ttl while the sweep still")
print("  reports ok. A persistent count here is that gap, not a new bug.")
'

echo
echo "── 4. canary: The Beatles ──────────────────────────────────────"
for k in "mb:artist:search:$CANARY_NAME" "mb:rg:search:$CANARY_NAME" \
         "mb:artist:v2:$CANARY_MBID" "mb:artist:discography:$CANARY_MBID"; do
  t=$(docker exec "$RD" redis-cli TTL "$k")
  printf "  %-64s %8s s  %6.1f h\n" "$k" "$t" "$(echo "$t/3600" | bc -l)"
done

echo
echo "── done ────────────────────────────────────────────────────────"
