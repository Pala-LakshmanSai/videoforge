import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationUrl = new URL("../migrations/0198_hosted_api_render_io_recovery.sql", import.meta.url);
const sql = readFileSync(migrationUrl, "utf8");

test("0198 allows only the prior disk retry's failed I/O attempt without another provider action", () => {
  assert.match(sql, /first_recovery\.retry_attempt_id<>supplied_failed_attempt_id/u);
  assert.match(sql, /first_recovery\.state<>'CONSUMED'/u);
  assert.match(sql, /lease\.failure_code='MEDIA_EXECUTION_IO_FAILED'/u);
  assert.match(sql, /lease\.failure_code='MEDIA_EXECUTION_DISK_SPACE_INSUFFICIENT'/u);
  assert.match(sql, /authority\.attempt_id IN \(failed\.id,original\.id\) AND authority\.issued_at IS NOT NULL/u);
  assert.match(sql, /job\.kind='RENDER'\)<>2/u);
  assert.match(sql, /event\.reason='FINAL_OUTPUT_DURABLE'/u);
  assert.match(sql, /provider_actions_created',false/u);
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE) public\.(?:api_generation_jobs|provider_workload_leases)/u);
});

test("0198 is the manifest tail with its exact digest", () => {
  const manifest = JSON.parse(readFileSync(new URL("../migrations/manifest.json", import.meta.url), "utf8"));
  const tail = manifest.migrations.at(-1);
  assert.deepEqual([tail.version, tail.name, tail.filename],
    [198, "hosted_api_render_io_recovery", "0198_hosted_api_render_io_recovery.sql"]);
  assert.equal(tail.sha256,
    `sha256:${createHash("sha256").update(readFileSync(migrationUrl)).digest("hex")}`);
});
