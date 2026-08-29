import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BINDINGS = resolve(ROOT, "deploy/v2-13/production-pair-bindings.template.json");
const RECONCILER_GRANTS = resolve(ROOT, "deploy/v2-13/neon-pair-reconciler-grants.sql");
const RUNTIME_GRANTS = resolve(ROOT, "deploy/v2-06/neon-runtime-grants.sql");
const WRANGLER = resolve(ROOT, "apps/web/wrangler.production.jsonc");
const fail = (message) => {
  throw new Error(`V2-13 production pair boundary validator: ${message}`);
};
const exactKeys = (value, expected) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());

export function validateProductionPairBoundary({ bindings, reconcilerSql, runtimeSql, wrangler }) {
  if (
    !exactKeys(bindings, [
      "activation",
      "database_roles",
      "migration_ledger",
      "schema_version",
      "secret_bindings",
      "state",
    ]) ||
    bindings.schema_version !== "videoforge-v2-13-production-pair-bindings/v1" ||
    bindings.state !== "DISABLED_UNQUALIFIED" ||
    !exactKeys(bindings.migration_ledger, ["exact_manifest_required", "first", "last"]) ||
    bindings.migration_ledger.first !== 37 ||
    bindings.migration_ledger.last !== 49 ||
    bindings.migration_ledger.exact_manifest_required !== true
  )
    fail("binding contract or exact 0037-0049 ledger gate drifted");
  if (
    !exactKeys(bindings.database_roles, ["must_be_distinct", "reconciler", "runtime"]) ||
    bindings.database_roles.must_be_distinct !== true ||
    bindings.database_roles.runtime === bindings.database_roles.reconciler ||
    !String(bindings.database_roles.runtime).includes("__V2_13_") ||
    !String(bindings.database_roles.reconciler).includes("__V2_13_")
  )
    fail("runtime and reconciler roles must remain distinct unresolved identities");
  const secrets = [
    "DATABASE_URL",
    "VIDEOFORGE_RECONCILER_DATABASE_URL",
    "VIDEOFORGE_DISPATCH_TOKEN_KEY",
    "VIDEOFORGE_DISPATCH_TOKEN_KEY_ID",
    "VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX",
    "VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID",
    "VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY",
    "VIDEOFORGE_PROVIDER_PROOF_KEY_ID",
    "RUNPOD_API_KEY",
    "RUNPOD_API_BASE_URL",
    "VIDEOFORGE_MAGE_ENDPOINT_ID",
    "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
    "VIDEOFORGE_SOULX_ENDPOINT_ID",
    "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
    "VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN",
  ];
  if (
    !exactKeys(bindings.secret_bindings, [
      "dispatch_token_key",
      "dispatch_token_key_id",
      "envelope_signing_key",
      "envelope_signing_key_id",
      "provider_proof_verify_key",
      "provider_proof_key_id",
      "runpod_api_key",
      "runpod_api_base_url",
      "mage_endpoint_id",
      "mage_endpoint_id_sha256",
      "soulx_endpoint_id",
      "soulx_endpoint_id_sha256",
      "workflow_operator_token",
      "reconciler_database",
      "runtime_database",
    ]) ||
    JSON.stringify(Object.values(bindings.secret_bindings)) !== JSON.stringify(secrets)
  )
    fail("secret binding names drifted");
  if (
    !exactKeys(bindings.activation, [
      "both_fresh_qualifications_required",
      "credential_reads_authorized",
      "deployment_authorized",
      "exact_deployments_required",
      "exact_paid_approval_required",
      "external_spend_usd",
      "provider_calls_authorized",
    ]) ||
    bindings.activation.both_fresh_qualifications_required !== true ||
    bindings.activation.exact_paid_approval_required !== true ||
    bindings.activation.exact_deployments_required !== true ||
    bindings.activation.provider_calls_authorized !== false ||
    bindings.activation.deployment_authorized !== false ||
    bindings.activation.credential_reads_authorized !== false ||
    bindings.activation.external_spend_usd !== 0
  )
    fail("disabled activation boundary drifted");
  const settlement = "public.videoforge_settle_hosted_pair_cleanup(uuid,uuid,uuid,jsonb)";
  for (const required of [
    "\\set ON_ERROR_STOP on\nBEGIN;",
    ":'runtime_role'<>:'reconciler_role'",
    "rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolinherit",
    "NOT rolreplication AND NOT rolbypassrls",
    `REVOKE EXECUTE ON FUNCTION ${settlement}\nFROM PUBLIC`,
    `REVOKE EXECUTE ON FUNCTION ${settlement}\nFROM :"runtime_role"`,
    `REVOKE EXECUTE ON FUNCTION ${settlement}\nFROM :"runtime_role"`,
    "GRANT EXECUTE ON FUNCTION public.videoforge_settle_hosted_pair_cleanup_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb)",
    "GRANT EXECUTE ON FUNCTION public.videoforge_load_hosted_v209_settlement_guard(uuid,uuid,uuid)",
    "GRANT EXECUTE ON FUNCTION public.videoforge_complete_v209_terminal_acceptance(jsonb)",
    "NOT has_function_privilege(:'runtime_role'",
    "NOT has_function_privilege('PUBLIC'",
    "NOT has_function_privilege(:'reconciler_role'",
    "NOT has_table_privilege(:'reconciler_role','public.serverless_attempts','SELECT')",
    "NOT has_table_privilege(:'reconciler_role','public.provider_workload_leases','UPDATE')",
  ]) {
    if (!reconcilerSql.includes(required)) fail(`reconciler ACL proof lacks ${required}`);
  }
  if (!/\\if :pair_acl_exact\s+COMMIT;\s+\\else\s+ROLLBACK;/u.test(reconcilerSql))
    fail("reconciler ACL changes are not commit-after-proof transactional");
  if (
    /GRANT EXECUTE ON FUNCTION public\.videoforge_settle_hosted_pair_cleanup\(uuid,uuid,uuid,jsonb\)\s+TO :"runtime_role"/u.test(
      runtimeSql,
    ) ||
    /GRANT EXECUTE ON FUNCTION public\.videoforge_record_hosted_pair_zero_worker\(uuid,uuid,uuid,jsonb\)\s+TO :"reconciler_role"/u.test(
      reconcilerSql,
    )
  )
    fail("runtime or reconciler can bypass atomic v2 settlement");
  if (
    /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)[^;]*\bON\s+hosted_lane_batch(?:es|_items)\b/iu.test(
      runtimeSql,
    )
  )
    fail("runtime must not receive direct 0041 table privileges");
  const parsedWrangler = JSON.parse(
    wrangler.replace(/^\s*\/\/.*$/gmu, "").replace(/,\s*([}\]])/gu, "$1"),
  );
  const vars = parsedWrangler.vars ?? {};
  for (const secret of secrets) {
    if (Object.hasOwn(vars, secret)) fail(`${secret} must never be a plaintext Wrangler var`);
  }
  if (vars.VIDEOFORGE_GPU_TRANSPORT !== "DISABLED_UNQUALIFIED")
    fail("production GPU transport must remain disabled");
  return Object.freeze({
    schema_version: "videoforge-v2-13-production-pair-boundary-validation/v1",
    state: "DISABLED_UNQUALIFIED",
    runtime_can_settle: false,
    reconciler_can_settle: true,
    provider_calls: 0,
    credential_reads: 0,
    external_spend_usd: 0,
  });
}

async function main() {
  const [bindings, reconcilerSql, runtimeSql, wrangler] = await Promise.all([
    readFile(BINDINGS, "utf8").then(JSON.parse),
    readFile(RECONCILER_GRANTS, "utf8"),
    readFile(RUNTIME_GRANTS, "utf8"),
    readFile(WRANGLER, "utf8"),
  ]);
  process.stdout.write(
    `${JSON.stringify(validateProductionPairBoundary({ bindings, reconcilerSql, runtimeSql, wrangler }))}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
