import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("V2-06 backup and restore scripts use protected PostgreSQL services, not DSN argv", async () => {
  const backup = await read("deploy/v2-06/backup.sh");
  const restore = await read("deploy/v2-06/restore-drill.sh");
  const preflight = await read("deploy/v2-06/backup-restore-preflight.mjs");
  assert.match(backup, /PGSERVICEFILE/gu);
  assert.match(backup, /PGPASSFILE/gu);
  assert.match(
    backup,
    /backup-restore-preflight\.mjs.*--tools-only.*--operation backup.*--quiet/su,
  );
  assert.match(backup, /apply-migrations-and-grants\.mjs/u);
  assert.match(backup, /--verify-only --owner-only/u);
  assert.match(backup, /backup-envelope\.mjs/gu);
  assert.match(backup, /ln "\$envelope_backup" "\$backup_output"/u);
  assert.match(
    restore,
    /backup-restore-preflight\.mjs.*--tools-only.*--operation restore.*--quiet/su,
  );
  assert.doesNotMatch(backup, /pg_dump[^\n]*\$DATABASE_URL/u);
  assert.doesNotMatch(backup, /DATABASE_URL[^\n]*pg_dump/u);
  assert.match(restore, /videoforge_v2_06_disposable_drill/u);
  assert.match(restore, /public_relation_count/u);
  assert.match(restore, /apply-migrations-and-grants\.mjs/u);
  assert.match(restore, /--verify-only --apply-grants/u);
  assert.doesNotMatch(restore, /pg_restore[^\n]*\$RESTORE_DATABASE_URL/u);
  assert.doesNotMatch(restore, /psql\s+"\$RESTORE_DATABASE_URL"/u);
  assert.match(preflight, /resolveExecutable/gu);
  assert.match(preflight, /writeFile\(file, ""/u);
  assert.doesNotMatch(preflight, /readFile/gu);
  assert.doesNotMatch(preflight, /spawn|execFile|fetch\(/gu);
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
  assert.match(source, /runtime role must already be NOSUPERUSER/u);
  assert.doesNotMatch(source, /process\.argv[^\n]*DATABASE_URL/u);
});

test("V2-06 renderer and rollback pin approved identities and immutable evidence", async () => {
  const renderer = await read("deploy/v2-06/render-staging-config.mjs");
  const rollback = await read("deploy/v2-06/rollback.md");
  const runbook = await read("deploy/v2-06/README.md");
  const privateState = await read("deploy/v2-06/verify-r2-private-state.sh");
  const secretAllowlist = await read("deploy/v2-06/check-secret-allowlist.mjs");
  const secretInputs = await read("deploy/v2-06/validate-secret-inputs.mjs");
  assert.match(renderer, /activation record must be explicitly approved/u);
  assert.match(renderer, /account ID does not match the approved activation record/u);
  assert.match(renderer, /release manifest bytes do not match the approved activation record/u);
  assert.match(renderer, /origin hostname does not match the approved activation record/u);
  assert.match(renderer, /exact approved cap, ceiling, or authority mode/u);
  assert.match(renderer, /untracked source files/u);
  assert.match(renderer, /exact approved Neon project/u);
  assert.match(rollback, /EXPECTED_CONFIG_SHA256/u);
  assert.match(rollback, /HostedVideoWorkflow/u);
  assert.match(rollback, /wrangler rollback.*--yes/su);
  assert.match(runbook, /r2 bucket cors set/su);
  assert.match(runbook, /--file "\$CORS_CONFIG" --force/u);
  assert.match(runbook, /secret list --format json/u);
  assert.match(runbook, /check-secret-allowlist\.mjs/u);
  assert.match(runbook, /validate-secret-inputs\.mjs/u);
  assert.match(runbook, /verify-r2-private-state\.sh/u);
  assert.match(runbook, /backup-restore-preflight\.mjs --bootstrap --directory/u);
  assert.match(runbook, /PRIVATE_INPUT_DIR/gu);
  assert.match(runbook, /backup\.sh "\$BACKUP_OUTPUT"/u);
  assert.match(privateState, /public dev-url access is not proven disabled/u);
  assert.match(privateState, /automatic object deletion rule/u);
  assert.match(secretAllowlist, /exact V2-06 allowlist/u);
  assert.match(secretInputs, /approved runtime Neon identity/u);
});
