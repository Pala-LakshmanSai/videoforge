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
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)

if ! node "$script_dir/backup-restore-preflight.mjs" --tools-only --operation backup --quiet; then
  echo "V2-06 backup/restore dependency/PATH preflight failed; run backup-restore-preflight.mjs --tools-only for details" >&2
  exit 2
fi

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
awk 'NR == 1 { first = length($0) > 0; next } length($0) > 0 { extra = 1 } END { exit !(first && !extra) }' "$passphrase_file" || {
  echo "backup passphrase file must contain one non-empty first line" >&2
  exit 2
}
node "$script_dir/validate-pg-service.mjs" "$PGSERVICEFILE" "$PGSERVICE" \
  "$V2_06_APPROVED_NEON_HOST" "$V2_06_EXPECTED_DATABASE" "$V2_06_EXPECTED_OWNER_ROLE" >/dev/null
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
  node "$script_dir/apply-migrations-and-grants.mjs" --verify-only --owner-only

umask 077
raw_backup=$(mktemp "${backup_output}.raw.XXXXXX")
encrypted_backup=$(mktemp "${backup_output}.encrypted.XXXXXX")
archive_list=$(mktemp "${backup_output}.list.XXXXXX")
envelope_backup=$(mktemp "${backup_output}.envelope.XXXXXX")
cleanup() {
  rm -f "$raw_backup" "$encrypted_backup" "$archive_list" "$envelope_backup"
}
trap cleanup EXIT HUP INT TERM

# The PostgreSQL service is deliberately selected through environment variables, never a DSN argv.
pg_dump --format=custom --compress=9 --no-owner --no-privileges --file "$raw_backup"
pg_restore --list "$raw_backup" >"$archive_list"
if ! grep -Eq '[[:space:]]TABLE[[:space:]]+public[[:space:]]+videoforge_schema_migrations[[:space:]]' "$archive_list"; then
  echo "backup archive does not contain the V2-06 migration ledger" >&2
  exit 1
fi
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
  -in "$raw_backup" -out "$encrypted_backup" -pass "file:$passphrase_file"
# mktemp reserves an unpredictable private path, while the envelope writer deliberately opens its
# target with O_EXCL. Remove only that empty reservation immediately before the no-clobber writer.
rm -f "$envelope_backup"
node "$script_dir/backup-envelope.mjs" pack "$encrypted_backup" "$envelope_backup" "$passphrase_file" >/dev/null
chmod 600 "$envelope_backup"
# A hard link gives this exact output path no-clobber semantics, including a race after the preflight.
if ! ln "$envelope_backup" "$backup_output"; then
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
