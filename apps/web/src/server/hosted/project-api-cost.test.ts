// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import type { SqlExecutor } from "@videoforge/control-plane";
import { expect, it } from "vitest";
import { readProjectApiCost } from "./project-api-cost";

it("counts project API work once across revisions, retains missing charges and excludes other tenants/unsubmitted jobs", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE hosted_prompt_runs(id text,account_id text,workspace_id text,project_id text,task_id text,attempt_id text,state text);
      CREATE TABLE hosted_prompt_batch_claims(id text,run_id text,account_id text,workspace_id text,task_id text,attempt_id text,provider_task_uuid text,request_hash text);
      CREATE TABLE hosted_prompt_batch_replacements(claim_id text,provider_task_uuid text,request_hash text);
      CREATE TABLE fixture_prompt_receipts(run_id text,uuid text,hash text,result jsonb);
      CREATE FUNCTION videoforge_load_hosted_prompt_response(run_id text,uuid text,hash text)
        RETURNS jsonb LANGUAGE SQL AS 'SELECT result FROM fixture_prompt_receipts r WHERE r.run_id=$1 AND r.uuid=$2 AND r.hash=$3';
      CREATE TABLE project_revisions(account_id text, workspace_id text, id text, project_id text);
      CREATE TABLE generation_tasks(account_id text, workspace_id text, id text, task_key text, lane text);
      CREATE TABLE cost_events(account_id text,workspace_id text,owner_id text,owner_type text,task_id text,attempt_id text,event_type text,amount_micro_usd bigint,details jsonb NOT NULL DEFAULT '{}'::jsonb);
      CREATE TABLE hosted_api_generation_jobs(account_id text,workspace_id text,project_id text,lane text,input_manifest jsonb,state text,provider_task_id text,submitted_at timestamptz,failure_code text);
      CREATE TABLE hosted_video_plans(account_id text,workspace_id text,project_revision_id text,price_per_second_usd numeric);
      CREATE TABLE hosted_video_jobs(account_id text,workspace_id text,project_id text,project_revision_id text,state text,provider_task_id text,submitted_at timestamptz,output_cost_usd numeric,duration_seconds numeric,failure_code text,input_manifest jsonb);
      CREATE TABLE hosted_api_image_regeneration_jobs(account_id text,workspace_id text,project_id text,input_manifest jsonb,state text,provider_task_id text,submitted_at timestamptz,failure_code text);
      CREATE TABLE hosted_script_projects(account_id text,workspace_id text,project_id text,state text);
      CREATE TABLE serverless_attempts(id text,account_id text,workspace_id text,project_id text,state text);
      CREATE TABLE serverless_cost_ledgers(id text,account_id text,workspace_id text,attempt_id text,settled_usd numeric,reported_usd numeric,estimated_usd numeric,reserved_usd numeric,possible_duplicate_usd numeric,refunded_usd numeric);
      INSERT INTO project_revisions VALUES ('a','w','r1','p'),('a','w','r2','p'),('b','w','foreign','p');
      INSERT INTO generation_tasks VALUES ('a','w','context','prompt:voiceover-context:1','PROMPT'),('a','w','scenes','prompt:scenes:1','PROMPT'),('b','w','foreign','prompt:scenes:1','PROMPT');
      INSERT INTO cost_events (account_id,workspace_id,owner_id,owner_type,task_id,attempt_id,event_type,amount_micro_usd) VALUES
        ('a','w','r1','PROJECT_REVISION','context','attempt-context','SETTLED',20000),
        ('a','w','r2','PROJECT_REVISION','scenes','attempt-scenes','RESERVED',500000),
        ('a','w','r2','PROJECT_REVISION','scenes','attempt-scenes','REPORTED',40000),
        ('a','w','r2','PROJECT_REVISION','scenes','attempt-scenes','SETTLED',30000),
        ('b','w','foreign','PROJECT_REVISION','foreign','foreign-attempt','SETTLED',10000000);
      INSERT INTO hosted_api_generation_jobs VALUES
        ('a','w','p','IMAGE','{}','SUCCEEDED','image-old',now(),null),
        ('a','w','p','IMAGE','{}','SUCCEEDED','image-new',now(),null),
        ('a','w','p','AVATAR','{"expectedDurationMs":10000}','SUCCEEDED','avatar',now(),null),
        ('a','w','p','IMAGE','{}','PREPARED',null,null,null),
        ('a','w','p','IMAGE','{}','FAILED',null,null,'OWNER_CANCELLED_BEFORE_SUBMIT'),
        ('b','w','p','IMAGE','{}','SUCCEEDED','foreign',now(),null);
      INSERT INTO hosted_video_plans VALUES ('a','w','r2',0.01336);
      INSERT INTO hosted_video_jobs VALUES ('a','w','p','r2','SUCCEEDED','video',now(),0.09,10,null,'{"model":"bytedance:2@2"}');
      INSERT INTO hosted_api_image_regeneration_jobs VALUES ('a','w','p','{"provider":"FAL_Z_IMAGE"}','SUCCEEDED','regen',now(),null);
      INSERT INTO hosted_script_projects VALUES ('a','w','p','COMPLETE');
      INSERT INTO serverless_attempts VALUES ('legacy','a','w','p','SUCCEEDED'),('planned','a','w','p','PLANNED'),('foreign','b','w','p','SUCCEEDED');
      INSERT INTO serverless_cost_ledgers VALUES ('legacy-ledger','a','w','legacy',0.2,0.3,0.4,0.5,0,0.05),('foreign-ledger','b','w','foreign',10,10,10,10,0,0);
    `);
    const cost = await readProjectApiCost(db as unknown as SqlExecutor, "a", "w", "p");
    expect(cost.usd).toBeCloseTo(0.352608, 8);
    expect(cost.unconfirmed).toBe(true);
    expect(cost.estimated).toBe(true);
    expect(cost.breakdown).toContainEqual({
      label: "Generated narration",
      usd: null,
      estimated: false,
      unconfirmed: true,
    });
    expect(cost.breakdown).toContainEqual(
      expect.objectContaining({
        label: "Scene footage",
        usd: 0.09,
        estimated: false,
        unconfirmed: false,
      }),
    );
    expect(cost.breakdown).toContainEqual({
      label: "Scene prompts",
      usd: 0.03,
      estimated: false,
      unconfirmed: false,
    });
    expect(cost.breakdown).toContainEqual({
      label: "Legacy generation APIs",
      usd: 0.15,
      estimated: false,
      unconfirmed: false,
    });
    expect(cost.breakdown.find((row) => row.label === "Generated images")?.usage).toEqual([
      {
        provider: "KIE",
        model: "z-image",
        submittedRequests: 2,
        completedRequests: 2,
        failedRequests: 0,
        uncertainRequests: 0,
        requestedSeconds: null,
        pinnedRateUsd: 0.004,
        rateUnit: "request",
        costBasis: "PINNED_RATE_ESTIMATE",
      },
    ]);
    expect(cost.breakdown.find((row) => row.label === "Avatar footage")?.usage?.[0]).toMatchObject({
      provider: "FAL",
      model: "fal-ai/flashhead/audio-to-video",
      submittedRequests: 1,
      requestedSeconds: 10,
      pinnedRateUsd: 0.005,
      rateUnit: "second",
    });
    expect(cost.breakdown.find((row) => row.label === "Scene footage")?.usage?.[0]).toMatchObject({
      provider: "RUNWARE",
      model: "bytedance:2@2",
      requestedSeconds: 10,
      pinnedRateUsd: 0.01336,
      costBasis: "PROVIDER_REPORTED",
    });
    await db.exec("DELETE FROM hosted_script_projects");
    expect(
      (await readProjectApiCost(db as unknown as SqlExecutor, "a", "w", "p")).unconfirmed,
    ).toBe(false);
    await db.exec(
      "INSERT INTO hosted_api_generation_jobs VALUES ('a','w','p','IMAGE','{}','SUBMITTING',null,null,null)",
    );
    expect(
      (await readProjectApiCost(db as unknown as SqlExecutor, "a", "w", "p")).unconfirmed,
    ).toBe(true);
    expect(await readProjectApiCost(db as unknown as SqlExecutor, "a", "w", "empty")).toEqual({
      usd: 0,
      unconfirmed: false,
      estimated: false,
      breakdown: [],
    });

    await db.exec(`
      INSERT INTO generation_tasks VALUES
        ('a','w','luna-scenes','prompt:scenes:luna','PROMPT'),
        ('a','w','legacy-reported','prompt:scenes:legacy','PROMPT'),
        ('a','w','luna-reserved','prompt:scenes:reserved','PROMPT');
      INSERT INTO cost_events
        (account_id,workspace_id,owner_id,owner_type,task_id,attempt_id,event_type,amount_micro_usd,details) VALUES
        ('a','w','r2','PROJECT_REVISION','luna-scenes','luna-attempt','RESERVED',5000000,
          '{}'),
        ('a','w','r2','PROJECT_REVISION','luna-scenes','luna-attempt','REPORTED',120,
          '{"provider":"RUNWARE","cost_basis":"PINNED_RATE_ESTIMATE","rate_version":"runware-air-gpt-6-luna-standard-2026-10-06","invoice_verified":false}'),
        ('a','w','r2','PROJECT_REVISION','luna-scenes','luna-attempt','SETTLED',100,
          '{"provider":"RUNWARE","cost_basis":"PINNED_RATE_ESTIMATE","rate_version":"runware-air-gpt-6-luna-standard-2026-10-06"}'),
        ('a','w','r2','PROJECT_REVISION','luna-scenes','luna-attempt','REFUNDED',10,
          '{}'),
        ('a','w','r2','PROJECT_REVISION','luna-scenes','luna-attempt','RELEASED',4999880,
          '{"provider":"RUNWARE","cost_basis":"PINNED_RATE_ESTIMATE","rate_version":"runware-air-gpt-6-luna-standard-2026-10-06","invoice_verified":false}'),
        ('a','w','r2','PROJECT_REVISION','legacy-reported','legacy-reported-attempt','REPORTED',70,'{}'),
        ('a','w','r2','PROJECT_REVISION','luna-reserved','luna-reserved-attempt','RESERVED',9000000,'{}'),
        ('b','w','foreign','PROJECT_REVISION','foreign','foreign-luna-attempt','SETTLED',9000000,
          '{"provider":"RUNWARE","cost_basis":"PINNED_RATE_ESTIMATE","rate_version":"runware-air-gpt-6-luna-standard-2026-10-06","invoice_verified":false}');
    `);
    const withLuna = await readProjectApiCost(db as unknown as SqlExecutor, "a", "w", "p");
    expect(withLuna.breakdown).toContainEqual({
      label: "Scene prompts (GPT-6 Luna)",
      usd: 0.00009,
      estimated: true,
      unconfirmed: false,
    });
    expect(withLuna.breakdown).toContainEqual({
      label: "Scene prompts",
      usd: 0.03007,
      estimated: false,
      unconfirmed: true,
    });
    // Paid failed calls remain counted; uncertain dispatches do not invent a submitted count.
    await db.exec(`
      INSERT INTO hosted_api_generation_jobs VALUES
        ('a','w','p','IMAGE','{}','FAILED','failed-paid',now(),'OUTPUT_INVALID'),
        ('a','w','p','IMAGE','{}','UNKNOWN_NO_RETRY',null,null,'PROVIDER_UNKNOWN'),
        ('a','w','p','IMAGE','{}','FAILED',null,null,'PROVIDER_REQUEST_REJECTED'),
        ('a','w','p','AVATAR','{"expectedDurationMs":2020}','SUCCEEDED','short',now(),null),
        ('a','w','p','AVATAR','{"expectedDurationMs":5040}','FAILED','failed-avatar',now(),'OUTPUT_INVALID');
      INSERT INTO hosted_video_jobs VALUES
        ('a','w','p','r2','SUCCEEDED','reported-free',now(),0,3,null,'{"model":"bytedance:2@2"}'),
        ('a','w','p','r2','FAILED','failed-video',now(),null,4,'OUTPUT_INVALID','{"model":"bytedance:2@2"}');
    `);
    const attempts = await readProjectApiCost(db as unknown as SqlExecutor, "a", "w", "p");
    expect(
      attempts.breakdown.find((row) => row.label === "Generated images")?.usage?.[0],
    ).toMatchObject({
      submittedRequests: 3,
      completedRequests: 2,
      failedRequests: 1,
      uncertainRequests: 2,
    });
    expect(
      attempts.breakdown.find((row) => row.label === "Avatar footage")?.usage?.[0],
    ).toMatchObject({
      submittedRequests: 3,
      completedRequests: 2,
      failedRequests: 1,
      requestedSeconds: 17.06,
    });
    const videos = attempts.breakdown.find((row) => row.label === "Scene footage");
    expect(videos?.usd).toBeCloseTo(0.09 + 4 * 0.01336);
    expect(videos?.usage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          costBasis: "PROVIDER_REPORTED",
          submittedRequests: 2,
          requestedSeconds: 13,
        }),
        expect.objectContaining({
          costBasis: "PINNED_RATE_ESTIMATE",
          submittedRequests: 1,
          failedRequests: 1,
          requestedSeconds: 4,
        }),
      ]),
    );
    await db.exec(`
      INSERT INTO hosted_api_image_regeneration_jobs VALUES
        ('a','w','p','{"provider":"KIE_Z_IMAGE"}','FAILED',null,null,'PROVIDER_REQUEST_REJECTED');
      INSERT INTO hosted_video_jobs VALUES
        ('a','w','p','missing-plan','SUCCEEDED','priced',now(),0.07,2,null,'{"model":"bytedance:2@2"}'),
        ('a','w','p','missing-plan','UNKNOWN_NO_RETRY','unpriced',now(),null,5,'PROVIDER_UNKNOWN','{"model":"bytedance:2@2"}');
    `);
    const missingPlan = await readProjectApiCost(db as unknown as SqlExecutor, "a", "w", "p");
    expect(missingPlan.breakdown.find((row) => row.label === "Replacement images")).toEqual(
      attempts.breakdown.find((row) => row.label === "Replacement images"),
    );
    expect(missingPlan.breakdown.find((row) => row.label === "Scene footage")).toMatchObject({
      usd: 0.21344,
      unconfirmed: true,
    });
    expect(missingPlan.breakdown.find((row) => row.label === "Scene footage")?.usage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pinnedRateUsd: null,
          costBasis: "PROVIDER_REPORTED",
          submittedRequests: 1,
        }),
        expect.objectContaining({
          pinnedRateUsd: null,
          costBasis: "PINNED_RATE_ESTIMATE",
          uncertainRequests: 1,
        }),
      ]),
    );
    await db.exec(`
      INSERT INTO generation_tasks VALUES ('a','w','active-prompts','prompt:scenes:active','PROMPT');
      INSERT INTO cost_events(account_id,workspace_id,owner_id,owner_type,task_id,attempt_id,event_type,amount_micro_usd)
        VALUES ('a','w','r2','PROJECT_REVISION','active-prompts','active-attempt','RESERVED',500000),
               ('a','w','r2','PROJECT_REVISION','active-prompts','active-attempt','REFUNDED',50);
      INSERT INTO hosted_prompt_runs VALUES ('active','a','w','p','active-prompts','active-attempt','UNKNOWN'),
        ('foreign','b','w','p','active-prompts','foreign-attempt','UNKNOWN');
      INSERT INTO hosted_prompt_batch_claims VALUES
        ('claim','active','a','w','active-prompts','active-attempt','original','hash-original'),
        ('missing','active','a','w','active-prompts','active-attempt','missing','hash-missing'),
        ('invalid','active','a','w','active-prompts','active-attempt','invalid','hash-invalid'),
        ('malformed','active','a','w','active-prompts','active-attempt','malformed','hash-malformed'),
        ('foreign','foreign','b','w','active-prompts','foreign-attempt','foreign','hash-foreign');
      INSERT INTO hosted_prompt_batch_replacements VALUES ('claim','correction','hash-correction'),
        ('claim','second-correction','hash-second-correction');
      INSERT INTO fixture_prompt_receipts VALUES
        ('active','original','hash-original','{"status":"succeeded","costUsd":0.0002,"costBasis":"PINNED_RATE_ESTIMATE"}'),
        ('active','correction','hash-correction','{"status":"succeeded","costUsd":0.0003,"costBasis":"PINNED_RATE_ESTIMATE"}'),
        ('active','second-correction','hash-second-correction','{"status":"succeeded","costUsd":0.0001,"costBasis":"PINNED_RATE_ESTIMATE"}'),
        ('active','invalid','hash-invalid','{"status":"failed","costUsd":0.2}'),
        ('active','malformed','hash-malformed','{"status":"succeeded","costUsd":"garbage"}'),
        ('foreign','foreign','hash-foreign','{"status":"succeeded","costUsd":0.25}');
    `);
    const active = await readProjectApiCost(db as unknown as SqlExecutor, "a", "w", "p");
    const activePrompts = active.breakdown.find((row) => row.label === "Scene prompts");
    expect(activePrompts?.usd).toBeCloseTo(0.03007 + 0.0002 + 0.0003 + 0.0001 - 0.00005);
    expect(activePrompts).toMatchObject({ estimated: true, unconfirmed: true });
    await db.exec(`INSERT INTO cost_events(account_id,workspace_id,owner_id,owner_type,task_id,attempt_id,event_type,amount_micro_usd)
      VALUES ('a','w','r2','PROJECT_REVISION','active-prompts','active-attempt','SETTLED',400);`);
    const settled = await readProjectApiCost(db as unknown as SqlExecutor, "a", "w", "p");
    expect(settled.breakdown.find((row) => row.label === "Scene prompts")?.usd).toBeCloseTo(
      0.03007 + 0.0004 - 0.00005,
    );
    await db.exec(`
      INSERT INTO serverless_attempts VALUES ('reserved-only','a','w','p','RUNNING'),('duplicate-unknown','a','w','p','UNKNOWN');
      INSERT INTO serverless_cost_ledgers VALUES
        ('reserved-only-ledger','a','w','reserved-only',0,0,0.8,1.2,0,0),
        ('duplicate-unknown-ledger','a','w','duplicate-unknown',0.02,0.02,0.1,0.1,0.05,0);
    `);
    const legacyPending = await readProjectApiCost(db as unknown as SqlExecutor, "a", "w", "p");
    expect(legacyPending.breakdown.find((row) => row.label === "Legacy generation APIs")).toEqual({
      label: "Legacy generation APIs",
      usd: 0.17,
      unconfirmed: true,
      estimated: true,
    });
    // Prior partial settlement cannot make a still-UNKNOWN attempt look fully priced.
    expect(settled.breakdown.find((row) => row.label === "Scene prompts")?.unconfirmed).toBe(true);
  } finally {
    await db.close();
  }
});
