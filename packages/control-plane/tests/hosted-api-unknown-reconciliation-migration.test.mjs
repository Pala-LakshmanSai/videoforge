import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationUrl = new URL(
  "../migrations/0190_hosted_api_unknown_no_task_reconciliation.sql",
  import.meta.url,
);

test("0190 closes only the exact unknown Fal task after confirmed empty history", () => {
  const sql = readFileSync(migrationUrl, "utf8");
  for (const [column, identity] of [
    ["account_id", "supplied_account_id"],
    ["workspace_id", "supplied_workspace_id"],
    ["generation_request_id", "supplied_generation_request_id"],
    ["generation_task_id", "supplied_generation_task_id"],
    ["id", "supplied_job_id"],
    ["claim_id", "supplied_claim_id"],
  ]) {
    assert.match(sql, new RegExp(`j\\.${column}=${identity}`, "u"));
  }
  assert.match(sql, /supplied_expected_state IS DISTINCT FROM 'UNKNOWN_NO_RETRY'/u);
  assert.match(sql, /supplied_reason_code IS DISTINCT FROM 'FAL_HISTORY_CONFIRMED_NO_TASK'/u);
  assert.match(sql, /j\.lane='AVATAR'/u);
  assert.match(sql, /j\.provider_task_id IS NULL/u);
  assert.match(sql, /SET state='FAILED'/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC,videoforge_v209_runtime_dc9612d6/u);
  assert.doesNotMatch(sql, /UPDATE public\.provider_workload_leases/u);
  assert.doesNotMatch(sql, /videoforge_settle_hosted_api_failure/u);
});

test("0190 is manifest tail and digest matches migration contents", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../migrations/manifest.json", import.meta.url), "utf8"),
  );
  const tail = manifest.migrations.at(-1);
  assert.equal(tail.version, 190);
  assert.equal(tail.name, "hosted_api_unknown_no_task_reconciliation");
  assert.equal(tail.filename, "0190_hosted_api_unknown_no_task_reconciliation.sql");
  const digest = `sha256:${createHash("sha256").update(readFileSync(migrationUrl)).digest("hex")}`;
  assert.equal(tail.sha256, digest);
});
