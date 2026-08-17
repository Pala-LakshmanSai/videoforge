#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ -z "${DATABASE_URL:-}" ] || [ -z "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  echo "usage: DATABASE_URL=<migration-url> BACKUP_PASSPHRASE_FILE=<mode-0600-file> backup.sh <new-backup-file>" >&2
  exit 2
fi

backup_output=$1
passphrase_file=$BACKUP_PASSPHRASE_FILE

if [ ! -f "$passphrase_file" ] || [ -L "$passphrase_file" ]; then
  echo "backup passphrase file must be a regular file" >&2
  exit 2
fi
if [ "$(uname -s)" = "Darwin" ]; then
  passphrase_mode=$(stat -f '%Lp' "$passphrase_file")
else
  passphrase_mode=$(stat -c '%a' "$passphrase_file")
fi
if [ "$passphrase_mode" != "600" ]; then
  echo "backup passphrase file must have mode 0600" >&2
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
if ! command -v pg_dump >/dev/null 2>&1 || ! command -v pg_restore >/dev/null 2>&1; then
  echo "pg_dump and pg_restore are required" >&2
  exit 2
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required for encrypted backups" >&2
  exit 2
fi

umask 077
raw_backup=$(mktemp "${backup_output}.raw.XXXXXX")
encrypted_backup=$(mktemp "${backup_output}.encrypted.XXXXXX")
cleanup() {
  rm -f "$raw_backup" "$encrypted_backup"
}
trap cleanup EXIT HUP INT TERM

pg_dump --format=custom --compress=9 --no-owner --no-privileges \
  --file "$raw_backup" "$DATABASE_URL"
pg_restore --list "$raw_backup" >/dev/null
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
  -in "$raw_backup" -out "$encrypted_backup" -pass "file:$passphrase_file"
chmod 600 "$encrypted_backup"
mv "$encrypted_backup" "$backup_output"
if [ "$(uname -s)" = "Darwin" ]; then
  backup_mode=$(stat -f '%Lp' "$backup_output")
else
  backup_mode=$(stat -c '%a' "$backup_output")
fi
if [ "$backup_mode" != "600" ] || [ ! -f "$backup_output" ] || [ -L "$backup_output" ]; then
  echo "encrypted backup was not created as a mode-0600 regular file" >&2
  exit 1
fi
if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$backup_output"
else
  sha256sum "$backup_output"
fi
