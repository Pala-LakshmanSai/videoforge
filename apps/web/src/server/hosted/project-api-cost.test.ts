// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import type { SqlExecutor } from "@videoforge/control-plane";
import { expect, it } from "vitest";
import { readProjectApiCost } from "./project-api-cost";

it("counts project API work once across revisions, retains missing charges and excludes other tenants/unsubmitted jobs", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE project_revisions(account_id text, workspace_id text, id text, project_id text);
      CREATE TABLE generation_tasks(account_id text, workspace_id text, id text, task_key text, lane text);
      CREATE TABLE cost_events(account_id text,workspace_id text,owner_id text,owner_type text,task_id text,attempt_id text,event_type text,amount_micro_usd bigint,details jsonb NOT NULL DEFAULT '{}'::jsonb);
      CREATE TABLE hosted_api_generation_jobs(account_id text,workspace_id text,project_id text,lane text,input_manifest jsonb,state text,provider_task_id text,submitted_at timestamptz,failure_code text);
      CREATE TABLE hosted_video_plans(account_id text,workspace_id text,project_revision_id text,price_per_second_usd numeric);
      CREATE TABLE hosted_video_jobs(account_id text,workspace_id text,project_id text,project_revision_id text,state text,provider_task_id text,submitted_at timestamptz,output_cost_usd numeric,duration_seconds numeric,failure_code text);
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
      INSERT INTO hosted_video_jobs VALUES ('a','w','p','r2','SUCCEEDED','video',now(),0.09,10,null);
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
    expect(cost.breakdown).toContainEqual({
      label: "Scene footage",
      usd: 0.09,
      estimated: false,
      unconfirmed: false,
    });
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
  } finally {
    await db.close();
  }
});
