// @vitest-environment node

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("keeps project progress and continuation aligned for both pinned Luna profiles", async () => {
  // Execute the actual route predicates; a mocked progress row would miss profile drift.
  const source = readFileSync("src/server/hosted/product.ts", "utf8");
  const predicates = [
    /coalesce\(run\.execution_profile_id IS NOT NULL[\s\S]*?AS recovery_requires_attention/u,
    /coalesce\(run\.state='DISPATCHING'[\s\S]*?AS continuation_driver_eligible/u,
    /coalesce\(run\.state='UNKNOWN'[\s\S]*?AS automatic_recovery_pending/u,
  ].map((pattern) => {
    const match = source.match(pattern);
    if (!match) throw new Error("Project prompt-progress SQL predicate is missing.");
    return match[0];
  });
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE TABLE execution_profiles(id uuid PRIMARY KEY,revision integer);
      CREATE TABLE generation_requests(account_id uuid,workspace_id uuid,project_revision_id uuid,state text);
      CREATE TABLE projects(id uuid PRIMARY KEY,status text);
      CREATE TABLE hosted_prompt_batch_claims(run_id uuid,batch_ordinal integer);
      CREATE TABLE hosted_prompt_batch_progress(run_id uuid,batch_ordinal integer);
      CREATE FUNCTION videoforge_hosted_prompt_capacity_held(uuid) RETURNS boolean
        LANGUAGE sql AS $$ SELECT false $$;
      INSERT INTO generation_requests VALUES(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ACTIVE');
      INSERT INTO projects VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ACTIVE');
      INSERT INTO hosted_prompt_batch_claims VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0);
    `);
    for (const revision of [null, 7, 8, 9]) {
      await database.query("DELETE FROM execution_profiles");
      if (revision !== null)
        await database.query("INSERT INTO execution_profiles VALUES($1,$2)", [
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          revision,
        ]);
      for (const state of ["DISPATCHING", "UNKNOWN"]) {
        for (const receipt of [false, true]) {
          const result = await database.query<{
            recovery_requires_attention: boolean;
            continuation_driver_eligible: boolean;
            automatic_recovery_pending: boolean;
          }>(
            `WITH run AS (
              SELECT id,id AS account_id,id AS workspace_id,id AS project_revision_id,id AS project_id,
                CASE WHEN $1::integer IS NULL THEN NULL::uuid ELSE id END AS execution_profile_id,
                $2::text AS state,'HOSTED_PROMPT_EXECUTION_UNKNOWN'::text AS problem_code,
                true AS provider_may_have_charged,NULL::text AS acceptance_fingerprint_hash,
                1 AS planned_batch_count
              FROM (SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid AS id) identity
            ) SELECT ${predicates.join(",")}
              FROM run CROSS JOIN LATERAL(
                SELECT run.id,now()-interval '20 minutes' AS claimed_at,
                  CASE WHEN $3::boolean THEN '{}'::jsonb ELSE NULL::jsonb END AS recorded_result
              ) current_claim`,
            [revision, state, receipt],
          );
          const luna = revision === 8 || revision === 9;
          expect(result.rows[0], `profile=${revision},state=${state},receipt=${receipt}`).toEqual({
            recovery_requires_attention: luna && !receipt,
            continuation_driver_eligible: state === "DISPATCHING" && (!luna || receipt),
            automatic_recovery_pending: state === "UNKNOWN" && (!luna || receipt),
          });
        }
      }
    }
  } finally {
    await database.close();
  }
}, 15_000);
