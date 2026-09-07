import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const grantsPath = "deploy/v2-09/neon-qualified-activation-operator-grants.sql";
const signature = "public.videoforge_import_hosted_v209_qualified_activation(jsonb)";
const loadSignature = "public.videoforge_load_hosted_gpu_activation_v2()";
const baselineSignature =
  "public.videoforge_read_hosted_v209_completion_baseline(uuid,uuid,bigint)";

function compact(sql) {
  return sql
    .replace(/--[^\n]*/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

test("V2-09 activation import is operator-only and its readback loader is runtime-readable", async () => {
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
  for (const ownerColumn of [
    "datdba",
    "extowner",
    "relowner",
    "nspowner",
    "proowner",
    "typowner",
    "fdwowner",
    "srvowner",
    "evtowner",
    "spcowner",
    "pubowner",
    "subowner",
    "lomowner",
    "collowner",
    "cfgowner",
    "dictowner",
  ])
    assert.match(sql, new RegExp(`SELECT ${ownerColumn}`, "u"), ownerColumn);
  assert.match(sql, /WHERE owner_role\.rolname=:'operator_role'/u);

  for (const grantee of ["PUBLIC", ':"runtime_role"', ':"reconciler_role"']) {
    assert.ok(
      sql.includes(`REVOKE EXECUTE ON FUNCTION ${signature} FROM ${grantee};`),
      `missing deny for ${grantee}`,
    );
  }
  for (const grantee of ["PUBLIC", ':"reconciler_role"']) {
    assert.ok(
      sql.includes(`REVOKE EXECUTE ON FUNCTION ${loadSignature} FROM ${grantee};`),
      `missing load deny for ${grantee}`,
    );
  }
  assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION ${signature} TO :"operator_role";`));
  assert.ok(
    sql.includes(
      `GRANT EXECUTE ON FUNCTION ${loadSignature} TO :"operator_role", :"runtime_role";`,
    ),
  );
  assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION ${baselineSignature} TO :"operator_role";`));
  for (const grantee of ["PUBLIC", ':"runtime_role"'])
    assert.ok(sql.includes(`REVOKE EXECUTE ON FUNCTION ${baselineSignature} FROM ${grantee};`));
  assert.doesNotMatch(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.videoforge_import_hosted_v209_qualified_activation\(jsonb\) TO :"(?:runtime|reconciler)_role";/u,
  );
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE|ALL) ON/u);
  assert.match(sql, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"operator_role";/u);
  assert.match(sql, /REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM :"operator_role";/u);
  assert.match(sql, /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM :"operator_role";/u);
  assert.match(sql, /NOT EXISTS \( SELECT 1 FROM information_schema\.role_table_grants/u);
  assert.match(sql, /NOT EXISTS \( SELECT 1 FROM information_schema\.role_usage_grants/u);
  assert.match(sql, /member_role\.rolname=current_user/u);
  assert.match(sql, /membership\.admin_option/u);
  assert.match(sql, /NOT membership\.inherit_option/u);
  assert.match(sql, /NOT membership\.set_option/u);
  assert.match(sql, /AND 1 >= \( SELECT count\(\*\) FROM pg_auth_members/u);
  assert.doesNotMatch(sql, /has_function_privilege\('PUBLIC'/u);
  assert.equal(
    sql.match(/public_acl\.grantee=0 AND public_acl\.privilege_type='EXECUTE'/gu)?.length,
    3,
  );
  assert.match(sql, /activation_import_acl_exact/u);
  assert.match(sql, /procedure\.oid::regprocedure::text<>ALL/u);
  assert.match(sql, /videoforge_load_hosted_gpu_activation_v2\(\)/u);
  assert.match(sql, /COMMIT;/u);
  assert.match(sql, /ROLLBACK;/u);
});

test("V2-09 operator ACL verification failures always exit psql nonzero", async () => {
  const sql = await readFile(grantsPath, "utf8");
  assert.doesNotMatch(sql, /^\\quit(?:\s|$)/gmu);
  assert.equal(sql.match(/^SELECT 1\/0;$/gmu)?.length, 5);
  assert.equal(sql.match(/^ROLLBACK;\nSELECT 1\/0;$/gmu)?.length, 2);
  assert.ok(sql.indexOf("\\set ON_ERROR_STOP on") < sql.indexOf("\\if"));
});

test("V2-09 activation import and completion baseline use only hardened SECURITY DEFINER capabilities", async () => {
  const [importSql, migration] = await Promise.all([
    readFile("deploy/v2-09/neon-import-qualified-activation.sql", "utf8"),
    readFile("packages/control-plane/migrations/0084_hosted_v209_staged_click_cleanup.sql", "utf8"),
  ]);
  const calledFunctions = [...importSql.matchAll(/public\.(videoforge_[a-z0-9_]+)\s*\(/gu)].map(
    ([, name]) => name,
  );
  assert.deepEqual(calledFunctions, [
    "videoforge_import_hosted_v209_qualified_activation",
    "videoforge_load_hosted_gpu_activation_v2",
  ]);
  assert.match(
    migration,
    /CREATE FUNCTION public\.videoforge_load_hosted_gpu_activation_v2\(\) RETURNS jsonb\s+LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public/u,
  );
  const importMigration = await readFile(
    "packages/control-plane/migrations/0074_hosted_v209_ordinary_dispatch.sql",
    "utf8",
  );
  assert.match(
    importMigration,
    /CREATE FUNCTION public\.videoforge_import_hosted_v209_qualified_activation\(supplied jsonb\)\s+RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog/u,
  );
  assert.match(importSql, /\\set ON_ERROR_STOP on/u);
  assert.match(importSql, /BEGIN;[\s\S]*COMMIT;/u);
});

test("V2-09 runtime receives loader only while reconciler and both roles lack activation import", async () => {
  const [runtime, reconciler] = await Promise.all([
    readFile("deploy/v2-09/neon-v209-runtime-grants.sql", "utf8"),
    readFile("deploy/v2-09/neon-pair-reconciler-grants.sql", "utf8"),
  ]);
  const forbiddenGrant =
    /GRANT EXECUTE ON FUNCTION public\.videoforge_import_hosted_v209_qualified_activation\(jsonb\)/u;
  assert.doesNotMatch(runtime, forbiddenGrant);
  assert.doesNotMatch(reconciler, forbiddenGrant);
  assert.match(runtime, /\('videoforge_load_hosted_gpu_activation_v2\(\)'\)/u);
  assert.match(
    reconciler,
    /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM :"reconciler_role";/u,
  );
});
