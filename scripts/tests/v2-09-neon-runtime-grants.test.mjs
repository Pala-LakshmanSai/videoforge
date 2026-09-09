import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../deploy/v2-09/neon-v209-runtime-grants.sql", import.meta.url),
  "utf8",
);

test("V2-09 runtime grants rebuild a closed pre-V2-10 function allowlist", () => {
  assert.match(source, /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public/u);
  assert.match(source, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC/u);
  assert.match(source, /v209_runtime_function_allowlist/u);
  assert.match(source, /procedure\.oid::regprocedure::text NOT IN/u);
  assert.match(source, /member_role\.rolname=current_user/u);
  assert.match(source, /membership\.admin_option/u);
  assert.match(source, /NOT membership\.inherit_option/u);
  assert.match(source, /NOT membership\.set_option/u);
  assert.match(source, /AND 1 >= \(\s*SELECT count\(\*\) FROM pg_auth_members/u);
  for (const required of [
    "videoforge_materialize_hosted_v209_ordinary_dispatch",
    "videoforge_commit_hosted_v209_ordinary_pair",
    "videoforge_begin_hosted_v209_ordinary_send",
    "videoforge_materialize_hosted_v209_span_audio_jobs",
    "videoforge_materialize_hosted_v209_system_avatar_reference",
    "videoforge_load_hosted_pair_workflow_schedule",
  ])
    assert.match(source, new RegExp(required, "u"));
  assert.match(
    source,
    /\('videoforge_renew_hosted_v209_ordinary_candidate\(uuid,uuid,uuid,uuid,uuid,uuid,integer,integer,text,uuid,uuid\)'\)/u,
  );
  assert.doesNotMatch(source, /videoforge_effective_hosted_v209_candidate/u);
  assert.doesNotMatch(source, /videoforge_[A-Za-z0-9_]*v21[0-3]/u);
  // The hosted runtime needs tenant table access, but never blanket table/sequence powers.
  assert.doesNotMatch(source, /GRANT\s+ALL(?:\s+PRIVILEGES)?\s+ON/iu);
  assert.doesNotMatch(source, /GRANT[^;]*ON\s+ALL\s+(?:TABLES|SEQUENCES)/iu);
  assert.doesNotMatch(source, /GRANT[^;]*(?:BYPASSRLS|TRUNCATE|REFERENCES|TRIGGER)/iu);
  assert.match(source, /NOT rolbypassrls/u);
  assert.match(source, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM/u);
  for (const [table, privilege] of [
    ["media_worker_devices", "SELECT"],
    ["media_worker_devices", "UPDATE"],
    ["hosted_auth_sessions", "INSERT"],
    ["projects", "INSERT"],
    ["hosted_render_plans", "SELECT"],
  ])
    assert.ok(source.includes(`('${table}','${privilege}')`));
  assert.ok(!source.includes("('hosted_render_plans','UPDATE')"));
  assert.ok(!source.includes("('media_worker_devices','DELETE')"));
});

test("V2-09 runtime grant failure paths exit nonzero", () => {
  assert.doesNotMatch(source, /^\\quit(?:\s|$)/gmu);
  assert.equal(source.match(/^SELECT 1\/0;$/gmu)?.length, 3);
  assert.equal(source.match(/^ROLLBACK;\nSELECT 1\/0;$/gmu)?.length, 2);
  assert.ok(source.indexOf("\\set ON_ERROR_STOP on") < source.indexOf("\\if"));
});
