// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

import {
  CONTEXT_REDISPATCH_BUDGET,
  CONTEXT_REDISPATCHABLE_PROBLEM_CODES,
  continuationDueQuery,
  continuationOutcome,
  PLAN_STAGE_REVISION_CONFIG_SCHEMA_VERSION,
  PROMPT_REDISPATCHABLE_PROBLEM_CODES,
  restartPendingImageRegenerationWorkflows,
} from "./stage-continuation-sweep";

const DUE_QUERY = await continuationDueQuery();

it("continues Luna prompt work only when the current unresolved batch has a saved receipt", () => {
  expect(DUE_QUERY).toContain("prompt_profile_revision NOT IN (8, 9, 10)");
  expect(DUE_QUERY).toContain(
    "prompt_profile_revision IS NULL OR prompt_profile_revision NOT IN (8, 9, 10)",
  );
  expect(DUE_QUERY).toContain("prompt_current_claim_started_at IS NULL");
  expect(DUE_QUERY).toContain("prompt_current_receipt_available");
  expect(DUE_QUERY).toContain("videoforge_load_hosted_prompt_response(");
  expect(DUE_QUERY).toContain("prompt_run_started_at < now() - make_interval");
  expect(DUE_QUERY).toContain("WHEN prompt_state = 'UNKNOWN'");
});

it("requires a saved current-claim receipt before retrying Luna profiles 8, 9 and 10", async () => {
  const database = new PGlite();
  const { rows } = await database.query<{
    profile: number;
    has_claim: boolean;
    has_receipt: boolean;
    recoverable: boolean;
  }>(`
    SELECT profile, has_claim, has_receipt,
      (profile IS NULL OR profile NOT IN (8, 9, 10) OR NOT has_claim OR has_receipt) AS recoverable
    FROM (VALUES
      (8, true, false), (8, true, true),
      (9, true, false), (9, true, true),
      (10, true, false), (10, true, true),
      (8, false, false), (9, false, false),
      (7, true, false)
    ) AS cases(profile, has_claim, has_receipt)
  `);
  expect(rows.map(({ recoverable }) => recoverable)).toEqual([
    false,
    true,
    false,
    true,
    false,
    true,
    true,
    true,
    true,
  ]);
  await database.close();
});

it("restarts only completed saved regeneration workflows inside their tenant scope", async () => {
  const account = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const workspace = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes("read_pending_hosted_api")
      ? [{ value: [{ id, accountId: account, workspaceId: workspace }] }]
      : [],
  }));
  const pool = {
    query: vi.fn(async () => ({ rows: [{ account_id: account }] })),
    connect: async () => ({ query, release: vi.fn() }),
  };
  const restart = vi.fn(async () => {});
  const status = vi.fn(async () => ({ status: "complete" }));
  const get = vi.fn(async () => ({ status, restart }));
  const environment = { HOSTED_PAIR_WORKFLOW: { get } };
  expect(
    await restartPendingImageRegenerationWorkflows(environment as never, pool as never),
  ).toEqual({ dispatched: [`${id}:image-regeneration`], failures: [] });
  expect(get).toHaveBeenCalledWith(`image-regen-${id}`);
  expect(query).toHaveBeenCalledWith("SELECT set_config($1,$2,true)", [
    "videoforge.account_id",
    account,
  ]);
  status.mockResolvedValue({ status: "running" });
  await restartPendingImageRegenerationWorkflows(environment as never, pool as never);
  expect(restart).toHaveBeenCalledOnce();
});

it("refuses a mismatched regeneration tenant before looking up its workflow", async () => {
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes("read_pending_hosted_api")
      ? [
          {
            value: [
              { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", accountId: "other", workspaceId: "w" },
            ],
          },
        ]
      : [],
  }));
  const pool = {
    query: async () => ({ rows: [{ account_id: "a" }] }),
    connect: async () => ({ query, release: vi.fn() }),
  };
  const get = vi.fn();
  const result = await restartPendingImageRegenerationWorkflows(
    { HOSTED_PAIR_WORKFLOW: { get } } as never,
    pool as never,
  );
  expect(result.dispatched).toEqual([]);
  expect(result.failures[0]).toContain("PENDING_SCOPE_INVALID");
  expect(get).not.toHaveBeenCalled();
});
import {
  HOSTED_CONTEXT_REDISPATCH_BUDGET,
  HOSTED_CONTEXT_RETRYABLE_PROBLEM_CODES,
} from "./voiceover-context";
import {
  HOSTED_PROMPT_RETRYABLE_PROBLEM_CODES,
  HOSTED_PROMPT_STALE_RUN_MS,
} from "./hosted-prompt-route";

it("never counts queued admission as started work while preserving successful stage handoffs", async () => {
  expect(await continuationOutcome(Response.json({ state: "WAITING" }, { status: 202 }))).toEqual({
    ok: false,
    waiting: true,
    detail: "202:WAITING",
  });
  expect(
    await continuationOutcome(Response.json({ state: "PREPARING_INPUTS" }, { status: 202 })),
  ).toEqual({ ok: true, detail: "202" });
  expect(await continuationOutcome(Response.json({ state: "COMPLETE" }))).toEqual({
    ok: true,
    detail: "200",
  });
});

const accountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const workspaceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const userId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const revisionId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

/**
 * Stage 3 must heal itself. The production failure this covers: the Runware call for the voiceover
 * context answered a 5xx, so the context row was left UNKNOWN with
 * VOICEOVER_CONTEXT_PROVIDER_UNAVAILABLE and no accepted result. The sweep used to route only
 * `context_state IS NULL`, so that row matched no step at all and the revision sat at stage 3 until a
 * human pressed retry - and the client's own panel offers no retry button in that state.
 */
async function seededDatabase(context: {
  readonly state: string | null;
  readonly hash: string | null;
  readonly problemCode: string | null;
  readonly redispatchCount: number;
  /** Defaults to the contract the plan stage accepts; an older contract must never be offered. */
  readonly revisionConfigSchema?: string;
}): Promise<PGlite> {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE public.projects (
      id uuid PRIMARY KEY, account_id uuid NOT NULL, workspace_id uuid NOT NULL,
      status text NOT NULL, created_at timestamptz NOT NULL,
      generation_provider text NOT NULL DEFAULT 'KIE_FAL'
    );
    CREATE TABLE public.project_revisions (
      id uuid PRIMARY KEY, account_id uuid NOT NULL, workspace_id uuid NOT NULL,
      project_id uuid NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL,
      -- The plan arm gates on the stored revision-config contract, so the sweep reads this column.
      revision_config_payload jsonb NOT NULL
    );
    CREATE TABLE public.memberships (
      workspace_id uuid NOT NULL, user_id uuid NOT NULL, created_at timestamptz NOT NULL
    );
    CREATE TABLE public.hosted_cpu_job_attempts (
      id uuid PRIMARY KEY, project_revision_id uuid NOT NULL, kind text NOT NULL,
      state text NOT NULL, created_at timestamptz NOT NULL
    );
    CREATE TABLE public.hosted_voiceover_contexts (
      id uuid PRIMARY KEY, project_revision_id uuid NOT NULL, state text NOT NULL,
      context_hash text, problem_code text, redispatch_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE public.timeline_plans (
      id uuid PRIMARY KEY, project_revision_id uuid NOT NULL
    );
    CREATE TABLE public.execution_profiles (id uuid PRIMARY KEY, revision integer NOT NULL);
    CREATE TABLE public.hosted_prompt_runs (
      id uuid PRIMARY KEY, project_revision_id uuid NOT NULL, state text NOT NULL,
      acceptance_fingerprint_hash text, created_at timestamptz NOT NULL,
      -- The stale window follows the attempt's own start, which a redispatch refreshes.
      started_at timestamptz, problem_code text, redispatch_count integer,
      planned_batch_count integer, execution_profile_id uuid
    );
    CREATE TABLE public.hosted_prompt_batch_claims (
      id uuid PRIMARY KEY, run_id uuid NOT NULL, batch_ordinal integer NOT NULL DEFAULT 0,
      provider_task_uuid text NOT NULL DEFAULT 'chatcmpl-test',
      request_hash text NOT NULL DEFAULT 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.hosted_prompt_batch_replacements (
      claim_id uuid PRIMARY KEY, provider_task_uuid text NOT NULL, request_hash text NOT NULL,
      replacement_index integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.prompt_response_receipts (
      provider_task_uuid text NOT NULL, request_hash text NOT NULL, result jsonb NOT NULL
    );
    CREATE FUNCTION public.videoforge_load_hosted_prompt_response(r uuid, t text, h text)
    RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT result FROM public.prompt_response_receipts
       WHERE provider_task_uuid=t AND request_hash=h LIMIT 1
    $$;
    CREATE TABLE public.hosted_prompt_batch_progress (
      id uuid PRIMARY KEY, run_id uuid NOT NULL, batch_ordinal integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public.generation_requests (
      id uuid PRIMARY KEY, project_revision_id uuid NOT NULL, state text NOT NULL,
      available_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.hosted_api_generation_jobs (
      id uuid PRIMARY KEY, project_revision_id uuid NOT NULL,
      state text NOT NULL DEFAULT 'SUCCEEDED'
    );
    CREATE TABLE public.hosted_video_jobs (
      id uuid PRIMARY KEY, project_revision_id uuid NOT NULL, state text NOT NULL
    );
    CREATE TABLE public.video_runtime_states (
      project_revision_id uuid NOT NULL, generation_request_id uuid NOT NULL, stage text NOT NULL
    );
    CREATE FUNCTION public.videoforge_hosted_videos_ready(a uuid,w uuid,g uuid)
    RETURNS boolean LANGUAGE sql AS $$ SELECT NOT EXISTS(
      SELECT 1 FROM hosted_video_jobs WHERE state <> 'SUCCEEDED') $$;

    INSERT INTO public.projects VALUES
      ('11111111-1111-4111-8111-111111111111','${accountId}','${workspaceId}','ACTIVE',
        '2026-09-16T12:20:00Z');
    INSERT INTO public.project_revisions VALUES
      ('${revisionId}','${accountId}','${workspaceId}',
        '11111111-1111-4111-8111-111111111111','LOCKED','2026-09-16T12:20:10Z',
        ('{"schema_version":"${context.revisionConfigSchema ?? PLAN_STAGE_REVISION_CONFIG_SCHEMA_VERSION}"}')::jsonb);
    INSERT INTO public.memberships VALUES ('${workspaceId}','${userId}','2026-09-16T12:00:00Z');
    INSERT INTO public.hosted_cpu_job_attempts VALUES
      ('22222222-2222-4222-8222-222222222222','${revisionId}','ASR','SUCCEEDED',
        '2026-09-16T12:24:00Z');
  `);
  if (context.state !== null) {
    await database.exec(`
      INSERT INTO public.hosted_voiceover_contexts VALUES
        ('33333333-3333-4333-8333-333333333333','${revisionId}','${context.state}',
          ${context.hash === null ? "NULL" : `'${context.hash}'`},
          ${context.problemCode === null ? "NULL" : `'${context.problemCode}'`},
          ${context.redispatchCount}, '2026-09-16T12:28:49Z');
    `);
  }
  return database;
}

async function nextSteps(database: PGlite): Promise<readonly string[]> {
  const result = await database.query<{ next_step: string }>(DUE_QUERY, [
    accountId,
    null,
    null,
    null,
  ]);
  return result.rows.map((row) => row.next_step);
}

it("selects only the requested project's due stage for an immediate handoff", async () => {
  const database = await seededDatabase({
    state: null,
    hash: null,
    problemCode: null,
    redispatchCount: 0,
  });
  try {
    const projectId = "11111111-1111-4111-8111-111111111111";
    expect(
      (await database.query(DUE_QUERY, [accountId, projectId, "context", revisionId])).rows,
    ).toHaveLength(1);
    expect(
      (await database.query(DUE_QUERY, [accountId, projectId, "prompts", revisionId])).rows,
    ).toHaveLength(0);
    expect(
      (
        await database.query(DUE_QUERY, [
          accountId,
          projectId,
          "context",
          "99999999-9999-4999-8999-999999999999",
        ])
      ).rows,
    ).toHaveLength(0);
  } finally {
    await database.close();
  }
});

it("offers a saved plan only to the targeted prompt handoff", async () => {
  const database = await seededDatabase({
    state: "SUCCEEDED",
    hash: "accepted",
    problemCode: null,
    redispatchCount: 0,
  });
  try {
    await database.exec(
      `INSERT INTO public.timeline_plans VALUES ('44444444-4444-4444-8444-444444444444', '${revisionId}')`,
    );
    const projectId = "11111111-1111-4111-8111-111111111111";
    expect(
      (await database.query(DUE_QUERY, [accountId, projectId, "prompts", revisionId])).rows,
    ).toHaveLength(1);
    expect(
      (await database.query(DUE_QUERY, [accountId, projectId, "context", revisionId])).rows,
    ).toHaveLength(0);
  } finally {
    await database.close();
  }
});

it("retries one queued or admitted API generation only before any span or provider job exists", async () => {
  const database = await seededDatabase({
    state: "SUCCEEDED",
    hash: "accepted",
    problemCode: null,
    redispatchCount: 0,
  });
  try {
    await database.exec(`
      INSERT INTO public.timeline_plans VALUES ('44444444-4444-4444-8444-444444444444', '${revisionId}');
      INSERT INTO public.hosted_prompt_runs (id,project_revision_id,state,acceptance_fingerprint_hash,created_at,started_at,problem_code,redispatch_count,planned_batch_count) VALUES
        ('55555555-5555-4555-8555-555555555555','${revisionId}','SUCCEEDED','accepted',
         now(),now(),NULL,0,1);
    `);
    expect(await nextSteps(database)).toEqual(["dispatch"]);
    await database.exec(`INSERT INTO public.generation_requests (id,project_revision_id,state) VALUES
      ('66666666-6666-4666-8666-666666666666','${revisionId}','WAITING')`);
    expect(await nextSteps(database)).toEqual(["dispatch"]);
    await database.exec(
      "UPDATE public.generation_requests SET state='RETRY_WAIT',available_at=now()",
    );
    expect(await nextSteps(database)).toEqual(["dispatch"]);
    await database.exec(
      "UPDATE public.generation_requests SET available_at=now()+interval '1 hour'",
    );
    expect(await nextSteps(database)).toEqual([]);
    await database.exec("UPDATE public.generation_requests SET available_at='infinity'");
    expect(await nextSteps(database)).toEqual([]);
    await database.exec("UPDATE public.generation_requests SET state='ACTIVE'");
    expect(await nextSteps(database)).toEqual(["dispatch"]);
    await database.exec(`INSERT INTO public.hosted_api_generation_jobs VALUES
      ('77777777-7777-4777-8777-777777777777','${revisionId}')`);
    expect(await nextSteps(database)).toEqual([]);
    await database.exec(
      "UPDATE public.generation_requests SET state='RETRY_WAIT',available_at=now()",
    );
    expect(await nextSteps(database)).toEqual([]);
    await database.exec("UPDATE public.generation_requests SET state='ACTIVE'");
    await database.exec(`DELETE FROM public.hosted_api_generation_jobs;
      INSERT INTO public.hosted_cpu_job_attempts VALUES
      ('88888888-8888-4888-8888-888888888888','${revisionId}','SPAN_AUDIO','OUTBOXED',now())`);
    expect(await nextSteps(database)).toEqual([]);
    await database.exec(
      "UPDATE public.generation_requests SET state='RETRY_WAIT',available_at=now()",
    );
    expect(await nextSteps(database)).toEqual([]);
    await database.exec("UPDATE public.generation_requests SET state='ACTIVE'");
    await database.exec(`DELETE FROM public.hosted_cpu_job_attempts WHERE kind='SPAN_AUDIO';
      UPDATE public.projects SET generation_provider='RUNPOD'`);
    expect(await nextSteps(database)).toEqual([]);
    await database.exec(`UPDATE public.projects SET generation_provider='KIE_FAL';
      UPDATE public.generation_requests SET state='FAILED'`);
    expect(await nextSteps(database)).toEqual([]);
    await database.exec(`UPDATE public.generation_requests SET state='ACTIVE';
      INSERT INTO public.generation_requests (id,project_revision_id,state) VALUES
      ('99999999-9999-4999-8999-999999999999','${revisionId}','FAILED')`);
    expect(await nextSteps(database)).toEqual([]);
  } finally {
    await database.close();
  }
});

it("resumes capacity-waiting saved media but excludes ambiguous, failed and cancelled work", async () => {
  const database = await seededDatabase({
    state: "SUCCEEDED",
    hash: "accepted",
    problemCode: null,
    redispatchCount: 0,
  });
  try {
    await database.exec(`
      INSERT INTO public.timeline_plans VALUES ('44444444-4444-4444-8444-444444444444', '${revisionId}');
      INSERT INTO public.hosted_prompt_runs (id,project_revision_id,state,acceptance_fingerprint_hash,created_at,started_at,problem_code,redispatch_count,planned_batch_count) VALUES
        ('55555555-5555-4555-8555-555555555555','${revisionId}','SUCCEEDED','accepted',now(),now(),NULL,0,1);
      INSERT INTO public.generation_requests (id,project_revision_id,state) VALUES
        ('66666666-6666-4666-8666-666666666666','${revisionId}','ACTIVE');
      INSERT INTO public.hosted_api_generation_jobs VALUES
        ('77777777-7777-4777-8777-777777777777','${revisionId}','PREPARED');
    `);
    for (const state of ["PREPARED", "SUBMITTED"]) {
      await database.exec(`UPDATE public.hosted_api_generation_jobs SET state='${state}'`);
      expect(await nextSteps(database)).toEqual(["dispatch"]);
    }
    for (const state of ["SUBMITTING", "UNKNOWN_NO_RETRY", "FAILED", "SUCCEEDED"]) {
      await database.exec(`UPDATE public.hosted_api_generation_jobs SET state='${state}'`);
      expect(await nextSteps(database)).toEqual([]);
    }
    await database.exec(
      "UPDATE public.hosted_api_generation_jobs SET state='PREPARED'; UPDATE public.generation_requests SET state='CANCELLED'",
    );
    expect(await nextSteps(database)).toEqual([]);
    await database.exec(`UPDATE public.generation_requests SET state='ACTIVE';
      INSERT INTO public.hosted_cpu_job_attempts VALUES
        ('88888888-8888-4888-8888-888888888888','${revisionId}','SPAN_AUDIO','FAILED',now())`);
    expect(await nextSteps(database)).toEqual([]);
  } finally {
    await database.close();
  }
});

it("recovers unfinished saved footage after all image/avatar jobs finish, without admitting settled work", async () => {
  const database = await seededDatabase({
    state: "SUCCEEDED",
    hash: "accepted",
    problemCode: null,
    redispatchCount: 0,
  });
  try {
    await database.exec(`
      INSERT INTO public.timeline_plans VALUES ('44444444-4444-4444-8444-444444444444', '${revisionId}');
      INSERT INTO public.hosted_prompt_runs (id,project_revision_id,state,acceptance_fingerprint_hash,created_at,started_at,problem_code,redispatch_count,planned_batch_count) VALUES
        ('55555555-5555-4555-8555-555555555555','${revisionId}','SUCCEEDED','accepted',now(),now(),NULL,0,1);
      INSERT INTO public.generation_requests (id,project_revision_id,state) VALUES
        ('66666666-6666-4666-8666-666666666666','${revisionId}','ACTIVE');
      INSERT INTO public.hosted_cpu_job_attempts VALUES
        ('88888888-8888-4888-8888-888888888888','${revisionId}','SPAN_AUDIO','SUCCEEDED',now());
      INSERT INTO public.hosted_api_generation_jobs VALUES
        ('77777777-7777-4777-8777-777777777777','${revisionId}','SUCCEEDED');
      INSERT INTO public.hosted_video_jobs VALUES
        ('99999999-9999-4999-8999-999999999999','${revisionId}','SUBMITTED');
    `);
    for (const state of ["SUBMITTED", "SUBMITTING", "UNKNOWN_NO_RETRY"]) {
      await database.exec(`UPDATE public.hosted_video_jobs SET state='${state}'`);
      expect(await nextSteps(database)).toEqual(["dispatch"]);
    }
    await database.exec("UPDATE public.hosted_video_jobs SET state='PREPARED'");
    expect(await nextSteps(database)).toEqual(["dispatch"]);
    for (const state of ["SUCCEEDED", "FAILED"]) {
      await database.exec(`UPDATE public.hosted_video_jobs SET state='${state}'`);
      expect(await nextSteps(database)).toEqual([]);
    }
    await database.exec(
      "UPDATE public.hosted_video_jobs SET state='SUBMITTED'; UPDATE public.generation_requests SET state='SUCCEEDED'",
    );
    expect(await nextSteps(database)).toEqual([]);
    await database.exec(
      "UPDATE public.generation_requests SET state='ACTIVE'; UPDATE public.hosted_api_generation_jobs SET state='FAILED'",
    );
    expect(await nextSteps(database)).toEqual([]);
    await database.exec(
      "UPDATE public.hosted_api_generation_jobs SET state='SUCCEEDED'; UPDATE public.projects SET status='ARCHIVED'",
    );
    expect(await nextSteps(database)).toEqual([]);
    await database.exec("UPDATE public.projects SET status='ACTIVE'");
    expect(
      (await database.query(DUE_QUERY, ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", null, null, null]))
        .rows,
    ).toEqual([]);
  } finally {
    await database.close();
  }
});

it.each([false, true])(
  "recovers prepared footage and an absent final-render handoff after accepted API media (rendering=%s)",
  async (rendering) => {
    const database = await seededDatabase({
      state: "SUCCEEDED",
      hash: "accepted",
      problemCode: null,
      redispatchCount: 0,
    });
    try {
      await database.exec(`
      INSERT INTO public.timeline_plans VALUES ('44444444-4444-4444-8444-444444444444', '${revisionId}');
      INSERT INTO public.hosted_prompt_runs (id,project_revision_id,state,acceptance_fingerprint_hash,created_at,started_at,problem_code,redispatch_count,planned_batch_count) VALUES
        ('55555555-5555-4555-8555-555555555555','${revisionId}','SUCCEEDED','accepted',now(),now(),NULL,0,1);
      INSERT INTO public.generation_requests (id,project_revision_id,state) VALUES
        ('66666666-6666-4666-8666-666666666666','${revisionId}','ACTIVE');
      INSERT INTO public.hosted_api_generation_jobs VALUES
        ('77777777-7777-4777-8777-777777777777','${revisionId}','SUCCEEDED');
      INSERT INTO public.hosted_video_jobs VALUES
        ('99999999-9999-4999-8999-999999999999','${revisionId}','PREPARED');
    `);
      if (rendering)
        await database.exec(`UPDATE public.hosted_video_jobs SET state='SUCCEEDED';
      INSERT INTO public.video_runtime_states VALUES
        ('${revisionId}','66666666-6666-4666-8666-666666666666','RENDERING')`);
      // Both interrupted handoffs must be found by the minute driver.
      expect(await nextSteps(database)).toEqual(["dispatch"]);
      await database.exec(
        `DELETE FROM public.video_runtime_states; UPDATE public.hosted_video_jobs SET state='FAILED'`,
      );
      expect(await nextSteps(database)).toEqual([]);
      await database.exec(`UPDATE public.hosted_video_jobs SET state='SUCCEEDED'`);
      expect(await nextSteps(database)).toEqual([]);
      await database.exec(`INSERT INTO public.video_runtime_states VALUES
      ('${revisionId}','66666666-6666-4666-8666-666666666666','RENDERING')`);
      // Final output ingestion can finish before the Workflow's render step throws or is terminated.
      expect(await nextSteps(database)).toEqual(["dispatch"]);
      await database.exec(`UPDATE public.hosted_video_jobs SET state='FAILED'`);
      expect(await nextSteps(database)).toEqual([]);
      await database.exec(`DELETE FROM public.hosted_video_jobs`);
      expect(await nextSteps(database)).toEqual(["dispatch"]); // Coverage Off has the same handoff.
      for (const state of ["PLANNED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"]) {
        await database.exec(`INSERT INTO public.hosted_cpu_job_attempts VALUES
        ('88888888-8888-4888-8888-888888888888','${revisionId}','RENDER','${state}',now())`);
        expect(await nextSteps(database)).toEqual([]); // Never schedule/replay an existing attempt.
        await database.exec(`DELETE FROM public.hosted_cpu_job_attempts WHERE kind='RENDER'`);
      }
      for (const state of ["WAITING", "CANCELLING", "CANCELLED", "SUCCEEDED", "FAILED"]) {
        await database.exec(`UPDATE public.generation_requests SET state='${state}'`);
        expect(await nextSteps(database)).toEqual([]);
      }
      await database.exec(`UPDATE public.generation_requests SET state='ACTIVE';
      INSERT INTO public.hosted_cpu_job_attempts VALUES
        ('88888888-8888-4888-8888-888888888888','${revisionId}','SPAN_AUDIO','FAILED',now())`);
      expect(await nextSteps(database)).toEqual([]);
      await database.exec(
        `DELETE FROM public.hosted_cpu_job_attempts WHERE kind='SPAN_AUDIO'; UPDATE public.hosted_api_generation_jobs SET state='UNKNOWN_NO_RETRY'`,
      );
      expect(await nextSteps(database)).toEqual([]);
      await database.exec(
        `UPDATE public.hosted_api_generation_jobs SET state='SUCCEEDED'; UPDATE public.projects SET status='ARCHIVED'`,
      );
      expect(await nextSteps(database)).toEqual([]);
    } finally {
      await database.close();
    }
  },
);

describe("hosted continuation sweep stage-3 recovery", () => {
  it("keeps the sweep's redispatch classes and budget identical to the route's", () => {
    expect([...CONTEXT_REDISPATCHABLE_PROBLEM_CODES].sort()).toEqual(
      [...HOSTED_CONTEXT_RETRYABLE_PROBLEM_CODES].sort(),
    );
    expect(CONTEXT_REDISPATCH_BUDGET).toBe(HOSTED_CONTEXT_REDISPATCH_BUDGET);
  });

  it("keeps the database's redispatch budget identical to the application constant", () => {
    // The capability enforces the budget again on its own, so a smaller number there is invisible to
    // this suite and strands the run: the sweep kept selecting the revision (its gate said six) while
    // the function answered 'hosted voiceover context redispatch budget is spent' from the third
    // failure on, and the run stopped at stage 3 with attempts the product believed it still had.
    const migrations = new URL(
      "../../../../../packages/control-plane/migrations/",
      import.meta.url,
    );
    const declaring = [...readdirSync(fileURLToPath(migrations))]
      .filter((name) => /^01\d\d_.*\.sql$/u.test(name))
      .sort()
      .reverse()
      .filter((name) => {
        const source = readFileSync(fileURLToPath(new URL(name, migrations)), "utf8");
        return (
          source.includes(
            "CREATE OR REPLACE FUNCTION public.videoforge_redispatch_hosted_voiceover_context",
          ) && source.includes("redispatch budget is spent")
        );
      });
    expect(declaring.length).toBeGreaterThan(0);
    const source = readFileSync(fileURLToPath(new URL(declaring[0]!, migrations)), "utf8");
    const declared = /existing\.redispatch_count\s*>=\s*(\d+)\s*THEN/u.exec(source);
    expect(declared?.[1]).toBe(String(HOSTED_CONTEXT_REDISPATCH_BUDGET));
  });

  it("keeps the newest stage-3 capability able to run with an unlimited revision budget", () => {
    // 0086 made project_revisions.maximum_cost_micro_usd nullable (NULL = unlimited) and replaced
    // `revision.maximum_cost_micro_usd>=10000` with TRUE inside the stage-3 capability. 0173 then
    // re-created the function from a stale copy and silently put the predicate back, so every
    // stage-3 start failed 42501 ('hosted voiceover context authority is invalid') for a NULL
    // budget, the sweep re-offered the step on every tick, and the revision sat at stage 3 forever.
    // The newest definition therefore has to either drop the predicate or carry it only to repair
    // it in place the way 0184 does through pg_get_functiondef.
    const migrations = new URL(
      "../../../../../packages/control-plane/migrations/",
      import.meta.url,
    );
    const recreatesFunction =
      /CREATE OR REPLACE FUNCTION\s+public\.videoforge_prepare_hosted_voiceover_context/u;
    const declaring = [...readdirSync(fileURLToPath(migrations))]
      .filter((name) => /^01\d\d_.*\.sql$/u.test(name))
      .sort()
      .reverse()
      .filter((name) => {
        const source = readFileSync(fileURLToPath(new URL(name, migrations)), "utf8");
        // A migration owns the capability when it re-creates the function or repairs the live
        // definition in place (0184's shape); the other mentions are call sites.
        return (
          source.includes("videoforge_prepare_hosted_voiceover_context") &&
          (recreatesFunction.test(source) || source.includes("pg_get_functiondef"))
        );
      });
    expect(declaring.length).toBeGreaterThan(0);
    const source = readFileSync(fileURLToPath(new URL(declaring[0]!, migrations)), "utf8");
    const carriesStaleCostPredicate =
      recreatesFunction.test(source) && /revision\.maximum_cost_micro_usd\s*>=\s*\d+/u.test(source);
    const repairsStaleCostPredicate =
      source.includes("pg_get_functiondef") &&
      source.includes("revision.maximum_cost_micro_usd>=10000") &&
      source.includes("TRUE");
    expect(!carriesStaleCostPredicate || repairsStaleCostPredicate).toBe(true);
  });

  it("re-runs stage 3 when the provider failed before an accepted result", async () => {
    const database = await seededDatabase({
      state: "UNKNOWN",
      hash: null,
      problemCode: "VOICEOVER_CONTEXT_PROVIDER_UNAVAILABLE",
      redispatchCount: 0,
    });
    await expect(nextSteps(database)).resolves.toEqual(["context"]);
  });

  it("re-runs stage 3 for a FAILED no-result context while the budget lasts", async () => {
    const database = await seededDatabase({
      state: "FAILED",
      hash: null,
      problemCode: "VOICEOVER_CONTEXT_NETWORK_UNCERTAIN",
      redispatchCount: CONTEXT_REDISPATCH_BUDGET - 1,
    });
    await expect(nextSteps(database)).resolves.toEqual(["context"]);
  });

  it("stops retrying once the redispatch budget is spent", async () => {
    const database = await seededDatabase({
      state: "UNKNOWN",
      hash: null,
      problemCode: "VOICEOVER_CONTEXT_PROVIDER_UNAVAILABLE",
      redispatchCount: CONTEXT_REDISPATCH_BUDGET,
    });
    await expect(nextSteps(database)).resolves.toEqual([]);
  });

  it("never redispatches a context that produced an accepted result", async () => {
    const database = await seededDatabase({
      state: "UNKNOWN",
      hash: "sha256:accepted",
      problemCode: "VOICEOVER_CONTEXT_RESPONSE_UNCERTAIN",
      redispatchCount: 0,
    });
    await expect(nextSteps(database)).resolves.toEqual([]);
  });

  it("retries a provider rejection inside the budget but still stops on a validation failure", async () => {
    // A rejection is retryable now that the one that stranded a revision was traced to the product's
    // own request shape (a token ceiling too small for the pinned model's reasoning truncated the
    // answer); the budget is what bounds it. A result the product itself refused to accept is not a
    // provider problem and must stay stopped.
    const rejected = await seededDatabase({
      state: "FAILED",
      hash: null,
      problemCode: "VOICEOVER_CONTEXT_PROVIDER_REJECTED",
      redispatchCount: 0,
    });
    await expect(nextSteps(rejected)).resolves.toEqual(["context"]);

    const outOfBudget = await seededDatabase({
      state: "FAILED",
      hash: null,
      problemCode: "VOICEOVER_CONTEXT_PROVIDER_REJECTED",
      redispatchCount: CONTEXT_REDISPATCH_BUDGET,
    });
    await expect(nextSteps(outOfBudget)).resolves.toEqual([]);

    const validationFailure = await seededDatabase({
      state: "FAILED",
      hash: null,
      problemCode: "VOICEOVER_CONTEXT_INVALID",
      redispatchCount: 0,
    });
    await expect(nextSteps(validationFailure)).resolves.toEqual([]);
  });

  it("keeps starting stage 3 when no context row exists yet", async () => {
    const database = await seededDatabase({
      state: null,
      hash: null,
      problemCode: null,
      redispatchCount: 0,
    });
    await expect(nextSteps(database)).resolves.toEqual(["context"]);
  });

  it("never offers the plan step for a revision pinned to an older config contract", async () => {
    // The three V2-06 owned-render acceptance fixtures store videoforge-hosted-revision-config/v1.
    // renderHandoff refuses any contract but the hosted v2 one, so offering the step only re-ran the
    // same 409 every tick - and kept dead fixtures inside the sweep's five-row limit.
    const database = await seededDatabase({
      state: "SUCCEEDED",
      hash: "sha256:" + "a".repeat(64),
      problemCode: null,
      redispatchCount: 0,
      revisionConfigSchema: "videoforge-hosted-revision-config/v1",
    });
    await expect(nextSteps(database)).resolves.toEqual([]);
  });

  it("keeps the plan gate equal to the generated contract's own schema_version", async () => {
    const { readFileSync } = await import("node:fs");
    const schema = JSON.parse(
      readFileSync(
        new URL(
          "../../../../../packages/contracts/generated/schemas/project_revision_config.schema.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { properties?: { schema_version?: { const?: string } } };
    expect(schema.properties?.schema_version?.const).toBe(
      PLAN_STAGE_REVISION_CONFIG_SCHEMA_VERSION,
    );
    expect(DUE_QUERY).toContain(
      `revision_config_schema = '${PLAN_STAGE_REVISION_CONFIG_SCHEMA_VERSION}'`,
    );
  });

  it("nudges a stale in-flight prompt run and mirrors the route's stale window", () => {
    // Stage 5's batch request can die with its invocation, leaving the run DISPATCHING forever with
    // no batch requeued; the sweep must keep offering the step past the stale window so the route's
    // bounded redispatch can repair it, and the two windows must not drift apart.
    expect(DUE_QUERY).toContain("prompt_state = 'DISPATCHING'");
    expect(DUE_QUERY).toContain("prompt_accepted_set IS NULL");
    expect(DUE_QUERY).toContain("make_interval(secs => 900)");
    expect(HOSTED_PROMPT_STALE_RUN_MS).toBe(900 * 1000);
    expect(DUE_QUERY).toContain("prompt_state IN ('FAILED', 'UNKNOWN')");
    // The sweep keeps its own copy (a static import would fold the prompt route's dynamic entry
    // back into the main bundle), so the two lists have to be compared.
    expect([...PROMPT_REDISPATCHABLE_PROBLEM_CODES]).toEqual([
      ...HOSTED_PROMPT_RETRYABLE_PROBLEM_CODES,
    ]);
  });

  it("offers only the next unclaimed prompt batch to the broad driver", async () => {
    const database = await seededDatabase({
      state: "SUCCEEDED",
      hash: "accepted",
      problemCode: null,
      redispatchCount: 0,
    });
    try {
      await database.exec(`
        INSERT INTO public.timeline_plans VALUES ('44444444-4444-4444-8444-444444444444', '${revisionId}');
        INSERT INTO public.hosted_prompt_runs (id,project_revision_id,state,acceptance_fingerprint_hash,created_at,started_at,problem_code,redispatch_count,planned_batch_count) VALUES
          ('55555555-5555-4555-8555-555555555555','${revisionId}','DISPATCHING',NULL,
           now(),now(),NULL,0,3);
        INSERT INTO public.hosted_prompt_batch_claims (id,run_id,batch_ordinal) VALUES
          ('66666666-6666-4666-8666-666666666666','55555555-5555-4555-8555-555555555555',0);
      `);
      expect(await nextSteps(database)).toEqual([]);
      await database.exec(`INSERT INTO public.hosted_prompt_batch_progress VALUES
        ('77777777-7777-4777-8777-777777777777','55555555-5555-4555-8555-555555555555')`);
      expect(await nextSteps(database)).toEqual(["prompts"]);
      await database.exec(`INSERT INTO public.hosted_prompt_batch_claims (id,run_id,batch_ordinal) VALUES
        ('88888888-8888-4888-8888-888888888888','55555555-5555-4555-8555-555555555555',1)`);
      expect(await nextSteps(database)).toEqual([]);
      // The targeted Workflow may inspect this exact claim through retrieval-only recovery.
      expect(
        (
          await database.query(DUE_QUERY, [
            accountId,
            "11111111-1111-4111-8111-111111111111",
            "prompts",
            revisionId,
          ])
        ).rows,
      ).toHaveLength(1);
    } finally {
      await database.close();
    }
  });

  it("retrieves an uncertain next claim only for active work and finalizes fully saved runs", async () => {
    const database = await seededDatabase({
      state: "SUCCEEDED",
      hash: "accepted",
      problemCode: null,
      redispatchCount: 0,
    });
    try {
      await database.exec(`
        INSERT INTO public.timeline_plans VALUES ('44444444-4444-4444-8444-444444444444', '${revisionId}');
        INSERT INTO public.hosted_prompt_runs (id,project_revision_id,state,acceptance_fingerprint_hash,created_at,started_at,problem_code,redispatch_count,planned_batch_count) VALUES
          ('55555555-5555-4555-8555-555555555555','${revisionId}','UNKNOWN',NULL,
           now(),now(),'HOSTED_PROMPT_DISPATCH_TIMEOUT',0,2);
        INSERT INTO public.hosted_prompt_batch_claims (id,run_id,batch_ordinal) VALUES
          ('66666666-6666-4666-8666-666666666666','55555555-5555-4555-8555-555555555555',0),
          ('88888888-8888-4888-8888-888888888888','55555555-5555-4555-8555-555555555555',1);
        INSERT INTO public.hosted_prompt_batch_progress VALUES
          ('77777777-7777-4777-8777-777777777777','55555555-5555-4555-8555-555555555555',0);
      `);
      expect(await nextSteps(database)).toEqual([]);
      // A user-requested project handoff can retrieve its existing claim before media admission.
      const target = await database.query<{ next_step: string }>(DUE_QUERY, [
        accountId,
        "11111111-1111-4111-8111-111111111111",
        "prompts",
        revisionId,
      ]);
      expect(target.rows.map((row) => row.next_step)).toEqual(["prompts"]);
      const wrongRevision = await database.query(DUE_QUERY, [
        accountId,
        "11111111-1111-4111-8111-111111111111",
        "prompts",
        userId,
      ]);
      expect(wrongRevision.rows).toEqual([]);
      await database.exec(`INSERT INTO public.generation_requests (id,project_revision_id,state) VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${revisionId}','ACTIVE')`);
      expect(await nextSteps(database)).toEqual(["prompts"]);
      await database.exec(`UPDATE public.generation_requests SET state='FAILED'`);
      expect(await nextSteps(database)).toEqual([]);
      await database.exec(`UPDATE public.generation_requests SET state='ACTIVE'`);
      await database.exec(`INSERT INTO public.hosted_prompt_batch_progress VALUES
        ('99999999-9999-4999-8999-999999999999','55555555-5555-4555-8555-555555555555',2)`);
      expect(await nextSteps(database)).toEqual([]);
      await database.exec(`UPDATE public.hosted_prompt_batch_progress SET batch_ordinal = 1
        WHERE id = '99999999-9999-4999-8999-999999999999'`);
      expect(await nextSteps(database)).toEqual(["prompts"]);
      await database.exec(`UPDATE public.hosted_prompt_runs
        SET problem_code = 'HOSTED_PROMPT_EXECUTION_UNKNOWN'`);
      expect(await nextSteps(database)).toEqual(["prompts"]);
    } finally {
      await database.close();
    }
  });

  it("still advances to planning once a context result was accepted", async () => {
    const database = await seededDatabase({
      state: "SUCCEEDED",
      hash: "sha256:accepted",
      problemCode: null,
      redispatchCount: 0,
    });
    await expect(nextSteps(database)).resolves.toEqual(["plan"]);
  });
});

it.each([
  { name: "legacy Gemini", profileRevision: 7, receipt: false, expected: ["prompts"] },
  { name: "Luna with receipt", profileRevision: 8, receipt: true, expected: ["prompts"] },
  { name: "Luna without receipt", profileRevision: 8, receipt: false, expected: [] },
  { name: "Luna v40 with receipt", profileRevision: 10, receipt: true, expected: ["prompts"] },
  { name: "Luna v40 without receipt", profileRevision: 10, receipt: false, expected: [] },
  {
    name: "Luna with an original receipt but missing latest correction receipt",
    profileRevision: 8,
    receipt: true,
    replacement: true,
    expected: [],
  },
])("gates UNKNOWN prompt continuation by recoverable receipt: $name", async (testCase) => {
  const database = await seededDatabase({
    state: "SUCCEEDED",
    hash: "accepted-context",
    problemCode: null,
    redispatchCount: 0,
  });
  try {
    const runId = "55555555-5555-4555-8555-555555555555";
    const taskUuid = "chatcmpl-test";
    const requestHash = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    await database.exec(`
      INSERT INTO public.timeline_plans VALUES ('44444444-4444-4444-8444-444444444444','${revisionId}');
      INSERT INTO public.execution_profiles VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',${testCase.profileRevision});
      INSERT INTO public.hosted_prompt_runs
        (id,project_revision_id,state,acceptance_fingerprint_hash,created_at,started_at,problem_code,redispatch_count,planned_batch_count,execution_profile_id)
      VALUES ('${runId}','${revisionId}','UNKNOWN',NULL,now(),now(),
        'HOSTED_PROMPT_EXECUTION_UNKNOWN',0,1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      INSERT INTO public.hosted_prompt_batch_claims
        (id,run_id,batch_ordinal,provider_task_uuid,request_hash)
      VALUES ('66666666-6666-4666-8666-666666666666','${runId}',0,'${taskUuid}','${requestHash}');
      ${testCase.replacement ? `INSERT INTO public.hosted_prompt_batch_replacements (claim_id,provider_task_uuid,request_hash,replacement_index) VALUES ('66666666-6666-4666-8666-666666666666','chatcmpl-correction','sha256:1111111111111111111111111111111111111111111111111111111111111111',1);` : ""}
      INSERT INTO public.generation_requests (id,project_revision_id,state) VALUES
        ('77777777-7777-4777-8777-777777777777','${revisionId}','ACTIVE');
      ${testCase.receipt ? `INSERT INTO public.prompt_response_receipts VALUES ('${taskUuid}','${requestHash}','{}'::jsonb);` : ""}
    `);
    expect(await nextSteps(database)).toEqual(testCase.expected);
  } finally {
    await database.close();
  }
});

it("keeps a fresh current Luna claim in flight even when the run itself is old", async () => {
  const database = await seededDatabase({
    state: "SUCCEEDED",
    hash: "accepted-context",
    problemCode: null,
    redispatchCount: 0,
  });
  try {
    const runId = "55555555-5555-4555-8555-555555555555";
    await database.exec(`
      INSERT INTO public.timeline_plans VALUES ('44444444-4444-4444-8444-444444444444','${revisionId}');
      INSERT INTO public.execution_profiles VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',8);
      INSERT INTO public.hosted_prompt_runs
        (id,project_revision_id,state,acceptance_fingerprint_hash,created_at,started_at,problem_code,redispatch_count,planned_batch_count,execution_profile_id)
      VALUES ('${runId}','${revisionId}','DISPATCHING',NULL,now(),now()-interval '1 hour',NULL,0,1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      INSERT INTO public.hosted_prompt_batch_claims
        (id,run_id,batch_ordinal,created_at)
      VALUES ('66666666-6666-4666-8666-666666666666','${runId}',0,now());
    `);
    expect(await nextSteps(database)).toEqual([]);
  } finally {
    await database.close();
  }
});

it("continues a fresh saved Luna receipt immediately without borrowing an original correction receipt", async () => {
  const database = await seededDatabase({
    state: "SUCCEEDED",
    hash: "accepted-context",
    problemCode: null,
    redispatchCount: 0,
  });
  try {
    const runId = "55555555-5555-4555-8555-555555555555";
    const claimId = "66666666-6666-4666-8666-666666666666";
    const requestHash = `sha256:${"0".repeat(64)}`;
    await database.exec(`
      INSERT INTO public.timeline_plans VALUES ('44444444-4444-4444-8444-444444444444','${revisionId}');
      INSERT INTO public.execution_profiles VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',9);
      INSERT INTO public.hosted_prompt_runs
        (id,project_revision_id,state,acceptance_fingerprint_hash,created_at,started_at,problem_code,redispatch_count,planned_batch_count,execution_profile_id)
      VALUES ('${runId}','${revisionId}','DISPATCHING',NULL,now(),now(),NULL,0,1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      INSERT INTO public.hosted_prompt_batch_claims (id,run_id,batch_ordinal,provider_task_uuid,request_hash)
      VALUES ('${claimId}','${runId}',0,'chatcmpl-test','${requestHash}');
      INSERT INTO public.generation_requests (id,project_revision_id,state) VALUES ('77777777-7777-4777-8777-777777777777','${revisionId}','ACTIVE');
    `);
    expect(await nextSteps(database)).toEqual([]);
    await database.exec(
      `INSERT INTO public.prompt_response_receipts VALUES ('chatcmpl-test','${requestHash}','{}'::jsonb)`,
    );
    expect(await nextSteps(database)).toEqual(["prompts"]);
    await database.exec(
      `INSERT INTO public.hosted_prompt_batch_replacements VALUES ('${claimId}','chatcmpl-correction','${requestHash}',1,now())`,
    );
    expect(await nextSteps(database)).toEqual([]);
    await database.exec(
      `INSERT INTO public.prompt_response_receipts VALUES ('chatcmpl-correction','${requestHash}','{}'::jsonb)`,
    );
    expect(await nextSteps(database)).toEqual(["prompts"]);
    await database.exec("UPDATE public.generation_requests SET state='CANCELLED'");
    expect(await nextSteps(database)).toEqual([]);
  } finally {
    await database.close();
  }
});

it("does not borrow an older run's missing-receipt claim when the latest run has no claim", async () => {
  const database = await seededDatabase({
    state: "SUCCEEDED",
    hash: "accepted-context",
    problemCode: null,
    redispatchCount: 0,
  });
  try {
    await database.exec(`
      INSERT INTO public.timeline_plans VALUES ('44444444-4444-4444-8444-444444444444','${revisionId}');
      INSERT INTO public.execution_profiles VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',8);
      INSERT INTO public.hosted_prompt_runs
        (id,project_revision_id,state,acceptance_fingerprint_hash,created_at,started_at,problem_code,redispatch_count,planned_batch_count,execution_profile_id)
      VALUES
        ('55555555-5555-4555-8555-555555555555','${revisionId}','UNKNOWN',NULL,now()-interval '2 hours',now()-interval '2 hours','HOSTED_PROMPT_EXECUTION_UNKNOWN',0,1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        ('99999999-9999-4999-8999-999999999999','${revisionId}','UNKNOWN',NULL,now(),now(),'HOSTED_PROMPT_EXECUTION_UNKNOWN',0,1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      INSERT INTO public.hosted_prompt_batch_claims (id,run_id,batch_ordinal)
      VALUES ('66666666-6666-4666-8666-666666666666','55555555-5555-4555-8555-555555555555',0);
      INSERT INTO public.generation_requests (id,project_revision_id,state) VALUES
        ('77777777-7777-4777-8777-777777777777','${revisionId}','ACTIVE');
    `);
    expect(await nextSteps(database)).toEqual(["prompts"]);
  } finally {
    await database.close();
  }
});
