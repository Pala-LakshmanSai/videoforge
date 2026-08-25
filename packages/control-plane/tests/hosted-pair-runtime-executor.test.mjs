import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../migrations/0043_hosted_pair_runtime_executor.sql",
  import.meta.url,
);
const grantsUrl = new URL("../../../deploy/v2-06/neon-runtime-grants.sql", import.meta.url);

test("0043 exposes only narrow SECURITY DEFINER pair capabilities", async () => {
  const [sql, grants] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(grantsUrl, "utf8"),
  ]);
  for (const name of [
    "videoforge_prepare_hosted_pair_send",
    "videoforge_begin_hosted_pair_send",
    "videoforge_finish_hosted_pair_send",
    "videoforge_inspect_hosted_pair_runtime",
    "videoforge_load_hosted_pair_activation",
  ]) {
    assert.match(sql, new RegExp(`CREATE FUNCTION public\\.${name}`, "u"));
    assert.match(sql, new RegExp(`${name}[\\s\\S]*SECURITY DEFINER`, "u"));
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}`, "u"));
    assert.match(grants, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}`, "u"));
  }
  assert.match(sql, /CREATE FUNCTION public\.videoforge_settle_hosted_pair_cleanup/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.videoforge_settle_hosted_pair_cleanup/u);
  assert.doesNotMatch(
    grants,
    /GRANT EXECUTE ON FUNCTION public\.videoforge_settle_hosted_pair_cleanup/u,
  );
  assert.doesNotMatch(grants, /GRANT (?:INSERT|UPDATE|DELETE)[^;]*serverless_/u);
  assert.doesNotMatch(
    grants,
    /GRANT (?:SELECT|INSERT|UPDATE|DELETE)[^;]*hosted_pair_runtime_states/u,
  );
});

test("0043 persists one-shot send ordering and fail-closed outcomes", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /target\.send_attempt_count<>0/u);
  assert.match(sql, /SET state='SENT',send_attempt_count=1/u);
  assert.match(sql, /pair\.phase<>'MAGE_ASSIGNED'/u);
  assert.match(sql, /other\.attempt_state<>'ASSIGNED' OR other\.outbox_state<>'ASSIGNED'/u);
  assert.match(sql, /state='DISPATCH_ACK_UNKNOWN'/u);
  assert.match(sql, /state='RECONCILING'/u);
  assert.match(sql, /state='DEAD_LETTER'/u);
  assert.match(sql, /state='PERMANENT_FAILED',terminal_at=db_now/u);
  assert.match(sql, /phase='SETTLED'/u);
  assert.match(sql, /state='RELEASED'/u);
  assert.match(sql, /hosted_serverless_output_barrier_completions completion/u);
  assert.match(sql, /WHEN 'COMPLETED' THEN 'SUCCEEDED'/u);
  assert.match(sql, /CASE WHEN all_completed THEN 'RENDERING' ELSE 'FAILED' END/u);
  assert.match(sql, /video_runtime_accepted_units/u);
  assert.match(sql, /state='FAILED'.*NOT all_completed/su);
  assert.match(sql, /HOSTED_PAIR_OUTPUTS_ACCEPTED/u);
  assert.doesNotMatch(sql, /SET state='READY_TO_DISPATCH'/u);
});

test("0043 reuses the full 0042 authority and token recovery predicate", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /videoforge_recover_hosted_atomic_pair_tokens/u);
  assert.match(sql, /recovered_count<>2/u);
  assert.match(sql, /pgp_sym_decrypt/u);
  assert.match(sql, /dispatch_token_sha256/u);
  assert.match(sql, /b\.payload->'envelope'/u);
  assert.match(sql, /JOIN public\.hosted_lane_batches b/u);
});
