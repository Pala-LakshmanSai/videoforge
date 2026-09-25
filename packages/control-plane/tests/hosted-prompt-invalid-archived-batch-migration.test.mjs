import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = new URL("../migrations/0203_hosted_prompt_invalid_archived_batch.sql", import.meta.url);
const sql = readFileSync(migration, "utf8");

test("0203 adjudicates only the exact unresolved claimed batch and settles known provider cost", () => {
  assert.match(sql, /videoforge_adjudicate_invalid_hosted_prompt_batch\(\s*supplied_run_id uuid,\s*supplied_provider_task_uuid text,\s*supplied_response_hash text,\s*supplied_known_cost_micro_usd bigint/u);
  assert.match(sql, /claim\.task_id=run\.task_id[\s\S]*claim\.attempt_id=run\.attempt_id AND claim\.outbox_id=run\.outbox_id/u);
  assert.match(sql, /claim\.batch_ordinal=prior_batch_count FOR UPDATE/u);
  assert.match(sql, /claim_row\.provider_task_uuid IS DISTINCT FROM supplied_provider_task_uuid/u);
  assert.match(sql, /run\.state<>'UNKNOWN' OR run\.provider_may_have_charged IS NOT TRUE/u);
  assert.match(sql, /'response_hash',supplied_response_hash[\s\S]*'known_cost_micro_usd',supplied_known_cost_micro_usd/u);
  assert.match(sql, /receipt\.result_payload=evidence[\s\S]*RETURN false/u);
  assert.match(sql, /videoforge_fail_hosted_prompt_run\(\s*run\.id,'FAILED','HOSTED_PROMPT_OUTPUT_INVALID',false,supplied_known_cost_micro_usd/u);
  assert.doesNotMatch(sql, /DELETE FROM public\.hosted_prompt_batch_claims|UPDATE public\.hosted_prompt_batch_claims|INSERT INTO public\.hosted_prompt_batch_claims/u);
  assert.doesNotMatch(sql, /videoforge_claim_hosted_prompt_batch|GRANT EXECUTE/u);
});

test("0203 manifest digest matches the immutable migration", () => {
  const manifest = JSON.parse(readFileSync(new URL("../migrations/manifest.json", import.meta.url), "utf8"));
  const tail = manifest.migrations.at(-1);
  assert.deepEqual([tail.version, tail.name, tail.filename], [
    203, "hosted_prompt_invalid_archived_batch", "0203_hosted_prompt_invalid_archived_batch.sql",
  ]);
  assert.equal(tail.sha256, `sha256:${createHash("sha256").update(readFileSync(migration)).digest("hex")}`);
});
