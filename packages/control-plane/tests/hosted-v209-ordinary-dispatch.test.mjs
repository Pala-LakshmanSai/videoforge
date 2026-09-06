import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  expectDatabaseError,
  sha256,
  uuid,
  withPgcryptoMigratedDatabase,
} from "./support/pglite.mjs";

const migrationUrl = new URL(
  "../migrations/0074_hosted_v209_ordinary_dispatch.sql",
  import.meta.url,
);
const fixturePredispatchUrl = new URL(
  "../migrations/0042_hosted_atomic_pair_predispatch.sql",
  import.meta.url,
);

test("0074 installs the additive ordinary V2-09 DB boundaries without weakening 0042", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor, sources }) => {
    assert.ok(
      sources.some(
        ({ filename }) => filename === "0074_hosted_v209_ordinary_dispatch.sql",
      ),
    );
    const routines = await executor.query(
      `SELECT p.oid::regprocedure::text AS signature, p.prosecdef AS security_definer,
              has_function_privilege('public',p.oid,'EXECUTE') AS public_execute
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=ANY($1::text[])
        ORDER BY p.proname`,
      [
        [
          "videoforge_commit_hosted_v209_ordinary_pair",
          "videoforge_begin_hosted_v209_ordinary_send",
          "videoforge_commit_hosted_v209_ordinary_lane_materialization",
          "videoforge_import_hosted_v209_qualified_activation",
          "videoforge_load_hosted_gpu_activation_v2",
          "videoforge_load_hosted_v209_ordinary_lane_materialization",
          "videoforge_materialize_hosted_v209_ordinary_dispatch",
        ],
      ],
    );
    assert.equal(routines.rows.length, 7);
    assert.ok(routines.rows.every((row) => row.security_definer === true));
    assert.ok(routines.rows.every((row) => row.public_execute === false));

    const policies = await executor.query(
      `SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,count(policy.polname)::integer AS policies
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
         LEFT JOIN pg_catalog.pg_policy policy ON policy.polrelid=c.oid
        WHERE n.nspname='public' AND c.relname=ANY($1::text[])
        GROUP BY c.relname,c.relrowsecurity,c.relforcerowsecurity ORDER BY c.relname`,
      [
        [
          "hosted_v209_ordinary_dispatch_candidates",
          "hosted_v209_ordinary_lane_materializations",
          "hosted_v209_qualified_activations",
        ],
      ],
    );
    assert.deepEqual(
      policies.rows.map((row) => [
        row.relname,
        row.relrowsecurity,
        row.relforcerowsecurity,
        row.policies,
      ]),
      [
        ["hosted_v209_ordinary_dispatch_candidates", true, true, 1],
        ["hosted_v209_ordinary_lane_materializations", true, true, 1],
        ["hosted_v209_qualified_activations", false, false, 0],
      ],
    );
  });

  const fixtureSource = await readFile(fixturePredispatchUrl, "utf8");
  assert.equal(
    sha256(fixtureSource),
    "sha256:d7168a4143a813df7b9114f76f1efe71aa287bec4b1f137ab414a98e65e6b967",
  );
});

test("0074 derives deterministic UUIDs and fails closed without tenant-owned current lineage", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const generationRequestId = uuid(74001);
    const first = await executor.query(
      `SELECT public.videoforge_hosted_v209_uuid('candidate',$1::uuid,'ordinary') AS id`,
      [generationRequestId],
    );
    const replay = await executor.query(
      `SELECT public.videoforge_hosted_v209_uuid('candidate',$1::uuid,'ordinary') AS id`,
      [generationRequestId],
    );
    assert.match(first.rows[0].id, /^[0-9a-f-]{36}$/u);
    assert.equal(first.rows[0].id, replay.rows[0].id);
    await expectDatabaseError(
      () =>
        executor.query(
          `SELECT public.videoforge_materialize_hosted_v209_ordinary_dispatch(
             $1::uuid,$2::uuid,$3::uuid,$4::uuid)`,
          [uuid(74002), uuid(74003), uuid(74004), uuid(74005)],
        ),
      "42501",
    );
    await expectDatabaseError(
      () => executor.query(`SELECT public.videoforge_load_hosted_gpu_activation_v2()`),
      "42501",
    );
  });
});

test("0074 pins frozen Stage 6/7 artifacts without requiring nonexistent historical receipts", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const pinned of [
    "sha256:aeef45f237fd07e0937cdd51eaaf545ac0d8bb4c90eb105708f1681da787cc79",
    "sha256:aec6b4eca1b51db5b1742e806d28a26c32359a1ddecb615afae1a834dbdf15aa",
    "sha256:0f3203ceaedd8d570dcca301e32ca6d0ecb4d1136c32d5cd7d76fdc292a030cb",
    "sha256:f3b1d1414308d0783fe006d33e6482c027e05b6029a07843af66e4a9e1c1380e",
    "sha256:eca6cfe6acec62ed63ec1f7c9d40e7fb14e908c6e594da3864f936fa53670704",
    "sha256:9929d19da89ab2c20e280ac45ad152bc325b8bf56ef1e9c21e83d473c3408bc4",
  ]) {
    assert.match(sql, new RegExp(pinned.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.doesNotMatch(sql, /videoforge_verify_v213_qualification_receipt/u);
  assert.match(sql, /version BETWEEN 37 AND 49/u);
  assert.match(sql, /videoforge-hosted-qualified-gpu-activation-verifier-v1/u);
  assert.match(sql, /'enabledConfigSha256',activation\.deployed_config_sha256/u);
  assert.match(sql, /a\.state='MATERIALIZED'/u);
  assert.match(sql, /audio\.kind='AUDIO_SPAN'/u);
  assert.match(sql, /span_row\.span_content_type<>'audio\/wav'/u);
  assert.match(sql, /span_row\.span_sample_rate_hz IS DISTINCT FROM 48000/u);
  assert.match(sql, /'spanAudioSampleRateHz',span_row\.span_sample_rate_hz/u);
  assert.match(sql, /'paddedSamples48k',span_row\.padded_samples_48k/u);
  assert.match(sql, /'trimStartSample48k',span_row\.trim_start_sample_48k/u);
  assert.match(sql, /span_row\.trim_start_sample_48k%1920<>0/u);
  assert.match(sql, /\(task_row\.end_frame_exclusive-task_row\.start_frame\)\*1920/u);
  assert.match(sql, /'avatarSourceInputReservationId',avatar_input_id/u);
  assert.match(sql, /'spanAudioInputReservationId',input_id/u);
  assert.match(sql, /'avatarSourceInputReservationId',avatar_input_id/u);
  assert.match(sql, /CREATE TABLE public\.hosted_v209_ordinary_lane_materializations/u);
  assert.match(sql, /target\.attempt_state<>'PLANNED' OR target\.outbox_state IS NOT NULL/u);
  assert.match(sql, /supplied_request_body_sha256<>computed_request_sha/u);
  assert.match(sql, /supplied_expected_envelope_sha256<>computed_envelope_sha/u);
  assert.match(
    sql,
    /batch\.input_manifest_sha256,supplied_request_body_sha256,supplied_expected_envelope_sha256/u,
  );
  assert.match(sql, /authority_hash,supplied_request_body_sha256,/u);
  assert.match(sql, /supplied_lane='mage_image' AND deployment\.request_ttl_seconds<>7200/u);
  assert.match(sql, /supplied_lane='soulx_avatar' AND deployment\.request_ttl_seconds<>3600/u);
  assert.match(sql, /target\.deadline_at<>target\.attempt_created_at\+/u);
  assert.match(sql, /ARRAY\['inputs','outputs'\]::text\[\]/u);
  assert.match(sql, /ARRAY\['inputs'\]::text\[\]/u);
  assert.match(
    sql,
    /IF lane_name='mage_image' THEN[\s\S]*jsonb_agg\(value->>'output_reservation_id' ORDER BY ordinal\)[\s\S]*INTO worker_reservation_ids/u,
  );
  assert.match(
    sql,
    /worker_reservation_ids:=jsonb_build_array\(avatar_input_id\)\|\|[\s\S]*value->>'input_reservation_id'[\s\S]*\|\|[\s\S]*value->>'output_reservation_id'/u,
  );
  assert.match(sql, /'worker_transfer_port_reservation_ids',worker_reservation_ids/u);
  assert.match(
    sql,
    /'\{artifacts,transfer_port_reservation_ids\}',target\.worker_reservation_ids,false/u,
  );
  assert.match(sql, /'\{limits,issued_at\}'/u);
  assert.match(sql, /'\{limits,expires_at\}'/u);
  assert.match(sql, /'baseEnvelopeTemplateSha256',finalized_envelope_sha/u);
  assert.doesNotMatch(sql, /'unsignedEnvelopeTemplateSha256',finalized_envelope_sha/u);
  assert.match(sql, /public\.videoforge_canonical_jsonb\(supplied_request_body->'batch'\)/u);
  assert.match(
    sql,
    /supplied_request_body->'envelope'->'work'->>'items_manifest_sha256'<>computed_batch_sha/u,
  );
  assert.match(
    sql,
    /supplied_request_body->'envelope'->'artifacts'->>'plan_manifest_sha256'<>computed_batch_sha/u,
  );
});
