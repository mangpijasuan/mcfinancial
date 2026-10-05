#!/usr/bin/env bash
# Restore and verify encrypted backups made by scripts/ops/backup-postgres.sh (S-6).
# Needs the age PRIVATE key, so run it on an officer's workstation or a
# recovery machine, never on the production server.
#
#   scripts/ops/restore-postgres.sh verify [backup]
#       Restores a backup (default: the newest one) into a throwaway
#       database, checks it, and drops it. Run weekly; prints PASS or FAIL.
#
#   scripts/ops/restore-postgres.sh restore <backup> <target-database-url>
#       Restores into an EXISTING, EMPTY database (for disaster recovery,
#       see docs/operations/backup-and-restore.md). Refuses a database that has tables.
#
# <backup> is a local file, a file name in $BACKUP_REMOTE, or a full rclone path.
#
# Environment (or .env.backup):
#   AGE_IDENTITY_FILE     the age private key file                        [required]
#   BACKUP_REMOTE         rclone location of the backups (for "newest" and bare names)
#   BACKUP_LOCAL_DIR      used for "newest" when BACKUP_REMOTE is unset (default: backups)
#   RESTORE_ADMIN_URL     verify: a server where this user may CREATE DATABASE
#                         (default: the local Docker database, port 5434)
#   BACKUP_MAX_AGE_HOURS  verify: fail if the newest backup is older (default: 30)
#   VERIFY_HEALTHCHECK_URL optional; pinged on PASS, <url>/fail on FAIL
set -euo pipefail

mode="${1:-}"
cd "$(dirname "$0")/../.."
[ -f .env.backup ] && set -a && . ./.env.backup && set +a

# Logs go to stderr so command substitutions only capture results.
log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >&2; }
die() {
  log "FAIL: $*"
  if [ "${mode:-}" = "verify" ] && [ -n "${VERIFY_HEALTHCHECK_URL:-}" ]; then
    curl -fsS -m 10 "$VERIFY_HEALTHCHECK_URL/fail" >/dev/null || true
  fi
  exit 1
}

# psql/pg_restore reject Prisma's ?schema= parameter.
pg_url() { echo "$1" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//'; }
with_db() { # with_db <url> <dbname>
  local url query=""
  url=$(pg_url "$1")
  if [[ "$url" == *\?* ]]; then query="?${url#*\?}"; url="${url%%\?*}"; fi
  echo "${url%/*}/$2$query"
}

work=$(mktemp -d)
chmod 700 "$work"
cleanup_db=""
cleanup() {
  if [ -n "$cleanup_db" ]; then
    psql -q "$(with_db "$ADMIN_URL" postgres)" -c "DROP DATABASE IF EXISTS \"$cleanup_db\" WITH (FORCE)" >/dev/null 2>&1 || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

: "${AGE_IDENTITY_FILE:?Set AGE_IDENTITY_FILE to the age private key file}"
[ -r "$AGE_IDENTITY_FILE" ] || die "cannot read $AGE_IDENTITY_FILE"

newest_backup() {
  if [ -n "${BACKUP_REMOTE:-}" ]; then
    # mcfinance-* are backups taken before the rename; sort on the timestamp.
    rclone lsf --files-only --include 'mcfinancial-*.dump.age' --include 'mcfinance-*.dump.age' "$BACKUP_REMOTE" | sort -t- -k2 | tail -1
  else
    ls -1 "${BACKUP_LOCAL_DIR:-backups}" 2>/dev/null | grep -E '^mcfinan(cial|ce)-.*\.dump\.age$' | sort -t- -k2 | tail -1
  fi
}

# Fetch <backup> into $work, check its checksum if one exists; prints the local path.
fetch() {
  local ref="$1" src
  if [ -f "$ref" ]; then
    src="$ref"
    cp "$src" "$work/"
    [ -f "$src.sha256" ] && cp "$src.sha256" "$work/"
  else
    if [[ "$ref" == *:* ]]; then src="$ref"
    elif [ -n "${BACKUP_REMOTE:-}" ]; then src="$BACKUP_REMOTE/$ref"
    else src="${BACKUP_LOCAL_DIR:-backups}/$ref"; fi
    if [ -f "$src" ]; then
      cp "$src" "$work/"; [ -f "$src.sha256" ] && cp "$src.sha256" "$work/"
    else
      rclone copyto "$src" "$work/$(basename "$src")"
      rclone copyto "$src.sha256" "$work/$(basename "$src").sha256" 2>/dev/null || true
    fi
  fi
  local name
  name=$(basename "$src")
  if [ -f "$work/$name.sha256" ]; then
    (cd "$work" && sha256sum --quiet -c "$name.sha256") || die "checksum mismatch for $name"
    log "checksum ok"
  else
    log "warning: no checksum file for $name"
  fi
  echo "$work/$name"
}

restore_into() { # restore_into <encrypted file> <database url>
  local file="$1" url
  url=$(pg_url "$2")
  local tables
  tables=$(psql -Atq "$url" -c "select count(*) from information_schema.tables where table_schema = 'public'")
  [ "$tables" = "0" ] || die "target database is not empty ($tables tables); restore only into a new, empty database"
  log "decrypting and restoring (single transaction)"
  # Decrypted data is streamed straight into pg_restore, never written to disk.
  age --decrypt --identity "$AGE_IDENTITY_FILE" "$file" \
    | pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --dbname="$url" \
    || die "could not decrypt or restore: wrong key, damaged file, or a pg_restore older than the dump (nothing was written)"
}

check_restored() { # check_restored <database url>
  local url
  url=$(pg_url "$1")
  q() { psql -Atq "$url" -c "$1"; }
  local migrations latest triggers members staff
  migrations=$(q "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")
  latest=$(q "select migration_name from _prisma_migrations where finished_at is not null order by finished_at desc limit 1")
  triggers=$(q "select count(*) from pg_trigger where tgname in ('audit_log_no_update_delete', 'audit_log_no_truncate')")
  members=$(q 'select count(*) from "Member"')
  # Logins are in "User" since M8 (20261007000000_identity_users); a backup
  # taken before it still has "Admin", where every row is staff.
  local logins="User"
  [ "$(q "select to_regclass('public.\"User\"') is not null")" = "t" ] || logins="Admin"
  if [ "$logins" = "User" ]; then
    staff=$(q 'select count(*) from "User" where kind = '"'staff'"' and "disabledAt" is null')
  else
    staff=$(q 'select count(*) from "Admin" where "disabledAt" is null')
  fi
  log "migrations applied: $migrations (latest: $latest)"
  for t in Member Contribution Loan LoanPayment Withdrawal PortalPayment LoanAgreement "$logins" AuditLog; do
    log "  $t: $(q "select count(*) from \"$t\"")"
  done
  [ "$migrations" -ge 1 ] || die "no applied migrations recorded"
  [ "$triggers" = "2" ] || die "audit log append-only triggers missing ($triggers of 2)"
  [ "$members" -gt 0 ] || die "no members in the restored database"
  [ "$staff" -gt 0 ] || die "no active staff accounts in the restored database"
  # The restored audit log must still refuse edits.
  if psql -q "$url" -c 'UPDATE "AuditLog" SET action = action WHERE id = (SELECT min(id) FROM "AuditLog")' >/dev/null 2>&1 \
     && [ "$(q 'select count(*) from "AuditLog"')" != "0" ]; then
    die "restored audit log accepted an UPDATE"
  fi
}

case "$mode" in
  verify)
    ADMIN_URL="${RESTORE_ADMIN_URL:-postgresql://mcfinancial:mcfinancial_dev@127.0.0.1:5434/postgres}"
    ref="${2:-$(newest_backup)}"
    [ -n "$ref" ] || die "no backups found"
    log "verifying $ref"
    # Freshness, from the UTC timestamp in the file name.
    stamp=$(basename "$ref" | sed -E 's/^mcfinan(cial|ce)-([0-9]{8})T([0-9]{2})([0-9]{2})([0-9]{2})Z.*/\2 \3:\4:\5/')
    if [ -z "${2:-}" ] && taken=$(date -u -d "$stamp" +%s 2>/dev/null); then
      hours=$(( ($(date -u +%s) - taken) / 3600 ))
      log "newest backup is $hours hour(s) old"
      [ "$hours" -le "${BACKUP_MAX_AGE_HOURS:-30}" ] || die "newest backup is older than ${BACKUP_MAX_AGE_HOURS:-30} hours; nightly backups have stopped"
    fi
    file=$(fetch "$ref")
    cleanup_db="mc_restore_check_$(date +%s)"
    psql -q "$(with_db "$ADMIN_URL" postgres)" -c "CREATE DATABASE \"$cleanup_db\"" >/dev/null
    restore_into "$file" "$(with_db "$ADMIN_URL" "$cleanup_db")"
    if check_restored "$(with_db "$ADMIN_URL" "$cleanup_db")"; then
      log "PASS: $(basename "$ref") restores and checks out"
      [ -n "${VERIFY_HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 "$VERIFY_HEALTHCHECK_URL" >/dev/null || true
    fi
    ;;
  restore)
    [ $# -eq 3 ] || die "usage: $0 restore <backup> <target-database-url>"
    file=$(fetch "$2")
    restore_into "$file" "$3"
    check_restored "$3"
    log "restore complete. Next: point DATABASE_URL at this database, run 'npx prisma migrate deploy', start the app."
    ;;
  *)
    echo "usage: $0 verify [backup] | restore <backup> <target-database-url>" >&2
    exit 2
    ;;
esac
