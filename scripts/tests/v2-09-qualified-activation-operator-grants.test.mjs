import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const grantsPath = "deploy/v2-09/neon-qualified-activation-operator-grants.sql";
const signature = "public.videoforge_import_hosted_v209_qualified_activation(jsonb)";

function compact(sql) {
  return sql
    .replace(/--[^\n]*/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

test("V2-09 qualification activation import is granted only to the hardened operator", async () => {
  const sql = compact(await readFile(grantsPath, "utf8"));
  assert.match(sql, /BEGIN; SET search_path = public, pg_catalog;/u);
  assert.match(sql, /SELECT pg_advisory_xact_lock\(1448494662,9\);/u);
  assert.match(sql, /count\(\*\)=3/u);
  assert.match(sql, /NOT rolsuper/u);
  assert.match(sql, /NOT rolcreaterole/u);
  assert.match(sql, /NOT rolcreatedb/u);
  assert.match(sql, /NOT rolinherit/u);
  assert.match(sql, /NOT rolreplication/u);
  assert.match(sql, /NOT rolbypassrls/u);

  for (const grantee of ["PUBLIC", ':"runtime_role"', ':"reconciler_role"']) {
    assert.ok(
      sql.includes(`REVOKE EXECUTE ON FUNCTION ${signature} FROM ${grantee};`),
      `missing deny for ${grantee}`,
    );
  }
  assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION ${signature} TO :"operator_role";`));
  assert.doesNotMatch(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.videoforge_import_hosted_v209_qualified_activation\(jsonb\) TO :"(?:runtime|reconciler)_role";/u,
  );
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE|ALL) ON/u);
  assert.match(sql, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"operator_role";/u);
  assert.match(sql, /REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM :"operator_role";/u);
  assert.match(sql, /NOT EXISTS \( SELECT 1 FROM information_schema\.role_table_grants/u);
  assert.match(sql, /NOT EXISTS \( SELECT 1 FROM information_schema\.role_usage_grants/u);
  assert.match(sql, /activation_import_acl_exact/u);
  assert.match(sql, /COMMIT;/u);
  assert.match(sql, /ROLLBACK;/u);
});

test("existing runtime and reconciler grant surfaces do not acquire activation import", async () => {
  const [runtime, reconciler] = await Promise.all([
    readFile("deploy/v2-06/neon-runtime-grants.sql", "utf8"),
    readFile("deploy/v2-13/neon-pair-reconciler-grants.sql", "utf8"),
  ]);
  const forbiddenGrant =
    /GRANT EXECUTE ON FUNCTION public\.videoforge_import_hosted_v209_qualified_activation\(jsonb\)/u;
  assert.doesNotMatch(runtime, forbiddenGrant);
  assert.doesNotMatch(reconciler, forbiddenGrant);
  assert.match(
    runtime,
    /Runtime receives no direct access to the activation, candidate, or materialization tables/u,
  );
  assert.match(
    reconciler,
    /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM :"reconciler_role";/u,
  );
});
