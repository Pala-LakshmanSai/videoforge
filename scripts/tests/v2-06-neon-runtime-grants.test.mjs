import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const GRANTS = new URL("../../deploy/v2-06/neon-runtime-grants.sql", import.meta.url);

test("the hosted runtime can append through the exact function but has no direct render-plan writes", async () => {
  const source = await readFile(GRANTS, "utf8");
  for (const table of [
    "hosted_render_plans",
    "timeline_plans",
    "generation_tasks",
    "generation_requests",
    "video_runtime_states",
    "video_runtime_lane_states",
    "serverless_attempts",
    "serverless_progress_events",
    "serverless_cost_ledgers",
    "serverless_output_receipts",
    "hosted_pair_zero_worker_observations",
  ]) {
    assert.match(
      source,
      new RegExp(`GRANT SELECT ON[\\s\\S]*?\\b${table}\\b[\\s\\S]*?TO :"runtime_role";`, "u"),
    );
  }
  assert.match(source, /GRANT EXECUTE ON FUNCTION public\.videoforge_current_account_id\(\)/u);
  assert.match(
    source,
    /GRANT EXECUTE ON FUNCTION public\.videoforge_archive_hosted_preset\(uuid, uuid, text, uuid\)\s+TO :"runtime_role";/u,
  );
  assert.match(
    source,
    /GRANT EXECUTE ON FUNCTION public\.videoforge_reserve_hosted_style_analysis\(uuid, text, uuid\)\s+TO :"runtime_role";/u,
  );
  assert.match(
    source,
    /GRANT EXECUTE ON FUNCTION public\.videoforge_finish_hosted_style_analysis\(uuid, text, text, text, bigint, bigint, bigint\)\s+TO :"runtime_role";/u,
  );
  assert.match(
    source,
    /GRANT EXECUTE ON FUNCTION public\.videoforge_redeem_hosted_invite\(text, text\)\s+TO :"runtime_role";/u,
  );
  assert.match(
    source,
    /GRANT EXECUTE ON FUNCTION public\.videoforge_read_system_avatar_version_assets\(uuid\)\s+TO :"runtime_role";/u,
  );
  assert.match(
    source,
    /GRANT EXECUTE ON FUNCTION public\.videoforge_consume_hosted_rate_limit\(text, text\)\s+TO :"runtime_role";/u,
  );
  assert.match(
    source,
    /GRANT EXECUTE ON FUNCTION public\.videoforge_append_hosted_render_plan\([\s\S]*?uuid, uuid, uuid, uuid, text, jsonb, text[\s\S]*?TO :"runtime_role";/u,
  );
  assert.match(
    source,
    /GRANT EXECUTE ON FUNCTION public\.videoforge_append_hosted_canonical_timing\([\s\S]*?uuid, uuid, uuid, uuid, uuid, uuid, jsonb[\s\S]*?TO :"runtime_role";/u,
  );
  for (const pattern of [
    /videoforge_prepare_hosted_voiceover_context\(jsonb\)/u,
    /videoforge_complete_hosted_voiceover_context\(jsonb\)/u,
    /videoforge_fail_hosted_voiceover_context\(uuid,text,text,boolean\)/u,
    /videoforge_load_hosted_prompt_plan\(uuid,uuid,uuid,uuid\)/u,
    /videoforge_prepare_hosted_prompt_run\(jsonb\)/u,
    /videoforge_complete_hosted_prompt_run\(jsonb\)/u,
    /videoforge_fail_hosted_prompt_run\(uuid,text,text,boolean\)/u,
  ]) {
    assert.match(source, pattern);
  }
  assert.doesNotMatch(
    source,
    /GRANT EXECUTE ON FUNCTION public\.videoforge_claim_hosted_paid_dispatch\([\s\S]*?numeric, numeric, timestamptz[\s\S]*?TO :"runtime_role";/u,
  );
  assert.match(
    source,
    /GRANT EXECUTE ON FUNCTION public\.videoforge_materialize_hosted_lane_batches\([\s\S]*?uuid, text, jsonb[\s\S]*?TO :"runtime_role";/u,
  );
  assert.match(
    source,
    /GRANT EXECUTE ON FUNCTION public\.videoforge_commit_hosted_atomic_pair_predispatch\([\s\S]*?numeric,timestamptz,jsonb[\s\S]*?TO :"runtime_role";/u,
  );
  assert.doesNotMatch(
    source,
    /GRANT\s+[^;\n]*(?:SELECT|INSERT|UPDATE|DELETE)[^;\n]*\bON\s+hosted_paid_dispatch_(?:approvals|claims)\b/iu,
  );
  assert.doesNotMatch(
    source,
    /GRANT\s+[^;\n]*(?:SELECT|INSERT|UPDATE|DELETE)[^;\n]*\bON\s+hosted_lane_batch(?:es|_items)\b/iu,
  );
  assert.doesNotMatch(
    source,
    /GRANT\s+[^;\n]*(?:INSERT|UPDATE|DELETE)[^;\n]*\bON\s+hosted_render_plans\b/iu,
  );
  assert.match(
    source,
    /GRANT SELECT, INSERT, UPDATE ON\s+avatar_profiles,\s+avatar_profile_versions,\s+image_styles,\s+image_style_versions\s+TO :"runtime_role";/u,
  );
  assert.match(
    source,
    /GRANT SELECT, INSERT ON\s+avatar_profile_assets,\s+image_style_references\s+TO :"runtime_role";/u,
  );
  assert.doesNotMatch(
    source,
    /GRANT\s+[^;\n]*DELETE[^;\n]*\bON\s+(?:avatar_profiles|avatar_profile_versions|avatar_profile_assets|image_styles|image_style_versions|image_style_references)\b/iu,
  );
  assert.doesNotMatch(
    source,
    /GRANT\s+[^;\n]*(?:INSERT|UPDATE|DELETE)[^;\n]*\bON\s+(?:hosted_voiceover_contexts|hosted_prompt_runs|prompt_executions|prompt_writer_attempts|prompt_scene_results|generation_tasks|attempts|outbox|cost_events)\b/iu,
  );
  assert.match(source, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"runtime_role";/u);
  assert.match(
    source,
    /never receives direct INSERT, UPDATE, or DELETE[\s\S]*only[\s\S]*write capability/u,
  );
});
