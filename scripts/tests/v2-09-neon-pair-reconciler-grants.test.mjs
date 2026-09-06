import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../deploy/v2-09/neon-pair-reconciler-grants.sql", import.meta.url),
  "utf8",
);
const compact = source.replaceAll(/\s+/gu, "");

const exactFunctions = [
  "videoforge_current_account_id()",
  "videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid)",
  "videoforge_settle_hosted_pair_cleanup_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb)",
  "videoforge_load_hosted_v209_settlement_guard(uuid,uuid,uuid)",
  "videoforge_complete_v209_terminal_acceptance(jsonb)",
  "videoforge_load_v209_terminal_output_projection(uuid,uuid,uuid,text)",
  "videoforge_read_hosted_v209_terminal_lineage(uuid,uuid,uuid,text,text)",
  "videoforge_accept_hosted_v209_terminal_output(uuid,uuid,uuid,text,text,text,jsonb,jsonb,timestamptz)",
  "videoforge_read_hosted_v209_ready_render_inputs(uuid,uuid,uuid)",
  "videoforge_commit_hosted_v209_resolved_render_manifest(uuid,uuid,uuid,jsonb,text,text,bigint)",
  "videoforge_settle_hosted_v209_success_costs(uuid,uuid,uuid,jsonb)",
  "videoforge_read_hosted_v209_project_revision_net_cost(uuid,uuid,uuid)",
  "videoforge_read_v209_render_terminal_candidate(uuid,uuid,uuid)",
  "videoforge_finalize_v209_render_terminal(jsonb)",
  "videoforge_reconcile_hosted_v209_staged_click(jsonb)",
];

test("V2-09 reconciler grants only the ordinary pair terminal and render capabilities", () => {
  assert.match(source, /pg_advisory_xact_lock\(1448494662,9\)/u);
  assert.match(source, /REVOKE ALL ON ALL TABLES IN SCHEMA public/u);
  assert.match(source, /REVOKE ALL ON ALL SEQUENCES IN SCHEMA public/u);
  assert.match(source, /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public/u);
  assert.match(source, /NOT rolinherit/u);
  assert.match(source, /rolconfig IS NULL/u);
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
    assert.match(source, new RegExp(`SELECT ${ownerColumn}`, "u"), ownerColumn);
  for (const signature of exactFunctions)
    assert.ok(compact.includes(`public.${signature.replaceAll(/\s+/gu, "")}`), signature);
  for (const forbidden of [
    "videoforge_publish_v213_qualified_deployments",
    "videoforge_record_v213_acceptance_authority",
    "videoforge_prepare_v213_v211_policy_action",
    "videoforge_load_v212_terminal_output_projection",
    "INSERT ON",
    "UPDATE ON",
    "DELETE ON",
  ])
    assert.doesNotMatch(source, new RegExp(forbidden, "u"));
});

test("V2-09 reconciler ACL proof keeps irreversible terminal writes away from runtime", () => {
  for (const signature of [
    "videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid)",
    "videoforge_settle_hosted_pair_cleanup_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb)",
    "videoforge_load_hosted_v209_settlement_guard(uuid,uuid,uuid)",
    "videoforge_complete_v209_terminal_acceptance(jsonb)",
    "videoforge_load_v209_terminal_output_projection(uuid,uuid,uuid,text)",
    "videoforge_read_hosted_v209_terminal_lineage(uuid,uuid,uuid,text,text)",
    "videoforge_accept_hosted_v209_terminal_output(uuid,uuid,uuid,text,text,text,jsonb,jsonb,timestamp with time zone)",
    "videoforge_read_hosted_v209_ready_render_inputs(uuid,uuid,uuid)",
    "videoforge_commit_hosted_v209_resolved_render_manifest(uuid,uuid,uuid,jsonb,text,text,bigint)",
    "videoforge_settle_hosted_v209_success_costs(uuid,uuid,uuid,jsonb)",
    "videoforge_read_hosted_v209_project_revision_net_cost(uuid,uuid,uuid)",
    "videoforge_read_v209_render_terminal_candidate(uuid,uuid,uuid)",
    "videoforge_finalize_v209_render_terminal(jsonb)",
    "videoforge_reconcile_hosted_v209_staged_click(jsonb)",
  ])
    assert.ok(
      compact.includes(
        `NOThas_function_privilege(:'runtime_role','public.${signature.replaceAll(/\s+/gu, "")}','EXECUTE')`,
      ),
      signature,
    );
  assert.match(source, /procedure\.oid::regprocedure::text<>ALL/u);
  assert.match(source, /AND NOT EXISTS \(\s*SELECT 1 FROM pg_depend/u);
});

test("V2-09 reconciler ACL verification failures always exit psql nonzero", () => {
  assert.doesNotMatch(source, /^\\quit\s*$/gmu);
  assert.equal(source.match(/^\\quit 1$/gmu)?.length, 4);
  assert.equal(source.match(/^ROLLBACK;\n\\quit 1$/gmu)?.length, 2);
});
