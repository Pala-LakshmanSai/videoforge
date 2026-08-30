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
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)

if ! node "$script_dir/backup-restore-preflight.mjs" --tools-only --operation restore --quiet; then
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

require_private_file "$backup_input" "backup input"
require_private_file "$PGSERVICEFILE" "PGSERVICEFILE"
require_private_file "$PGPASSFILE" "PGPASSFILE"
require_private_file "$passphrase_file" "restore passphrase file"
awk 'NR == 1 { first = length($0) > 0; next } length($0) > 0 { extra = 1 } END { exit !(first && !extra) }' "$passphrase_file" || {
  echo "restore passphrase file must contain one non-empty first line" >&2
  exit 2
}
node "$script_dir/validate-pg-service.mjs" "$PGSERVICEFILE" "$PGSERVICE" \
  "$RESTORE_APPROVED_NEON_HOST" "$RESTORE_TARGET_DATABASE" "$RESTORE_EXPECTED_OWNER_ROLE" >/dev/null
if ! command -v pg_restore >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1 || \
  ! command -v openssl >/dev/null 2>&1; then
  echo "pg_restore, psql, and openssl are required for encrypted restore drills" >&2
  exit 2
fi

export PGSERVICEFILE PGSERVICE PGPASSFILE
unset DATABASE_URL PGPASSWORD PGHOST PGPORT PGDATABASE PGUSER
# Positive emptiness proof: no user schema/object may exist on the exact disposable target.
public_relation_count=$(psql --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 \
  --dbname "service=$PGSERVICE" --command \
  "SELECT ((SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'public') AND nspname NOT LIKE 'pg_toast%') + (SELECT count(*) FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%') + (SELECT count(*) FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%') + (SELECT count(*) FROM pg_type AS t JOIN pg_namespace AS n ON n.oid = t.typnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND t.typtype <> 'p'))::text;")
if [ "$(printf '%s' "$public_relation_count" | tr -d '[:space:]')" != "0" ]; then
  echo "refusing restore: exact disposable target is not empty" >&2
  exit 2
fi

umask 077
decrypted_ciphertext=$(mktemp "${TMPDIR:-/tmp}/videoforge-v2-06-ciphertext.XXXXXX")
decrypted_backup=$(mktemp "${TMPDIR:-/tmp}/videoforge-v2-06-restore.XXXXXX")
archive_list=$(mktemp "${TMPDIR:-/tmp}/videoforge-v2-06-restore-list.XXXXXX")
cleanup() { rm -f "$decrypted_ciphertext" "$decrypted_backup" "$archive_list"; }
trap cleanup EXIT HUP INT TERM
# As in backup.sh, reserve a random path first, then remove only the empty placeholder so the
# envelope verifier can recreate it with O_EXCL and fail closed if anything races the path.
rm -f "$decrypted_ciphertext"
node "$script_dir/backup-envelope.mjs" unpack "$backup_input" "$decrypted_ciphertext" "$passphrase_file" >/dev/null
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -in "$decrypted_ciphertext" -out "$decrypted_backup" -pass "file:$passphrase_file"
pg_restore --list "$decrypted_backup" >"$archive_list"
if ! grep -Eq '[[:space:]]TABLE[[:space:]]+public[[:space:]]+videoforge_schema_migrations[[:space:]]' "$archive_list"; then
  echo "backup archive does not contain the V2-06 migration ledger" >&2
  exit 1
fi
for required_table in hosted_full_live_authorities hosted_full_live_promotions hosted_full_live_cloudflare_activations hosted_full_live_cloudflare_rollbacks hosted_full_live_stage_authorities hosted_full_live_stage_consumptions hosted_full_live_stage_completions hosted_full_live_operation_events hosted_full_live_bridge_command_events hosted_full_live_workflow_start_authorities hosted_full_live_workflow_start_claims hosted_full_live_workflow_start_results hosted_full_live_acceptance_authorities hosted_full_live_acceptance_claims hosted_full_live_acceptance_results hosted_full_live_acceptance_operator_results hosted_full_live_signed_evidence hosted_full_live_acceptance_repository_records hosted_full_live_materialization_challenges hosted_full_live_materialization_challenge_assignments hosted_full_live_materialization_selections hosted_full_live_materialization_facts hosted_full_live_materialization_readbacks hosted_full_live_jit_materialization_intents hosted_full_live_jit_materializations hosted_full_live_jit_materialization_readbacks hosted_full_live_static_release_descriptors hosted_full_live_jit_operation_authorities hosted_full_live_manifest_read_claims hosted_full_live_acceptance_workflow_events hosted_full_live_acceptance_operator_evidence_requests hosted_full_live_acceptance_operator_evidence hosted_full_live_acceptance_zero_worker_reads hosted_full_live_acceptance_technical_captures hosted_full_live_acceptance_workflow_outputs hosted_full_live_v211_policy_actions hosted_full_live_v211_scenario_events hosted_full_live_v211_restore_authorizations hosted_full_live_v211_probe_cancellations hosted_full_live_v211_probe_reconciliations hosted_full_live_operation_receipts hosted_full_live_release_identity_facts hosted_full_live_release_gate_facts hosted_full_live_release_fact_materializations hosted_full_live_release_chrome_associations hosted_full_live_release_certifications hosted_v209_settlement_cost_evidence hosted_v209_terminal_acceptances; do
  if ! grep -Eq "[[:space:]]TABLE[[:space:]]+public[[:space:]]+${required_table}[[:space:]]" "$archive_list"; then
    echo "backup archive does not contain durable full-live authority table ${required_table}" >&2
    exit 1
  fi
done
for required_table in hosted_full_live_qualification_materialization_intents hosted_full_live_qualification_materializations; do
  if ! grep -Eq "[[:space:]]TABLE[[:space:]]+public[[:space:]]+${required_table}[[:space:]]" "$archive_list"; then
    echo "backup archive does not contain durable full-live qualification materialization table ${required_table}" >&2
    exit 1
  fi
done
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
  --dbname "service=$PGSERVICE" "$decrypted_backup"

# The restore excludes privileges by design; apply and verify the exact runtime role grants and RLS
# from the migration owner connection before this disposable result is accepted as evidence.
V2_06_PG_SERVICEFILE=$PGSERVICEFILE \
V2_06_PG_SERVICE=$PGSERVICE \
V2_06_PGPASSFILE=$PGPASSFILE \
V2_06_APPROVED_NEON_HOST=$RESTORE_APPROVED_NEON_HOST \
V2_06_EXPECTED_DATABASE=$RESTORE_TARGET_DATABASE \
V2_06_EXPECTED_OWNER_ROLE=$RESTORE_EXPECTED_OWNER_ROLE \
V2_06_RUNTIME_ROLE=$RESTORE_RUNTIME_ROLE \
  node "$script_dir/apply-migrations-and-grants.mjs" --apply-grants
# The helper derives the current head and every migration checksum from the committed manifest; a
# numeric max(version) check alone is intentionally not accepted as restore evidence.
echo "restore drill verified exact disposable target, migration manifest, runtime grants, and FORCE RLS"
