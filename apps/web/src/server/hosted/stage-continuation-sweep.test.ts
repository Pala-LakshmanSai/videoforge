// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import {
  CONTEXT_REDISPATCH_BUDGET,
  CONTEXT_REDISPATCHABLE_PROBLEM_CODES,
  DUE_QUERY,
} from "./stage-continuation-sweep";
import {
  HOSTED_CONTEXT_REDISPATCH_BUDGET,
  HOSTED_CONTEXT_RETRYABLE_PROBLEM_CODES,
} from "./voiceover-context";

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
}): Promise<PGlite> {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE public.projects (
      id uuid PRIMARY KEY, account_id uuid NOT NULL, workspace_id uuid NOT NULL,
      status text NOT NULL, created_at timestamptz NOT NULL
    );
    CREATE TABLE public.project_revisions (
      id uuid PRIMARY KEY, account_id uuid NOT NULL, workspace_id uuid NOT NULL,
      project_id uuid NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL
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
      acceptance_fingerprint_hash text, created_at timestamptz NOT NULL
    );
    CREATE TABLE public.generation_requests (
      id uuid PRIMARY KEY, project_revision_id uuid NOT NULL
    );

    INSERT INTO public.projects VALUES
      ('11111111-1111-4111-8111-111111111111','${accountId}','${workspaceId}','ACTIVE',
        '2026-09-16T12:20:00Z');
    INSERT INTO public.project_revisions VALUES
      ('${revisionId}','${accountId}','${workspaceId}',
        '11111111-1111-4111-8111-111111111111','LOCKED','2026-09-16T12:20:10Z');
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
  const result = await database.query<{ next_step: string }>(DUE_QUERY, [accountId]);
  return result.rows.map((row) => row.next_step);
}

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

  it("never redispatches a definite rejection or a validation failure", async () => {
    const database = await seededDatabase({
      state: "FAILED",
      hash: null,
      problemCode: "VOICEOVER_CONTEXT_PROVIDER_REJECTED",
      redispatchCount: 0,
    });
    await expect(nextSteps(database)).resolves.toEqual([]);
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
