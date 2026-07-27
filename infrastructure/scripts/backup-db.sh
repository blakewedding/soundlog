#!/usr/bin/env bash
# Soundlog — nightly backup: Postgres, and (since 6.2) user avatars.
#
#   ./infrastructure/scripts/backup-db.sh            # write both, prune old ones
#   RETAIN_DAYS=30 ./infrastructure/scripts/backup-db.sh
#
# The name is now slightly wrong — it is no longer Postgres-only. It is kept
# anyway because the production crontab and the README both invoke it by this
# path, and a rename that needs a cron edit to take effect is a rename that
# silently stops backing anything up if the edit is missed.
#
# ## Why avatars are here and the cover cache is not
#
# `prod_covercache` is deliberately excluded from all of this: every rendition
# in it is re-fetchable from `Release.coverUrl`, which the dump below already
# captures, so archiving images would inflate the backups to no purpose.
#
# Avatars look like the same kind of thing and are the opposite kind of thing.
# They have NO upstream. The bytes in `prod_avatars` are the only copy that
# exists anywhere, which makes them the first non-regenerable bytes-on-disk this
# stack has held. Inheriting the cover cache's exclusion by accident would be a
# single point of data loss that nobody discovers until a restore — which is the
# worst possible moment to discover it.
#
# Only `master/` is archived. The `w<width>/` renditions are derived from it on
# demand and rebuild themselves on first request, so archiving them nightly
# would be paying for the same picture five times.
#
# Run from cron on the production host. Postgres publishes no port (it is
# cluster-internal by design), so the dump goes through `compose exec` rather
# than a TCP connection — which also means this works unchanged if the password
# is rotated, since it never handles one.
#
# Two deliberate choices:
#
#   * `pg_dump -Fc` (custom format), not plain SQL. It is compressed, and
#     pg_restore can then do selective and parallel restores — which is what you
#     want at 3am when only one table is wrong.
#   * The dump is written to a temp name and moved into place only on success.
#     A backup directory must never contain a truncated file that looks like a
#     backup; the whole point is that its contents are trustworthy without
#     inspection. Same reasoning as `cached()` writing only on return.
set -euo pipefail

STACK_DIR="${STACK_DIR:-/srv/soundlog}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/soundlog}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
COMPOSE=(docker compose --env-file "$STACK_DIR/.env.production" -f "$STACK_DIR/docker-compose.prod.yml")
# The avatar volume, by its full docker name (compose project `soundlog-prod` +
# volume `prod_avatars`). Addressed directly rather than through `compose exec
# backend` so that avatars are still archivable when the API container is down
# — a backup that only runs while the app is healthy is a backup that fails on
# exactly the nights you need it. Overridable so the restore drill can point at
# a scratch volume.
AVATAR_VOLUME="${AVATAR_VOLUME:-soundlog-prod_prod_avatars}"
# Reuse an image the stack already has locally. A backup step that begins with
# an image pull is a backup step that fails when the registry does.
AVATAR_TAR_IMAGE="${AVATAR_TAR_IMAGE:-postgres:16-alpine}"

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

cd "$STACK_DIR"

# Credentials come from the env file, never a command line — a password in
# `docker compose exec -e PGPASSWORD=...` is visible in `ps` to every user on
# the box (§7: secrets live in .env).
PGUSER="$(grep -E '^POSTGRES_USER=' .env.production | cut -d= -f2-)"
PGDB="$(grep -E '^POSTGRES_DB=' .env.production | cut -d= -f2-)"
: "${PGUSER:?POSTGRES_USER missing from .env.production}"
: "${PGDB:?POSTGRES_DB missing from .env.production}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"   # dumps contain every user row and password hash

STAMP="$(date -u +%Y%m%d-%H%M%SZ)"
FINAL="$BACKUP_DIR/soundlog-$STAMP.dump"
TMP="$FINAL.partial"

log "dumping $PGDB → $(basename "$FINAL")"
if ! "${COMPOSE[@]}" exec -T postgres pg_dump -U "$PGUSER" -d "$PGDB" -Fc > "$TMP"; then
  rm -f "$TMP"
  log "FAILED: pg_dump returned non-zero — no file kept"
  exit 1
fi

# A dump that cannot be listed is not a backup. pg_restore -l parses the archive
# header and table of contents, so this catches truncation and corruption that a
# zero-exit pg_dump can still leave behind on a full disk.
#
# It must read a REAL FILE, on the host. The first version of this piped the dump
# into `pg_restore -l /dev/stdin` inside the container and failed every time with
# "did not find magic string in file header" — a custom-format archive has to be
# SEEKABLE, and a pipe is not. The dump was perfectly valid; the check was wrong,
# and because the check deletes on failure it would have thrown away a good
# backup every night. A verification step that reports a working thing as broken
# is worse than no verification at all.
verify_archive() {
  if command -v pg_restore > /dev/null 2>&1; then
    pg_restore -l "$1" > /dev/null 2>&1
    return $?
  fi
  # Fallback when postgresql-client is not installed: check the custom-format
  # magic string and a plausible size. Weaker than parsing the table of
  # contents, so say so rather than implying a full verification happened.
  log "note: pg_restore not on PATH — falling back to a header check only"
  # `stat -c%s` is GNU, `stat -f%z` is BSD/macOS. The production host is Linux,
  # so only the first is ever used there — but an unportable size check makes
  # this branch report a perfectly good dump as corrupt anywhere else, and
  # because the caller DELETES on failure that is the one bug in this script
  # that destroys a working backup. Same lesson as the /dev/stdin mistake above:
  # a verification step that fails a healthy artefact is worse than none.
  local size
  size="$(stat -c%s "$1" 2>/dev/null || stat -f%z "$1" 2>/dev/null || echo 0)"
  [ "$(head -c 5 "$1")" = "PGDMP" ] && [ "${size:-0}" -gt 1024 ]
}

if ! verify_archive "$TMP"; then
  rm -f "$TMP"
  log "FAILED: dump did not verify as a readable pg_dump archive — no file kept"
  exit 1
fi

mv "$TMP" "$FINAL"
chmod 600 "$FINAL"
log "ok: $(du -h "$FINAL" | cut -f1)"

# Prune only VERIFIED dumps; a stray .partial is left alone so its presence
# stays visible as evidence something went wrong.
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -name 'soundlog-*.dump' -mtime "+$RETAIN_DAYS" -print -delete | wc -l | tr -d ' ')"
log "retention: ${RETAIN_DAYS}d, pruned $DELETED"
log "on disk: $(find "$BACKUP_DIR" -maxdepth 1 -name 'soundlog-*.dump' | wc -l | tr -d ' ') dump(s), $(du -sh "$BACKUP_DIR" | cut -f1)"

# ---------------------------------------------------------------------------
# Avatars (6.2). See the header for why these are backed up and covers are not.
#
# From here on a failure exits non-zero but LEAVES THE DUMP IN PLACE: the
# database backup above already succeeded and is already verified, and throwing
# it away because a second, independent artefact failed would be trading a
# working backup for a tidy exit code.
# ---------------------------------------------------------------------------

AVATAR_FINAL="$BACKUP_DIR/avatars-$STAMP.tar.gz"
AVATAR_TMP="$AVATAR_FINAL.partial"

if ! docker volume inspect "$AVATAR_VOLUME" > /dev/null 2>&1; then
  log "FAILED: avatar volume '$AVATAR_VOLUME' does not exist — avatars NOT backed up"
  log "note: the Postgres dump above succeeded and has been kept"
  exit 1
fi

# PREDICT THE COUNT BEFORE ARCHIVING.
#
# `tar tzf` proves an archive is not truncated. It cannot prove the archive has
# the right contents in it, and an empty tarball lists perfectly cleanly — which
# is the failure this check exists for: a wrong volume name, an unmounted
# volume, or a path that moved all produce a valid, verifiable, empty backup
# that nobody notices until a restore. Postgres knows how many avatars there are
# supposed to be, so ask it rather than assuming.
#
# Same discipline as verify-prod-stack.sh predicting the aggregate, and the same
# lesson as `[prewarm] warmed N`: a line that reads identically whether it did
# everything or nothing is not evidence.
EXPECTED="$("${COMPOSE[@]}" exec -T postgres psql -U "$PGUSER" -d "$PGDB" -tAc \
  'SELECT count(*) FROM "User" WHERE "avatarUrl" IS NOT NULL' 2>/dev/null | tr -d ' \r')"
: "${EXPECTED:=unknown}"

log "archiving avatars from $AVATAR_VOLUME (expecting $EXPECTED master file(s))"

# `.` with `--exclude`, not `master` directly: before the first upload there is
# no master/ directory at all, and `tar -C /src master` would fail on a stack
# that is simply new rather than broken. The exclude keeps the derived
# renditions out — they rebuild on first request.
if ! docker run --rm -v "$AVATAR_VOLUME:/src:ro" "$AVATAR_TAR_IMAGE" \
  tar czf - -C /src --exclude='./w*' . > "$AVATAR_TMP" 2>/dev/null; then
  rm -f "$AVATAR_TMP"
  log "FAILED: could not archive the avatar volume — no file kept"
  log "note: the Postgres dump above succeeded and has been kept"
  exit 1
fi

# Truncation check, the tar equivalent of `pg_restore -l`.
if ! tar tzf "$AVATAR_TMP" > /dev/null 2>&1; then
  rm -f "$AVATAR_TMP"
  log "FAILED: avatar archive did not verify as a readable tarball — no file kept"
  log "note: the Postgres dump above succeeded and has been kept"
  exit 1
fi

ACTUAL="$(tar tzf "$AVATAR_TMP" 2>/dev/null | grep -c '\.webp$' || true)"

# The hard failure: Postgres says there are avatars and the archive has none.
# That is the silent-single-point-of-data-loss case, and it is worth failing
# loudly for even though the tarball itself is perfectly well-formed.
if [ "$EXPECTED" != "unknown" ] && [ "$EXPECTED" -gt 0 ] && [ "$ACTUAL" -eq 0 ]; then
  rm -f "$AVATAR_TMP"
  log "FAILED: $EXPECTED user(s) hold an avatar but the archive contains 0 — no file kept"
  log "        check AVATAR_VOLUME ($AVATAR_VOLUME) and AVATAR_DIR in the compose file"
  log "note: the Postgres dump above succeeded and has been kept"
  exit 1
fi

mv "$AVATAR_TMP" "$AVATAR_FINAL"
chmod 600 "$AVATAR_FINAL"   # user-supplied photographs

# A softer mismatch is a warning, not a failure. An upload or a deletion landing
# between the count and the tar moves this by one in either direction, and
# failing a good backup over a benign race is how a verification step teaches
# people to ignore it.
if [ "$EXPECTED" != "unknown" ] && [ "$ACTUAL" -lt "$EXPECTED" ]; then
  log "WARNING: archived $ACTUAL master file(s), expected $EXPECTED — check for a mid-run change"
fi

log "ok: avatars $(du -h "$AVATAR_FINAL" | cut -f1), $ACTUAL master file(s) of $EXPECTED expected"

AV_DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -name 'avatars-*.tar.gz' -mtime "+$RETAIN_DAYS" -print -delete | wc -l | tr -d ' ')"
log "avatar retention: ${RETAIN_DAYS}d, pruned $AV_DELETED"
log "on disk: $(find "$BACKUP_DIR" -maxdepth 1 -name 'avatars-*.tar.gz' | wc -l | tr -d ' ') avatar archive(s), $(du -sh "$BACKUP_DIR" | cut -f1) total"
