import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrationSliceThrough, PGliteExecutor } from "./support/pglite.mjs";

const ACCOUNT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REVISION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const REQUEST_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MAGE_ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
const SOULX_ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const MAGE_ASSIGNMENT_ID = "33333333-3333-4333-8333-333333333333";
const SOULX_ASSIGNMENT_ID = "44444444-4444-4444-8444-444444444444";
const MAGE_DEPLOYMENT_ID = "55555555-5555-4555-8555-555555555555";
const SOULX_DEPLOYMENT_ID = "66666666-6666-4666-8666-666666666666";
const ANCHOR = "2020-01-01T00:00:00.000Z";
const MAGE_COMPLETED_AT = "2020-01-01T00:08:07.000Z";
const CANCEL_AT = "2020-01-01T00:40:00.000Z";
const STOP_AT = "2020-01-01T00:50:00.000Z";
const SHA = (digit) => `sha256:${(Number(digit) % 16).toString(16).repeat(64)}`;

async function readMigration(name) {
  return readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
}

async function seedFundedPair(database) {
  await database.query("SELECT set_config('videoforge.account_id',$1,false)", [ACCOUNT_ID]);
  await database.exec(`
    ALTER TABLE public.hosted_v209_short_admissions DISABLE TRIGGER ALL;
    ALTER TABLE public.serverless_attempts DISABLE TRIGGER ALL;
    ALTER TABLE public.serverless_provider_assignments DISABLE TRIGGER ALL;
    ALTER TABLE public.hosted_serverless_output_barrier_completions DISABLE TRIGGER ALL;
  `);
  const budget = {
    budgetVersion: "ordinary-video-budget/v1",
    hardVariableCostCeilingMicroUsd: 2000000,
    totalGpuTimeoutSeconds: 2400,
    mageImageTimeoutSeconds: 2400,
    soulxAvatarTimeoutSeconds: 2400,
  };
  await database.query(
    `INSERT INTO public.hosted_v209_short_admissions(
      account_id,workspace_id,generation_request_id,admission_sha256,plan_sha256,
      work_manifest_sha256,phase_cap_micro_usd,combined_cap_micro_usd,
      billing_baseline_micro_usd,billing_baseline_checked_at,database_observed_at,
      provider_observed_at,cancel_at,stop_at,no_redispatch,admission_document,created_at
    ) VALUES($1,$2,$3,$4,$5,$6,2000000,17500000,0,$7,$7,$7,$8,$9,true,$10::jsonb,$7)`,
    [
      ACCOUNT_ID,
      WORKSPACE_ID,
      REQUEST_ID,
      SHA(1),
      SHA(2),
      SHA(3),
      ANCHOR,
      CANCEL_AT,
      STOP_AT,
      JSON.stringify({ cost: budget }),
    ],
  );
  const attempts = [
    [MAGE_ATTEMPT_ID, MAGE_DEPLOYMENT_ID, "mage_image", SHA(4), 1],
    [SOULX_ATTEMPT_ID, SOULX_DEPLOYMENT_ID, "soulx_avatar", SHA(5), 2],
  ];
  for (const [attemptId, deploymentId, lane, dispatchToken, taskNumber] of attempts) {
    await database.query(
      `INSERT INTO public.serverless_attempts(
        id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,
        task_id,deployment_id,lane,attempt_ordinal,state,dispatch_token_sha256,
        items_manifest_sha256,item_count,input_manifest_sha256,output_prefix,deadline_at,
        reconciliation_deadline_at,submitted_at,ttl_expires_at,terminal_at,
        possible_duplicate_executions,possible_duplicate_cost_usd,version,created_at,updated_at,
        provider_terminal_observed_at,provider_result_expires_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'ASSIGNED',$10,$11,1,$12,$13,
        $14,$15,$16,NULL,NULL,0,0,1,$16,$16,NULL,NULL)`,
      [
        attemptId,
        ACCOUNT_ID,
        WORKSPACE_ID,
        PROJECT_ID,
        REVISION_ID,
        REQUEST_ID,
        `77777777-7777-4777-8777-${String(taskNumber).padStart(12, "0")}`,
        deploymentId,
        lane,
        dispatchToken,
        SHA(6 + taskNumber),
        SHA(8 + taskNumber),
        `tenant/${ACCOUNT_ID}/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/revision/${REVISION_ID}/lane/${lane}/job/${attemptId}`,
        "2020-01-01T01:00:00.000Z",
        "2020-01-01T00:59:00.000Z",
        ANCHOR,
      ],
    );
  }
  const assignments = [
    [MAGE_ASSIGNMENT_ID, MAGE_ATTEMPT_ID, MAGE_DEPLOYMENT_ID, "mage-job", SHA(4)],
    [SOULX_ASSIGNMENT_ID, SOULX_ATTEMPT_ID, SOULX_DEPLOYMENT_ID, "soulx-job", SHA(5)],
  ];
  for (const [assignmentId, attemptId, , providerJobId, dispatchToken] of assignments) {
    await database.query(
      `INSERT INTO public.serverless_provider_assignments(
        id,account_id,workspace_id,project_revision_id,attempt_id,dispatch_token_sha256,
        provider_job_id,provider_job_id_sha256,assignment_source,worker_id,assigned_at,
        is_current,superseded_at,version
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'RUN_RESPONSE',NULL,$9,true,NULL,1)`,
      [
        assignmentId,
        ACCOUNT_ID,
        WORKSPACE_ID,
        REVISION_ID,
        attemptId,
        dispatchToken,
        providerJobId,
        SHA(providerJobId === "mage-job" ? 9 : 10),
        ANCHOR,
      ],
    );
  }
  await database.query(
    `INSERT INTO public.hosted_serverless_output_barrier_completions(
      attempt_id,account_id,workspace_id,project_id,project_revision_id,lane,assignment_id,
      provider_job_id,dispatch_token_sha256,deployment_id,endpoint_id_sha256,
      endpoint_config_sha256,worker_image_digest,model_manifest_sha256,volume_id_sha256,
      volume_manifest_sha256,region,gpu_allowlist,expected_objects,binding_components,
      binding_sha256,callback_sha256,provenance_receipt_sha256,artifact_commit_receipt_sha256s,
      completed_at
    ) VALUES($1,$2,$3,$4,$5,'mage_image',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
      ARRAY['NVIDIA GeForce RTX 4090']::text[],$17::jsonb,$18::jsonb,$19,$20,$21,$22::jsonb,$23)`,
    [
      MAGE_ATTEMPT_ID,
      ACCOUNT_ID,
      WORKSPACE_ID,
      PROJECT_ID,
      REVISION_ID,
      MAGE_ASSIGNMENT_ID,
      "mage-job",
      SHA(4),
      MAGE_DEPLOYMENT_ID,
      SHA(20),
      SHA(21),
      SHA(22),
      SHA(23),
      SHA(24),
      SHA(25),
      "EU-RO-1",
      JSON.stringify([{ item_id: "mage-item" }]),
      JSON.stringify({}),
      SHA(26),
      SHA(27),
      SHA(28),
      JSON.stringify([SHA(29)]),
      MAGE_COMPLETED_AT,
    ],
  );
}

async function fundedDeadlineSeconds(database) {
  const rows = await database.query(
    `SELECT lane,extract(epoch FROM funded_deadline_at-$1::timestamptz)::integer AS seconds
       FROM public.videoforge_hosted_pair_funded_deadlines($2,$3,$4)
      ORDER BY lane`,
    [ANCHOR, ACCOUNT_ID, WORKSPACE_ID, REQUEST_ID],
  );
  return rows.rows.map((row) => [row.lane, Number(row.seconds)]);
}

test("accepted Mage barrier releases remaining funded pair pool while still ASSIGNED", async () => {
  const database = new PGlite();
  try {
    const executor = new PGliteExecutor(database);
    await applyMigrationSliceThrough(executor, 133);
    await database.exec(await readMigration("0134_hosted_v209_mage_long_plan_successor.sql"));
    await database.exec(await readMigration("0135_hosted_ordinary_video_budget.sql"));
    await seedFundedPair(database);

    assert.deepEqual(await fundedDeadlineSeconds(database), [
      ["mage_image", 1200],
      ["soulx_avatar", 1200],
    ]);

    await database.exec(await readMigration("0143_hosted_funded_accepted_lane_deadline.sql"));
    assert.deepEqual(await fundedDeadlineSeconds(database), [
      ["mage_image", 1200],
      ["soulx_avatar", 1913],
    ]);

    const states = await database.query(
      `SELECT lane,state,provider_terminal_observed_at
         FROM public.serverless_attempts
        WHERE generation_request_id=$1 ORDER BY lane`,
      [REQUEST_ID],
    );
    assert.deepEqual(
      states.rows.map((row) => [row.lane, row.state, row.provider_terminal_observed_at]),
      [
        ["mage_image", "ASSIGNED", null],
        ["soulx_avatar", "ASSIGNED", null],
      ],
    );
  } finally {
    await database.close();
  }
});
