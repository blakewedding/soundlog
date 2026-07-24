#!/usr/bin/env bash
# Soundlog — nightly Postgres backup.
#
#   ./infrastructure/scripts/backup-db.sh            # write one dump, prune old ones
#   RETAIN_DAYS=30 ./infrastructure/scripts/backup-db.sh
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
if ! "${COMPOSE[@]}" exec -T postgres pg_restore -l /dev/stdin < "$TMP" > /dev/null 2>&1; then
  rm -f "$TMP"
  log "FAILED: dump did not verify with pg_restore -l — no file kept"
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
