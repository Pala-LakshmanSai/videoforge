#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ -z "${DATABASE_URL:-}" ]; then
  echo "usage: DATABASE_URL=<migration-url> backup.sh <new-backup-file>" >&2
  exit 2
fi

backup_output=$1
if [ -e "$backup_output" ]; then
  echo "backup target already exists; refusing to overwrite" >&2
  exit 2
fi

umask 077
pg_dump --format=custom --compress=9 --no-owner --no-privileges \
  --file "$backup_output" "$DATABASE_URL"
pg_restore --list "$backup_output" >/dev/null
shasum -a 256 "$backup_output"

