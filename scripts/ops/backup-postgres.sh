#!/usr/bin/env bash
# Encrypted, off-site PostgreSQL backup (S-6). Run nightly from the repo
# root on the server, e.g. via cron:
#   15 3 * * * cd /path/to/mcfinancial && ./scripts/ops/backup-postgres.sh >> /var/log/mc-backup.log 2>&1
#
# What it does
#   1. pg_dump (custom format) of the production database;
#   2. encrypts it with age to the club's backup PUBLIC key(s). The matching
#      private key is kept offline (see docs/operations/backup-and-restore.md), so this
#      server can write backups but cannot read them;
#   3. copies the encrypted file off-site with rclone (object storage);
#   4. keeps a short local copy and pings a health check, if configured.
#
# Configuration: environment variables, or a .env.backup file next to
# docker-compose.hetzner.yml (never committed):
#   BACKUP_AGE_RECIPIENTS_FILE  file with one age public key per line (age1...)   [required]
#   BACKUP_REMOTE               rclone destination, e.g. mcbackup:mc-club-backups/postgres
#                               [required unless BACKUP_LOCAL_ONLY=1]
#   BACKUP_LOCAL_DIR            default: backups
#   BACKUP_LOCAL_RETENTION_DAYS default: 7   (remote retention: bucket lifecycle rules)
#   BACKUP_HEALTHCHECK_URL      optional; pinged on success, <url>/fail on failure
#   BACKUP_DATABASE_URL         optional; dump this URL with the local pg_dump instead
#                               of the docker compose postgres service
set -euo pipefail

cd "$(dirname "$0")/../.."
[ -f .env.backup ] && set -a && . ./.env.backup && set +a

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.hetzner.yml}"
DB_USER="${DB_USER:-mcfinancial}"
DB_NAME="${DB_NAME:-mcfinancial}"
LOCAL_DIR="${BACKUP_LOCAL_DIR:-backups}"
RETENTION_DAYS="${BACKUP_LOCAL_RETENTION_DAYS:-7}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

ping_health() {
  [ -n "${BACKUP_HEALTHCHECK_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 "${BACKUP_HEALTHCHECK_URL}$1" >/dev/null || log "warning: health check ping failed"
}

tmp_file=""
on_error() {
  log "BACKUP FAILED (line $1)"
  [ -n "$tmp_file" ] && rm -f "$tmp_file"
  ping_health /fail
}
trap 'on_error $LINENO' ERR

: "${BACKUP_AGE_RECIPIENTS_FILE:?Set BACKUP_AGE_RECIPIENTS_FILE to a file of age public keys}"
[ -s "$BACKUP_AGE_RECIPIENTS_FILE" ] || { log "recipients file $BACKUP_AGE_RECIPIENTS_FILE is missing or empty"; false; }
if grep -q 'AGE-SECRET-KEY' "$BACKUP_AGE_RECIPIENTS_FILE"; then
  log "refusing: $BACKUP_AGE_RECIPIENTS_FILE contains a PRIVATE key; only public keys (age1...) belong on the server"
  false
fi
if [ "${BACKUP_LOCAL_ONLY:-0}" != "1" ]; then
  : "${BACKUP_REMOTE:?Set BACKUP_REMOTE (rclone destination) or BACKUP_LOCAL_ONLY=1}"
fi

mkdir -p "$LOCAL_DIR"
chmod 700 "$LOCAL_DIR"
umask 077

name="mcfinancial-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
tmp_file="$LOCAL_DIR/.$name.partial"

log "dumping and encrypting"
if [ -n "${BACKUP_DATABASE_URL:-}" ]; then
  pg_dump --format=custom "$BACKUP_DATABASE_URL"
else
  docker compose -f "$COMPOSE_FILE" exec -T postgres pg_dump --format=custom -U "$DB_USER" "$DB_NAME"
fi | age --encrypt --recipients-file "$BACKUP_AGE_RECIPIENTS_FILE" --output "$tmp_file"

# A plausibly sized archive, not an empty or truncated one.
size=$(stat -c %s "$tmp_file")
[ "$size" -gt 1024 ] || { log "encrypted dump is only $size bytes"; false; }

mv "$tmp_file" "$LOCAL_DIR/$name"
tmp_file=""
(cd "$LOCAL_DIR" && sha256sum "$name" > "$name.sha256")
log "wrote $LOCAL_DIR/$name ($size bytes)"

if [ "${BACKUP_LOCAL_ONLY:-0}" != "1" ]; then
  log "copying off-site to $BACKUP_REMOTE"
  # The file names carry the time, so none exists yet: --no-check-dest skips looking, which a
  # write-only key may not be allowed to do. rclone still checks the upload against its checksum.
  rclone copyto --no-check-dest "$LOCAL_DIR/$name" "$BACKUP_REMOTE/$name"
  rclone copyto --no-check-dest "$LOCAL_DIR/$name.sha256" "$BACKUP_REMOTE/$name.sha256"
  # Reading the size back needs permission to list; a write-only key has none, which is the
  # safe setup (see docs/operations/backup-and-restore.md), so then the upload's own check stands.
  remote_size=$(rclone lsjson "$BACKUP_REMOTE/$name" 2>/dev/null | grep -o '"Size":[0-9]*' | cut -d: -f2 || true)
  if [ -z "$remote_size" ]; then
    log "note: this key cannot list the bucket, so the off-site size was not read back; the weekly restore check proves the backups"
  else
    [ "$remote_size" = "$size" ] || { log "off-site copy size $remote_size != $size"; false; }
    log "off-site copy verified ($remote_size bytes)"
  fi
fi

# mcfinance-* are backups taken before the rename; they age out the same way.
find "$LOCAL_DIR" -maxdepth 1 \( -name 'mcfinancial-*.dump.age' -o -name 'mcfinancial-*.dump.age.sha256' \
  -o -name 'mcfinance-*.dump.age' -o -name 'mcfinance-*.dump.age.sha256' \) -mtime "+$RETENTION_DAYS" -delete
ping_health ""
log "backup complete: $name"
