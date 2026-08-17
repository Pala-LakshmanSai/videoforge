#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ -z "${PGSERVICEFILE:-}" ] || [ -z "${PGSERVICE:-}" ] || \
  [ -z "${PGPASSFILE:-}" ] || [ -z "${V2_06_APPROVED_NEON_HOST:-}" ] || \
  [ -z "${V2_06_EXPECTED_OWNER_ROLE:-}" ] || [ -z "${V2_06_EXPECTED_DATABASE:-}" ] || \
  [ -z "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  echo "usage: PGSERVICEFILE=<mode-0600-service-file> PGSERVICE=<approved-service> PGPASSFILE=<mode-0600-pass-file> V2_06_APPROVED_NEON_HOST=<exact-host> V2_06_EXPECTED_DATABASE=<exact-database> V2_06_EXPECTED_OWNER_ROLE=<migration-owner> BACKUP_PASSPHRASE_FILE=<mode-0600-file> backup.sh <new-backup-file>" >&2
  exit 2
fi

if [ -n "${DATABASE_URL:-}" ] || [ -n "${PGPASSWORD:-}" ]; then
  echo "DATABASE_URL and PGPASSWORD are forbidden; credentials must come from the protected PostgreSQL service" >&2
  exit 2
fi

backup_output=$1
passphrase_file=$BACKUP_PASSPHRASE_FILE

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

require_private_file "$PGSERVICEFILE" "PGSERVICEFILE"
require_private_file "$PGPASSFILE" "PGPASSFILE"
require_private_file "$passphrase_file" "backup passphrase file"
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
if [ "$service_host" != "$V2_06_APPROVED_NEON_HOST" ]; then
  echo "PGSERVICEFILE does not pin the approved Neon endpoint" >&2
  exit 2
fi
if [ "$service_database" != "$V2_06_EXPECTED_DATABASE" ]; then
  echo "PGSERVICEFILE dbname does not match the approved Neon database" >&2
  exit 2
fi
if [ -e "$backup_output" ] || [ -L "$backup_output" ]; then
  echo "backup target already exists or is a symlink; refusing to overwrite" >&2
  exit 2
fi
backup_directory=$(dirname "$backup_output")
if [ ! -d "$backup_directory" ]; then
  echo "backup target directory does not exist" >&2
  exit 2
fi
if ! command -v pg_dump >/dev/null 2>&1 || ! command -v pg_restore >/dev/null 2>&1 || \
  ! command -v psql >/dev/null 2>&1; then
  echo "pg_dump, pg_restore, and psql are required" >&2
  exit 2
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required for encrypted backups" >&2
  exit 2
fi

export PGSERVICEFILE PGSERVICE PGPASSFILE
unset DATABASE_URL PGPASSWORD PGHOST PGPORT PGDATABASE PGUSER
V2_06_PG_SERVICEFILE=$PGSERVICEFILE \
V2_06_PG_SERVICE=$PGSERVICE \
V2_06_PGPASSFILE=$PGPASSFILE \
V2_06_APPROVED_NEON_HOST=$V2_06_APPROVED_NEON_HOST \
V2_06_EXPECTED_DATABASE=$V2_06_EXPECTED_DATABASE \
V2_06_EXPECTED_OWNER_ROLE=$V2_06_EXPECTED_OWNER_ROLE \
  node deploy/v2-06/apply-migrations-and-grants.mjs --verify-only --owner-only

umask 077
raw_backup=$(mktemp "${backup_output}.raw.XXXXXX")
encrypted_backup=$(mktemp "${backup_output}.encrypted.XXXXXX")
cleanup() {
  rm -f "$raw_backup" "$encrypted_backup"
}
trap cleanup EXIT HUP INT TERM

# The PostgreSQL service is deliberately selected through environment variables, never a DSN argv.
pg_dump --format=custom --compress=9 --no-owner --no-privileges --file "$raw_backup"
pg_restore --list "$raw_backup" >/dev/null
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
  -in "$raw_backup" -out "$encrypted_backup" -pass "file:$passphrase_file"
chmod 600 "$encrypted_backup"
# A hard link gives this exact output path no-clobber semantics, including a race after the preflight.
if ! ln "$encrypted_backup" "$backup_output"; then
  echo "backup target appeared during creation; refusing to overwrite" >&2
  exit 2
fi
rm -f "$encrypted_backup"
if [ "$(mode_of "$backup_output")" != "600" ] || [ ! -f "$backup_output" ] || [ -L "$backup_output" ]; then
  echo "encrypted backup was not created as a mode-0600 regular file" >&2
  exit 1
fi
if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$backup_output"
else
  sha256sum "$backup_output"
fi
