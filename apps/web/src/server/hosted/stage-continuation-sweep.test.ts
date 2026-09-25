// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import {
  CONTEXT_REDISPATCH_BUDGET,
  CONTEXT_REDISPATCHABLE_PROBLEM_CODES,
  DUE_QUERY,
  PLAN_STAGE_REVISION_CONFIG_SCHEMA_VERSION,
  PROMPT_REDISPATCHABLE_PROBLEM_CODES,
} from "./stage-continuation-sweep";
import {
  HOSTED_CONTEXT_REDISPATCH_BUDGET,
  HOSTED_CONTEXT_RETRYABLE_PROBLEM_CODES,
} from "./voiceover-context";
import { HOSTED_PROMPT_RETRYABLE_PROBLEM_CODES, HOSTED_PROMPT_STALE_RUN_MS } from "./hosted-prompt-route";

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
      status text NOT NULL, created_at timestamptz NOT NULL
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
    CREATE TABLE public.hosted_prompt_runs (
      id uuid PRIMARY KEY, project_revision_id uuid NOT NULL, state text NOT NULL,
      acceptance_fingerprint_hash text, created_at timestamptz NOT NULL,
      -- The stale window follows the attempt's own start, which a redispatch refreshes.
      started_at timestamptz, problem_code text, redispatch_count integer,
      planned_batch_count integer
    );
    CREATE TABLE public.hosted_prompt_batch_claims (
      id uuid PRIMARY KEY, run_id uuid NOT NULL
    );
    CREATE TABLE public.hosted_prompt_batch_progress (
      id uuid PRIMARY KEY, run_id uuid NOT NULL
    );
    CREATE TABLE public.generation_requests (
      id uuid PRIMARY KEY, project_revision_id uuid NOT NULL
    );

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
  const result = await database.query<{ next_step: string }>(DUE_QUERY, [accountId, null, null, null]);
  return result.rows.map((row) => row.next_step);
}

it("selects only the requested project's due stage for an immediate handoff", async () => {
  const database = await seededDatabase({ state: null, hash: null, problemCode: null, redispatchCount: 0 });
  try {
    const projectId = "11111111-1111-4111-8111-111111111111";
    expect((await database.query(DUE_QUERY, [accountId, projectId, "context", revisionId])).rows).toHaveLength(1);
    expect((await database.query(DUE_QUERY, [accountId, projectId, "prompts", revisionId])).rows).toHaveLength(0);
    expect((await database.query(DUE_QUERY, [accountId, projectId, "context", "99999999-9999-4999-8999-999999999999"])).rows).toHaveLength(0);
  } finally {
    await database.close();
  }
});

it("offers a saved plan only to the targeted prompt handoff", async () => {
  const database = await seededDatabase({ state: "SUCCEEDED", hash: "accepted", problemCode: null, redispatchCount: 0 });
  try {
    await database.exec(`INSERT INTO public.timeline_plans VALUES ('44444444-4444-4444-8444-444444444444', '${revisionId}')`);
    const projectId = "11111111-1111-4111-8111-111111111111";
    expect((await database.query(DUE_QUERY, [accountId, projectId, "prompts", revisionId])).rows).toHaveLength(1);
    expect((await database.query(DUE_QUERY, [accountId, projectId, "context", revisionId])).rows).toHaveLength(0);
  } finally {
    await database.close();
  }
});

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
    const migrations = new URL("../../../../../packages/control-plane/migrations/", import.meta.url);
    const declaring = [...readdirSync(fileURLToPath(migrations))]
      .filter((name) => /^01\d\d_.*\.sql$/u.test(name))
      .sort()
      .reverse()
      .filter((name) => {
        const source = readFileSync(fileURLToPath(new URL(name, migrations)), "utf8");
        return source.includes("CREATE OR REPLACE FUNCTION public.videoforge_redispatch_hosted_voiceover_context")
          && source.includes("redispatch budget is spent");
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
    const migrations = new URL("../../../../../packages/control-plane/migrations/", import.meta.url);
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
        return source.includes("videoforge_prepare_hosted_voiceover_context")
          && (recreatesFunction.test(source) || source.includes("pg_get_functiondef"));
      });
    expect(declaring.length).toBeGreaterThan(0);
    const source = readFileSync(fileURLToPath(new URL(declaring[0]!, migrations)), "utf8");
    const carriesStaleCostPredicate = recreatesFunction.test(source)
      && /revision\.maximum_cost_micro_usd\s*>=\s*\d+/u.test(source);
    const repairsStaleCostPredicate = source.includes("pg_get_functiondef")
      && source.includes("revision.maximum_cost_micro_usd>=10000")
      && source.includes("TRUE");
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
        new URL("../../../../../packages/contracts/generated/schemas/project_revision_config.schema.json", import.meta.url),
        "utf8",
      ),
    ) as { properties?: { schema_version?: { const?: string } } };
    expect(schema.properties?.schema_version?.const).toBe(PLAN_STAGE_REVISION_CONFIG_SCHEMA_VERSION);
    expect(DUE_QUERY).toContain(`revision_config_schema = '${PLAN_STAGE_REVISION_CONFIG_SCHEMA_VERSION}'`);
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
      state: "SUCCEEDED", hash: "accepted", problemCode: null, redispatchCount: 0,
    });
    try {
      await database.exec(`
        INSERT INTO public.timeline_plans VALUES ('44444444-4444-4444-8444-444444444444', '${revisionId}');
        INSERT INTO public.hosted_prompt_runs VALUES
          ('55555555-5555-4555-8555-555555555555','${revisionId}','DISPATCHING',NULL,
           now(),now(),NULL,0,3);
        INSERT INTO public.hosted_prompt_batch_claims VALUES
          ('66666666-6666-4666-8666-666666666666','55555555-5555-4555-8555-555555555555');
      `);
      expect(await nextSteps(database)).toEqual([]);
      await database.exec(`INSERT INTO public.hosted_prompt_batch_progress VALUES
        ('77777777-7777-4777-8777-777777777777','55555555-5555-4555-8555-555555555555')`);
      expect(await nextSteps(database)).toEqual(["prompts"]);
      await database.exec(`INSERT INTO public.hosted_prompt_batch_claims VALUES
        ('88888888-8888-4888-8888-888888888888','55555555-5555-4555-8555-555555555555')`);
      expect(await nextSteps(database)).toEqual([]);
      // The targeted Workflow may inspect this exact claim through retrieval-only recovery.
      expect((await database.query(DUE_QUERY, [
        accountId, "11111111-1111-4111-8111-111111111111", "prompts", revisionId,
      ])).rows).toHaveLength(1);
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
