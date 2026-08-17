#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ -z "${RESTORE_DATABASE_URL:-}" ] || \
  [ -z "${RESTORE_PASSPHRASE_FILE:-}" ] || [ "${RESTORE_DRILL_CONFIRM:-}" != "YES" ] || \
  [ "${RESTORE_TARGET_LABEL:-}" != "videoforge-v2-06-disposable-drill" ]; then
  echo "usage: RESTORE_DATABASE_URL=<dedicated-empty-drill-db> RESTORE_PASSPHRASE_FILE=<mode-0600-file> RESTORE_DRILL_CONFIRM=YES RESTORE_TARGET_LABEL=videoforge-v2-06-disposable-drill restore-drill.sh <backup-file>" >&2
  exit 2
fi

backup_input=$1
passphrase_file=$RESTORE_PASSPHRASE_FILE
if [ ! -f "$backup_input" ] || [ -L "$backup_input" ]; then
  echo "backup file must be a regular file" >&2
  exit 2
fi
if [ ! -f "$passphrase_file" ] || [ -L "$passphrase_file" ]; then
  echo "restore passphrase file must be a regular file" >&2
  exit 2
fi
if [ "$(uname -s)" = "Darwin" ]; then
  passphrase_mode=$(stat -f '%Lp' "$passphrase_file")
else
  passphrase_mode=$(stat -c '%a' "$passphrase_file")
fi
if [ "$passphrase_mode" != "600" ]; then
  echo "restore passphrase file must have mode 0600" >&2
  exit 2
fi
case "$RESTORE_DATABASE_URL" in
  *videoforge-v2-06-staging*|*production*)
    echo "refusing a staging or production restore target" >&2
    exit 2
    ;;
esac
if ! command -v pg_restore >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1; then
  echo "pg_restore and psql are required" >&2
  exit 2
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required for encrypted restore drills" >&2
  exit 2
fi

# RESTORE_DATABASE_URL must identify the separately approved, disposable drill database.
# This script never creates or drops a database and never accepts the production URL implicitly.
umask 077
decrypted_backup=$(mktemp "${TMPDIR:-/tmp}/videoforge-v2-06-restore.XXXXXX")
cleanup() { rm -f "$decrypted_backup"; }
trap cleanup EXIT HUP INT TERM
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -in "$backup_input" -out "$decrypted_backup" -pass "file:$passphrase_file"
pg_restore --list "$decrypted_backup" >/dev/null
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
  --dbname "$RESTORE_DATABASE_URL" "$decrypted_backup"
migration_version=$(psql "$RESTORE_DATABASE_URL" --no-psqlrc --tuples-only --no-align --command \
  "SELECT max(version)::text FROM public.videoforge_schema_migrations;")
if [ "$migration_version" != "35" ]; then
  echo "restore drill migration head is $migration_version, expected 35" >&2
  exit 1
fi
echo "restore drill verified migration head 35 on disposable target"
