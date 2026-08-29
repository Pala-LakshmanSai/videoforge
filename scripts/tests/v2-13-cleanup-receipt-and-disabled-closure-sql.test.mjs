import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "packages/control-plane/migrations/0046_hosted_full_live_cleanup_recovery.sql",
  "utf8",
);
const grants = readFileSync("deploy/v2-13/neon-full-live-operator-grants.sql", "utf8");
const adapters = readFileSync("deploy/v2-13/full-live-adapters.mjs", "utf8");

function body(name) {
  const direct = migration.indexOf(`CREATE FUNCTION public.${name}`);
  const replacement = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  const start = direct === -1 ? replacement : direct;
  assert.notEqual(start, -1, `${name} missing`);
  const end = migration.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${name} terminator missing`);
  return migration.slice(start, end + 4);
}

test("disabled promotion closure is append-only, no-activation-only, exact, and operator-only", () => {
  const closure = body("videoforge_record_v213_disabled_promotion_closure");
  assert.match(closure, /LANGUAGE plpgsql SECURITY DEFINER/u);
  assert.match(closure, /videoforge\.v213-disabled-promotion-closure\/v1/u);
  assert.match(closure, /hosted_full_live_cloudflare_activations/u);
  assert.match(closure, /EXISTS\(SELECT 1[\s\S]*activation\.promotion_id=promotion\.id\)/u);
  assert.match(closure, /disabledConfigSha256'<>promotion\.disabled_config_sha256/u);
  assert.match(closure, /routeVersionSha256'[\s\S]*disabledVersionIdSha256/u);
  assert.match(closure, /db_now-interval '5 minutes'/u);
  assert.match(closure, /disabled promotion closure replay drift/u);
  assert.ok(
    closure.indexOf("existing.id IS NOT NULL") < closure.indexOf("observed_at_value>db_now"),
    "exact replay must return before insertion freshness validation",
  );
  assert.match(
    migration,
    /CREATE TRIGGER hosted_full_live_disabled_promotion_closures_append_only/u,
  );
  assert.match(
    migration,
    /ALTER TABLE public\.hosted_full_live_disabled_promotion_closures FORCE ROW LEVEL SECURITY/u,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.videoforge_record_v213_disabled_promotion_closure\(uuid,jsonb\)/u,
  );
  for (const source of [grants, adapters])
    assert.match(source, /videoforge_record_v213_disabled_promotion_closure\(uuid,jsonb\)/u);
});

test("cleanup receipt intent durably distinguishes no attempt from ACK_UNKNOWN", () => {
  const claim = body("videoforge_claim_v213_cleanup_receipt_intent");
  assert.match(claim, /LANGUAGE plpgsql SECURITY DEFINER/u);
  for (const operation of [
    "restore-endpoints-max-one",
    "prove-zero-workers",
    "read-settled-billing",
    "reconcile-exact-resources",
  ])
    assert.match(claim, new RegExp(operation, "u"));
  assert.match(claim, /'intentState','NO_ATTEMPT'/u);
  assert.match(claim, /'intentState','ACK_UNKNOWN'/u);
  assert.match(claim, /Return it before inspecting the fresh document at all/u);
  assert.doesNotMatch(claim, /cleanup receipt intent replay drift/u);
  assert.ok(
    claim.indexOf("SELECT * INTO existing FROM public.hosted_full_live_cleanup_receipt_intents") <
      claim.indexOf("IF jsonb_typeof(document)"),
    "existing intent must be returned before validating fresh provider evidence/document",
  );
  assert.doesNotMatch(claim, /hosted_full_live_materialization_challenges/u);
  assert.match(claim, /hosted_full_live_authorities/u);
  assert.match(claim, /videoforge_v213_jit_sha256\(document->'summary'\)/u);
  assert.match(claim, /videoforge_v213_jit_sha256\(document\)/u);
  assert.match(migration, /hosted_full_live_cleanup_receipt_intents_append_only/u);
  assert.match(
    migration,
    /ALTER TABLE public\.hosted_full_live_cleanup_receipt_intents FORCE ROW LEVEL SECURITY/u,
  );
  const receipt = body("videoforge_record_v213_operation_receipt");
  assert.match(receipt, /hosted_full_live_cleanup_receipt_intents/u);
  assert.match(receipt, /intent\.receipt_artifact_sha256<>supplied->>'artifactSha256'/u);
  for (const source of [grants, adapters])
    assert.match(source, /videoforge_claim_v213_cleanup_receipt_intent\(jsonb\)/u);
});

test("operator grant ACL contains each recovery function exactly in grant and expected sets", () => {
  for (const signature of [
    "videoforge_claim_v213_cleanup_receipt_intent(jsonb)",
    "videoforge_record_v213_disabled_promotion_closure(uuid,jsonb)",
  ]) {
    assert.equal(grants.split(signature).length - 1, 3, signature);
    assert.equal(adapters.split(`"${signature}"`).length - 1, 1, signature);
  }
});
