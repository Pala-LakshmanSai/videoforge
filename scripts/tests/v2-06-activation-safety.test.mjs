import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("V2-06 backup and restore scripts use protected PostgreSQL services, not DSN argv", async () => {
  const backup = await read("deploy/v2-06/backup.sh");
  const restore = await read("deploy/v2-06/restore-drill.sh");
  assert.match(backup, /PGSERVICEFILE/gu);
  assert.match(backup, /PGPASSFILE/gu);
  assert.match(backup, /apply-migrations-and-grants\.mjs --verify-only --owner-only/u);
  assert.match(backup, /ln "\$encrypted_backup" "\$backup_output"/u);
  assert.doesNotMatch(backup, /pg_dump[^\n]*\$DATABASE_URL/u);
  assert.doesNotMatch(backup, /DATABASE_URL[^\n]*pg_dump/u);
  assert.match(restore, /videoforge_v2_06_disposable_drill/u);
  assert.match(restore, /public_relation_count/u);
  assert.match(restore, /apply-migrations-and-grants\.mjs --verify-only --apply-grants/u);
  assert.doesNotMatch(restore, /pg_restore[^\n]*\$RESTORE_DATABASE_URL/u);
  assert.doesNotMatch(restore, /psql\s+"\$RESTORE_DATABASE_URL"/u);
});

test("V2-06 live database helper verifies exact hashes, grants, and FORCE RLS", async () => {
  const source = await read("deploy/v2-06/apply-migrations-and-grants.mjs");
  assert.match(source, /migration manifest/u);
  assert.match(source, /does not match its manifest hash/u);
  assert.match(source, /migration ledger position/u);
  assert.match(source, /rolbypassrls/u);
  assert.match(source, /relforcerowsecurity/u);
  assert.match(source, /hosted render plans are not read-only/u);
  assert.match(source, /exact table grants/u);
  assert.doesNotMatch(source, /process\.argv[^\n]*DATABASE_URL/u);
});

test("V2-06 renderer and rollback pin approved identities and immutable evidence", async () => {
  const renderer = await read("deploy/v2-06/render-staging-config.mjs");
  const rollback = await read("deploy/v2-06/rollback.md");
  const runbook = await read("deploy/v2-06/README.md");
  assert.match(renderer, /activation record must be explicitly approved/u);
  assert.match(renderer, /account ID does not match the approved activation record/u);
  assert.match(renderer, /release manifest bytes do not match the approved activation record/u);
  assert.match(renderer, /origin hostname does not match the approved activation record/u);
  assert.match(rollback, /EXPECTED_CONFIG_SHA256/u);
  assert.match(rollback, /HostedVideoWorkflow/u);
  assert.match(rollback, /wrangler rollback.*--yes/su);
  assert.match(runbook, /r2 bucket cors set/su);
  assert.match(runbook, /--file "\$CORS_CONFIG" --force/u);
  assert.match(runbook, /secret list --format json/u);
});
