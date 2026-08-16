#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ -z "${RESTORE_DATABASE_URL:-}" ]; then
  echo "usage: RESTORE_DATABASE_URL=<dedicated-empty-drill-db> restore-drill.sh <backup-file>" >&2
  exit 2
fi

backup_input=$1
if [ ! -f "$backup_input" ]; then
  echo "backup file does not exist" >&2
  exit 2
fi

# RESTORE_DATABASE_URL must identify the separately approved, disposable drill database.
# This script never creates or drops a database and never accepts the production URL implicitly.
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
  --dbname "$RESTORE_DATABASE_URL" "$backup_input"
psql "$RESTORE_DATABASE_URL" --no-psqlrc --tuples-only --command \
  "SELECT version, sha256 FROM videoforge_schema_migrations ORDER BY version DESC LIMIT 1;"

