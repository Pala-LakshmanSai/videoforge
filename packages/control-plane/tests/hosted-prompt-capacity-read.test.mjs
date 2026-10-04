import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const runtime = "videoforge_v209_runtime_dc9612d6";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const migration = readFileSync(
  new URL("../migrations/0262_hosted_prompt_capacity_read.sql", import.meta.url),
  "utf8",
);
const product = readFileSync(
  new URL("../../../apps/web/src/server/hosted/product.ts", import.meta.url),
  "utf8",
);
const marker = "const promptProgress = await transaction.query(";
const query = product.slice(product.indexOf(marker)).split("`")[1];
assert.ok(query?.includes("AS capacity_hold"), "extract the actual Progress query");

test("0262 actual Progress query runs as the private runtime through tenant views without reading receipts", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE ${runtime} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
      CREATE FUNCTION public.videoforge_current_account_id() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('videoforge.account_id', true),'')::uuid;
      $$;
      CREATE TABLE public.hosted_prompt_runs (
        id uuid PRIMARY KEY, account_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        project_revision_id uuid NOT NULL, timeline_plan_id uuid NOT NULL, state text, problem_code text,
        started_at timestamptz, finished_at timestamptz, planned_scene_count integer, planned_batch_count integer,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.hosted_prompt_scene_progress(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,run_id uuid);
      CREATE TABLE public.hosted_prompt_batch_progress(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,run_id uuid);
      CREATE TABLE public.timeline_segments(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,project_revision_id uuid,timeline_plan_id uuid,timeline_composition text);
      CREATE TABLE public.repository_mutation_receipts(workspace_id uuid,idempotency_key text,operation text,result_payload jsonb);
      ALTER TABLE public.repository_mutation_receipts ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.repository_mutation_receipts FORCE ROW LEVEL SECURITY;
      REVOKE ALL ON public.repository_mutation_receipts FROM PUBLIC;
      CREATE SCHEMA tenant_runtime;
      GRANT USAGE ON SCHEMA tenant_runtime TO ${runtime};
    `);
    for (const table of [
      "hosted_prompt_runs",
      "hosted_prompt_scene_progress",
      "hosted_prompt_batch_progress",
      "timeline_segments",
    ]) {
      await db.exec(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_private ON public.${table} USING(account_id=public.videoforge_current_account_id());
        CREATE VIEW tenant_runtime.${table} WITH(security_barrier=true) AS
          SELECT * FROM public.${table} WHERE account_id=public.videoforge_current_account_id();
        REVOKE ALL ON public.${table} FROM PUBLIC;
        GRANT SELECT ON tenant_runtime.${table} TO ${runtime};`);
    }
    await db.exec(migration);
    const owned = [id(1), id(2), id(3), id(4), id(5), id(6)];
    const foreign = [id(11), id(12), id(13), id(14), id(15), id(16)];
    for (const [account, workspace, project, revision, timeline, run] of [owned, foreign]) {
      await db.query(
        `INSERT INTO public.hosted_prompt_runs(id,account_id,workspace_id,project_id,project_revision_id,timeline_plan_id,state,planned_scene_count,planned_batch_count)
        VALUES($1,$2,$3,$4,$5,$6,'DISPATCHING',100,4)`,
        [run, account, workspace, project, revision, timeline],
      );
      await db.query(
        `INSERT INTO public.repository_mutation_receipts(workspace_id,idempotency_key,operation,result_payload)
        VALUES($1,$2,'hosted_prompt_capacity_rejected',$3::jsonb)`,
        [workspace, `capacity-${run}`, JSON.stringify({ run_id: run })],
      );
    }
    await db.query(
      "INSERT INTO public.hosted_prompt_scene_progress VALUES($1,$2,$3,$4),($5,$2,$3,$4)",
      [id(21), owned[0], owned[1], owned[5], id(22)],
    );
    await db.query("INSERT INTO public.hosted_prompt_batch_progress VALUES($1,$2,$3,$4)", [
      id(23),
      owned[0],
      owned[1],
      owned[5],
    ]);
    await db.exec(`SET ROLE ${runtime}; SET search_path=tenant_runtime,public,pg_catalog;`);
    await db.query("SELECT set_config('videoforge.account_id',$1,false)", [owned[0]]);
    assert.equal(
      (
        await db.query(
          "SELECT rolsuper OR rolbypassrls AS privileged FROM pg_roles WHERE rolname=current_user",
        )
      ).rows[0].privileged,
      false,
    );
    await assert.rejects(db.query("SELECT * FROM public.repository_mutation_receipts"), {
      code: "42501",
    });
    await assert.rejects(
      db.query("INSERT INTO public.repository_mutation_receipts(workspace_id) VALUES($1)", [
        owned[1],
      ]),
      { code: "42501" },
    );
    assert.equal(
      (
        await db.query("SELECT public.videoforge_hosted_prompt_capacity_held($1) AS held", [
          owned[5],
        ])
      ).rows[0].held,
      true,
    );
    assert.equal(
      (
        await db.query("SELECT public.videoforge_hosted_prompt_capacity_held($1) AS held", [
          foreign[5],
        ])
      ).rows[0].held,
      false,
    );
    assert.equal(
      (await db.query("SELECT public.videoforge_hosted_prompt_capacity_held($1) AS held", [id(99)]))
        .rows[0].held,
      false,
    );
    const progress = await db.query(query, owned.slice(0, 5));
    assert.equal(progress.rows.length, 1);
    assert.equal(progress.rows[0].capacity_hold, true);
    assert.equal(Number(progress.rows[0].accepted_scenes), 2);
    assert.equal(Number(progress.rows[0].accepted_batches), 1);
    assert.equal((await db.query(query, foreign.slice(0, 5))).rows.length, 0);
    await db.exec("RESET ROLE; RESET search_path;");
  } finally {
    await db.close();
  }
});
