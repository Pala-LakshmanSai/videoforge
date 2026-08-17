#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ -z "${PGSERVICEFILE:-}" ] || [ -z "${PGSERVICE:-}" ] || \
  [ -z "${PGPASSFILE:-}" ] || [ -z "${RESTORE_APPROVED_NEON_HOST:-}" ] || \
  [ -z "${RESTORE_EXPECTED_OWNER_ROLE:-}" ] || [ -z "${RESTORE_RUNTIME_ROLE:-}" ] || \
  [ -z "${RESTORE_TARGET_DATABASE:-}" ] || [ -z "${RESTORE_PASSPHRASE_FILE:-}" ] || \
  [ "${RESTORE_DRILL_CONFIRM:-}" != "YES" ] || \
  [ "${RESTORE_TARGET_LABEL:-}" != "videoforge-v2-06-disposable-drill" ]; then
  echo "usage: PGSERVICEFILE=<mode-0600-service-file> PGSERVICE=<approved-disposable-service> PGPASSFILE=<mode-0600-pass-file> RESTORE_APPROVED_NEON_HOST=<exact-disposable-host> RESTORE_EXPECTED_OWNER_ROLE=<migration-owner> RESTORE_RUNTIME_ROLE=<runtime-role> RESTORE_TARGET_DATABASE=videoforge_v2_06_disposable_drill RESTORE_PASSPHRASE_FILE=<mode-0600-file> RESTORE_DRILL_CONFIRM=YES RESTORE_TARGET_LABEL=videoforge-v2-06-disposable-drill restore-drill.sh <backup-file>" >&2
  exit 2
fi

if [ -n "${DATABASE_URL:-}" ] || [ -n "${PGPASSWORD:-}" ]; then
  echo "DATABASE_URL and PGPASSWORD are forbidden; credentials must come from the protected PostgreSQL service" >&2
  exit 2
fi
if [ "$RESTORE_TARGET_DATABASE" != "videoforge_v2_06_disposable_drill" ]; then
  echo "RESTORE_TARGET_DATABASE must be the exact approved disposable database" >&2
  exit 2
fi

backup_input=$1
passphrase_file=$RESTORE_PASSPHRASE_FILE

mode_of() {
  if [ "$(uname -s)" = "Darwin" ]; then
    stat -f '%Lp' "$1"
  else
    stat -c '%a' "$1"
  fi
}

require_private_file() {
  file=$1
  label=$2
  if [ ! -f "$file" ] || [ -L "$file" ] || [ "$(mode_of "$file")" != "600" ] || [ ! -s "$file" ]; then
    echo "$label must be a non-empty regular mode-0600 file" >&2
    exit 2
  fi
}

require_private_file "$backup_input" "backup input"
require_private_file "$PGSERVICEFILE" "PGSERVICEFILE"
require_private_file "$PGPASSFILE" "PGPASSFILE"
require_private_file "$passphrase_file" "restore passphrase file"
if ! printf '%s\n' "$PGSERVICE" | grep -Eq '^[A-Za-z0-9_.-]+$'; then
  echo "PGSERVICE must be a simple approved service name" >&2
  exit 2
fi
if grep -Eq '^[[:space:]]*(password|sslpassword)[[:space:]]*=' "$PGSERVICEFILE"; then
  echo "PGSERVICEFILE must not contain a password" >&2
  exit 2
fi
service_host=$(awk -v section="[$PGSERVICE]" '
  $0 == section { active = 1; next }
  /^[[:space:]]*\[/ { active = 0 }
  active && /^[[:space:]]*host[[:space:]]*=/ {
    sub(/^[[:space:]]*host[[:space:]]*=[[:space:]]*/, "")
    gsub(/[[:space:]]+$/, "")
    print
    exit
  }
' "$PGSERVICEFILE")
service_database=$(awk -v section="[$PGSERVICE]" '
  $0 == section { active = 1; next }
  /^[[:space:]]*\[/ { active = 0 }
  active && /^[[:space:]]*dbname[[:space:]]*=/ {
    sub(/^[[:space:]]*dbname[[:space:]]*=[[:space:]]*/, "")
    gsub(/[[:space:]]+$/, "")
    print
    exit
  }
' "$PGSERVICEFILE")
service_user=$(awk -v section="[$PGSERVICE]" '
  $0 == section { active = 1; next }
  /^[[:space:]]*\[/ { active = 0 }
  active && /^[[:space:]]*user[[:space:]]*=/ {
    sub(/^[[:space:]]*user[[:space:]]*=[[:space:]]*/, "")
    gsub(/[[:space:]]+$/, "")
    print
    exit
  }
' "$PGSERVICEFILE")
if [ "$service_host" != "$RESTORE_APPROVED_NEON_HOST" ]; then
  echo "PGSERVICEFILE does not pin the approved disposable Neon endpoint" >&2
  exit 2
fi
if [ "$service_database" != "$RESTORE_TARGET_DATABASE" ]; then
  echo "PGSERVICEFILE dbname does not match the exact disposable target" >&2
  exit 2
fi
if [ "$service_user" != "$RESTORE_EXPECTED_OWNER_ROLE" ]; then
  echo "PGSERVICEFILE user is not the approved migration owner role" >&2
  exit 2
fi
if ! command -v pg_restore >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1 || \
  ! command -v openssl >/dev/null 2>&1; then
  echo "pg_restore, psql, and openssl are required for encrypted restore drills" >&2
  exit 2
fi

export PGSERVICEFILE PGSERVICE PGPASSFILE
unset DATABASE_URL PGPASSWORD PGHOST PGPORT PGDATABASE PGUSER
# Positive emptiness proof: no public relation may exist on the exact disposable target.
public_relation_count=$(psql --no-psqlrc --tuples-only --no-align --command \
  "SELECT count(*)::text FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f');")
if [ "$(printf '%s' "$public_relation_count" | tr -d '[:space:]')" != "0" ]; then
  echo "refusing restore: exact disposable target is not empty" >&2
  exit 2
fi

umask 077
decrypted_backup=$(mktemp "${TMPDIR:-/tmp}/videoforge-v2-06-restore.XXXXXX")
cleanup() { rm -f "$decrypted_backup"; }
trap cleanup EXIT HUP INT TERM
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -in "$backup_input" -out "$decrypted_backup" -pass "file:$passphrase_file"
pg_restore --list "$decrypted_backup" >/dev/null
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
  --dbname "service=$PGSERVICE" "$decrypted_backup"

# The restore excludes privileges by design; apply and verify the exact runtime role grants and RLS
# from the migration owner connection before this disposable result is accepted as evidence.
V2_06_PG_SERVICEFILE=$PGSERVICEFILE \
V2_06_PG_SERVICE=$PGSERVICE \
V2_06_PGPASSFILE=$PGPASSFILE \
V2_06_APPROVED_NEON_HOST=$RESTORE_APPROVED_NEON_HOST \
V2_06_EXPECTED_OWNER_ROLE=$RESTORE_EXPECTED_OWNER_ROLE \
V2_06_RUNTIME_ROLE=$RESTORE_RUNTIME_ROLE \
  node deploy/v2-06/apply-migrations-and-grants.mjs --verify-only --apply-grants
# The helper's exact manifest assertion includes migration head 35; a numeric max(version) check
# alone is intentionally not accepted as restore evidence.
echo "restore drill verified exact disposable target, migration manifest, runtime grants, and FORCE RLS"
