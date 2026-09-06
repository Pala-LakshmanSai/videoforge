import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { expectDatabaseError, uuid, withPgcryptoMigratedDatabase } from "./support/pglite.mjs";

const migrationUrl = new URL(
  "../migrations/0075_hosted_v209_span_audio_and_terminal.sql",
  import.meta.url,
);

test("0075 installs tenant-private span, terminal, and render seams", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor, sources }) => {
    assert.equal(sources.at(-1)?.filename, "0075_hosted_v209_span_audio_and_terminal.sql");
    const kind = await executor.query(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid='public.hosted_cpu_job_attempts'::regclass
          AND conname='hosted_cpu_job_attempts_kind_check'`,
    );
    assert.match(kind.rows[0].definition, /SPAN_AUDIO/u);
    const routines = await executor.query(
      `SELECT p.proname,p.prosecdef,
              has_function_privilege('public',p.oid,'EXECUTE') AS public_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=ANY($1::text[]) ORDER BY p.proname`,
      [
        [
          "videoforge_accept_hosted_v209_terminal_output",
          "videoforge_commit_hosted_v209_resolved_render_manifest",
          "videoforge_finalize_hosted_v209_span_audio",
          "videoforge_materialize_hosted_v209_span_audio_jobs",
          "videoforge_read_hosted_v209_ready_render_inputs",
          "videoforge_read_hosted_v209_terminal_lineage",
        ],
      ],
    );
    assert.equal(routines.rows.length, 6);
    assert.ok(routines.rows.every((row) => row.prosecdef === true));
    assert.ok(routines.rows.every((row) => row.public_execute === false));
    const tables = await executor.query(
      `SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,count(p.polname)::integer AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         LEFT JOIN pg_policy p ON p.polrelid=c.oid
        WHERE n.nspname='public' AND c.relname=ANY($1::text[])
        GROUP BY c.relname,c.relrowsecurity,c.relforcerowsecurity ORDER BY c.relname`,
      [
        [
          "hosted_v209_ordinary_resolved_render_manifests",
          "hosted_v209_span_audio_materializations",
        ],
      ],
    );
    assert.deepEqual(
      tables.rows.map((row) => [
        row.relname,
        row.relrowsecurity,
        row.relforcerowsecurity,
        row.policies,
      ]),
      [
        ["hosted_v209_ordinary_resolved_render_manifests", true, true, 1],
        ["hosted_v209_span_audio_materializations", true, true, 1],
      ],
    );
  });
});

test("0075 deterministic identities replay and every write seam rejects foreign tenant input", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const span = uuid(75001);
    const first = await executor.query(
      `SELECT public.videoforge_hosted_v209_span_uuid('attempt',$1::uuid,'personal-worker') AS id`,
      [span],
    );
    const replay = await executor.query(
      `SELECT public.videoforge_hosted_v209_span_uuid('attempt',$1::uuid,'personal-worker') AS id`,
      [span],
    );
    assert.equal(first.rows[0].id, replay.rows[0].id);
    await expectDatabaseError(
      () =>
        executor.query(
          `SELECT public.videoforge_materialize_hosted_v209_span_audio_jobs($1,$2,$3,$4)`,
          [uuid(75002), uuid(75003), uuid(75004), uuid(75005)],
        ),
      "42501",
    );
    await expectDatabaseError(
      () =>
        executor.query(
          `SELECT public.videoforge_finalize_hosted_v209_span_audio($1,$2,$3,'{}'::jsonb)`,
          [uuid(75002), uuid(75003), first.rows[0].id],
        ),
      "42501",
    );
    const hidden = await executor.query(
      `SELECT public.videoforge_read_hosted_v209_terminal_lineage($1,$2,$3,'mage_image','job') AS value,
              public.videoforge_read_hosted_v209_ready_render_inputs($1,$2,$4) AS render`,
      [uuid(75002), uuid(75003), first.rows[0].id, uuid(75006)],
    );
    assert.equal(hidden.rows[0].value, null);
    assert.equal(hidden.rows[0].render, null);
    await expectDatabaseError(
      () =>
        executor.query(
          `SELECT public.videoforge_accept_hosted_v209_terminal_output(
             $1,$2,$3,'job',$4,$5,'{}'::jsonb,'[]'::jsonb,now())`,
          [
            uuid(75002),
            uuid(75003),
            first.rows[0].id,
            `sha256:${"a".repeat(64)}`,
            `sha256:${"b".repeat(64)}`,
          ],
        ),
      "23514",
    );
    await expectDatabaseError(
      () =>
        executor.query(
          `SELECT public.videoforge_commit_hosted_v209_resolved_render_manifest(
             $1,$2,$3,'{}'::jsonb,$4,'tenant/x',1)`,
          [uuid(75002), uuid(75003), uuid(75006), `sha256:${"a".repeat(64)}`],
        ),
      "42501",
    );
  });
});

test("0075 pins exact 48 kHz cadence and recomputes binding and terminal hashes", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /output_profile','SOULX_PCM16_48K_MONO/u);
  assert.match(sql, /sample_rate_hz'\)::integer<>48000/u);
  assert.match(sql, /padded_samples%1920<>0/u);
  assert.match(sql, /trim_start_samples%1920<>0/u);
  assert.match(sql, /materialized\.request_body-'envelope'/u);
  assert.match(sql, /public\.videoforge_canonical_jsonb\(binding_components\)/u);
  assert.match(sql, /videoforge-hosted-serverless-terminal-output\/v1/u);
  assert.match(sql, /artifact_commit_receipt_sha256s',receipt_hashes/u);
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.videoforge_derive_hosted_output_barrier_completion/u,
  );
  assert.match(sql, /materialized\.full_request_sha256<>authority\.request_body_sha256/u);
  assert.match(sql, /current_account_id\(\) IS DISTINCT FROM supplied_account_id/u);
});
