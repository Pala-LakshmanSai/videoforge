import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../migrations/0111_hosted_v209_outboxed_horizon_recovery.sql", import.meta.url), "utf8");

test("0111 preserves exact outbox and sealed authority while renewing only the bounded horizon", () => {
  assert.match(sql, /immutable[\s\S]*predispatch authority/);
  assert.match(sql, /UPDATE public\.provider_workload_leases/);
  assert.match(sql, /mage_outbox\.send_attempt_count<>0 OR soulx_outbox\.send_attempt_count<>0/);
  assert.match(sql, /mage_outbox\.version<>1 OR soulx_outbox\.version<>1/);
  assert.match(sql, /requested_reconciliation_deadline>expected_authority_deadline/);
  assert.match(sql, /min_authority_deadline<>expected_authority_deadline/);
  assert.match(sql, /providerActionsCreated',false/);
  assert.doesNotMatch(sql, /UPDATE public\.serverless_dispatch_outbox/);
  assert.doesNotMatch(sql, /UPDATE public\.serverless_predispatch_authorities/);
  assert.doesNotMatch(sql, /INSERT INTO public\.serverless_dispatch_outbox/);
  assert.doesNotMatch(sql, /INSERT INTO public\.serverless_provider_assignments/);
});

test("0111 is replay-safe and requires the exact untouched materialized pair", () => {
  assert.match(sql, /WHERE r\.operation_id=operation_id/);
  assert.match(sql, /materialization_count<>2/);
  assert.match(sql, /authority_count<>2/);
  assert.match(sql, /mage\.state<>'OUTBOXED' OR soulx\.state<>'OUTBOXED'/);
  assert.match(sql, /EXISTS\(SELECT 1 FROM public\.serverless_provider_assignments/);
  assert.match(sql, /renewal_ordinal,[\s\S]*1,NULL,NULL/);
});
