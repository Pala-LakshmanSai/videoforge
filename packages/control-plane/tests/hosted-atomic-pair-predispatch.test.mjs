import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";

import { canonicalizeJson } from "@videoforge/contracts";

import {
  canonicalSha256,
  exportMetadataSnapshot,
  restoreMetadataSnapshot,
  serializeMetadataSnapshot,
} from "../dist/src/index.js";
import { IDS } from "./support/fixtures.mjs";
import {
  createMigratedDatabase,
  sha256,
  uuid,
  withMigratedDatabase,
  withPgcryptoMigratedDatabase,
} from "./support/pglite.mjs";
import { seedMaterialization } from "./hosted-lane-batch-materialization.test.mjs";

async function seededPair(executor, productionPgcrypto = false) {
  // PGlite exposes digest/UUID primitives but not pgcrypto's random/envelope helpers. These
  // provider-free test shims preserve the production function signatures, randomness, encrypted
  // at-rest bytes, and wrong-key failure semantics exercised below.
  if (!productionPgcrypto) {
    await executor.execute(`CREATE FUNCTION public.gen_random_bytes(count integer) RETURNS bytea
      LANGUAGE sql VOLATILE AS $$ SELECT decode(substring(replace(gen_random_uuid()::text,'-','')||
        replace(gen_random_uuid()::text,'-','') FROM 1 FOR count*2),'hex') $$`);
    await executor.execute(`CREATE FUNCTION public.pgp_sym_encrypt(data text,key text,options text)
      RETURNS bytea LANGUAGE sql STRICT AS $$ SELECT convert_to(encode(sha256(convert_to(key,'UTF8')),'hex')||
        ':'||reverse(data),'UTF8') $$`);
    await executor.execute(`CREATE FUNCTION public.pgp_sym_decrypt(data bytea,key text)
      RETURNS text LANGUAGE plpgsql STRICT AS $$ DECLARE decoded text:=convert_from(data,'UTF8');
      expected text:=encode(sha256(convert_to(key,'UTF8')),'hex'); BEGIN
        IF split_part(decoded,':',1)<>expected THEN RAISE EXCEPTION 'Wrong key or corrupt data'; END IF;
        RETURN reverse(substring(decoded FROM 66)); END $$`);
  }
  const seeded = await seedMaterialization(executor);
  await executor.transaction(async (tx) => {
    await tx.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", IDS.accountA]);
    await tx.query(
      `SELECT * FROM videoforge_materialize_hosted_lane_batches($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        IDS.accountA,
        IDS.workspaceA,
        IDS.projectA,
        IDS.revisionA,
        seeded.generationRequestId,
        seeded.planSha256,
        JSON.stringify(seeded.batches),
      ],
    );
  });
  const lease = await executor.query(
    "SELECT id FROM provider_workload_leases WHERE generation_request_id=$1",
    [seeded.generationRequestId],
  );
  const lanes = [];
  const pair = [];
  for (const [index, batch] of seeded.batches.entries()) {
    const deployment = await executor.query(
      `SELECT *,videoforge_hosted_deployment_snapshot_sha256(id) AS snapshot
         FROM serverless_endpoint_deployments WHERE id=$1`,
      [batch.deployment_id],
    );
    const d = deployment.rows[0];
    const qualificationId = uuid(1_420_100 + index);
    const qualificationHash = sha256(`0042-qualification-${index}`);
    await executor.query(
      `INSERT INTO hosted_serverless_qualification_attestations(id,lane,deployment_id,
        deployment_snapshot_sha256,qualification_record_sha256,independent_audit_accepted,
        verified_at,expires_at,created_by_operator)
       VALUES($1,$2,$3,$4,$5,true,transaction_timestamp()-interval '1 minute',
        transaction_timestamp()+interval '1 hour','independent-test-auditor')`,
      [qualificationId, batch.lane, d.id, d.snapshot, qualificationHash],
    );
    lanes.push({
      lane: batch.lane,
      checkpoint_id: batch.lane === "mage_image" ? "V2-07" : "V2-08",
      operations: ["serverless_run", "serverless_status", "serverless_cancel"],
      resources: [
        `endpoint:${d.id}`,
        "gpu:nvidia-geforce-rtx-4090-eu-ro-1",
        `image:${d.worker_image_digest.slice(7)}`,
        `volume:${d.volume_id_sha256.slice(7)}`,
      ],
      deployment_id: d.id,
      endpoint_id_sha256: d.endpoint_id_sha256,
      endpoint_config_sha256: d.endpoint_config_sha256,
      worker_image_digest: d.worker_image_digest,
      model_manifest_sha256: d.model_manifest_sha256,
      volume_id_sha256: d.volume_id_sha256,
      volume_manifest_sha256: d.volume_manifest_sha256,
      deployment_snapshot_sha256: d.snapshot,
      qualification_attestation_id: qualificationId,
      qualification_record_sha256: qualificationHash,
    });
    pair.push({
      lane: batch.lane,
      batch_id: batch.id,
      task_id: batch.dispatch_task_id,
      attempt_id: batch.envelope.work.attempt_id,
      deployment_id: batch.deployment_id,
      deployment_snapshot_sha256: d.snapshot,
      request_body_sha256: batch.request_body_sha256,
      items_manifest_sha256: batch.items_manifest_sha256,
      input_manifest_sha256: batch.input_manifest_sha256,
      output_prefix: batch.output_prefix,
      unsigned_envelope: batch.envelope,
      spend_ceiling_usd: batch.spend_ceiling_usd,
      reservation_usd: batch.reservation_usd,
      rate_source: batch.rate_source,
      rate_checked_at: batch.rate_checked_at,
      qualification_attestation_id: qualificationId,
      qualification_record_sha256: qualificationHash,
    });
  }
  const approvalId = uuid(1_420_200);
  const approvalSha256 = sha256("0042-approval");
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  await executor.query(
    `INSERT INTO hosted_paid_dispatch_approvals(id,approval_sha256,account_id,workspace_id,
      project_id,project_revision_id,generation_request_id,generation_plan_sha256,lease_id,
      lane_bindings,maximum_cumulative_finite_cap_usd,expires_at,approved_by_operator,approved_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,2,$11,'test-operator',
      transaction_timestamp()-interval '1 minute')`,
    [
      approvalId,
      approvalSha256,
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      seeded.generationRequestId,
      seeded.planSha256,
      lease.rows[0].id,
      JSON.stringify(lanes),
      expiresAt,
    ],
  );
  return {
    ...seeded,
    leaseId: lease.rows[0].id,
    lanes,
    pair,
    approvalId,
    approvalSha256,
    expiresAt,
  };
}

function commit(executor, fixture, claimId = uuid(1_420_300), overrides = {}) {
  const values = {
    accountId: IDS.accountA,
    totalCapUsd: 2,
    tokenKey: "k".repeat(32),
    lanes: fixture.lanes,
    pair: fixture.pair,
    ...overrides,
  };
  return executor.transaction(async (tx) => {
    await tx.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", values.accountId]);
    await tx.query("SELECT set_config($1,$2,true)", [
      "videoforge.dispatch_token_key",
      values.tokenKey,
    ]);
    if (values.failTable)
      await tx.query("SELECT set_config($1,$2,true)", [
        "videoforge.test_fail_table",
        values.failTable,
      ]);
    return tx.query(
      `SELECT * FROM videoforge_commit_hosted_atomic_pair_predispatch(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::numeric,$13,$14::jsonb)`,
      [
        fixture.approvalId,
        fixture.approvalSha256,
        claimId,
        IDS.accountA,
        IDS.workspaceA,
        IDS.projectA,
        IDS.revisionA,
        fixture.generationRequestId,
        fixture.planSha256,
        fixture.leaseId,
        JSON.stringify(values.lanes),
        values.totalCapUsd,
        fixture.expiresAt,
        JSON.stringify(values.pair),
      ],
    );
  });
}

test("0042 installs only the narrow atomic pair capability", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const signature =
      "public.videoforge_commit_hosted_atomic_pair_predispatch(uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,numeric,timestamp with time zone,jsonb)";
    const source = await executor.query(
      `SELECT pg_get_functiondef($1::regprocedure) AS source, has_function_privilege('public',$1,'EXECUTE') AS allowed`,
      [signature],
    );
    assert.equal(source.rows[0].allowed, false);
    for (const required of [
      "transaction_timestamp()",
      "pg_advisory_xact_lock",
      "videoforge_claim_hosted_paid_dispatch",
      "hosted_lane_batches",
      "gen_random_bytes",
      "unsigned_envelope",
      "serverless_attempts",
      "serverless_predispatch_authorities",
      "serverless_dispatch_outbox",
      "serverless_cost_ledgers",
      "serverless_cost_events",
      "hosted_dispatch_token_vault",
      "WAITING_FOR_WORKER",
      "READY_TO_DISPATCH",
    ])
      assert.ok(source.rows[0].source.includes(required), `missing ${required}`);
  });
});

test("0042 raw tokens have no durable text column", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const columns = await executor.query(
      `SELECT table_name,column_name FROM information_schema.columns
        WHERE table_schema='public' AND column_name='dispatch_token'`,
    );
    assert.deepEqual(columns.rows, []);
  });
});

test("0042 runtime capability allows atomic pair but denies direct 0040 claim and tables", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await executor.execute(
      "CREATE ROLE vf_0042_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS",
    );
    await executor.execute(`GRANT USAGE ON SCHEMA public TO vf_0042_runtime;
      GRANT EXECUTE ON FUNCTION videoforge_commit_hosted_atomic_pair_predispatch(
        uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,numeric,timestamptz,jsonb)
      TO vf_0042_runtime;
      GRANT EXECUTE ON FUNCTION videoforge_recover_hosted_atomic_pair_tokens(uuid,uuid,uuid)
      TO vf_0042_runtime`);
    const privileges = await executor.query(
      `SELECT has_function_privilege('vf_0042_runtime',
        'videoforge_claim_hosted_paid_dispatch(uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,numeric,numeric,timestamptz)','EXECUTE') direct_claim,
        has_function_privilege('vf_0042_runtime',
        'videoforge_commit_hosted_atomic_pair_predispatch(uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,numeric,timestamptz,jsonb)','EXECUTE') atomic_pair,
        has_table_privilege('vf_0042_runtime','hosted_dispatch_token_vault','SELECT') vault_select`,
    );
    assert.deepEqual(privileges.rows[0], {
      direct_claim: false,
      atomic_pair: true,
      vault_select: false,
    });
  });
});

test("0042 executes exact pair success, encrypted recovery, and restart states", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const fixture = await seededPair(executor);
    const prospectiveSchedule = await executor.transaction(async (tx) => {
      await tx.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", IDS.accountA]);
      return tx.query(
        "SELECT * FROM videoforge_load_hosted_pair_workflow_schedule($1,$2,$3)",
        [IDS.accountA, IDS.workspaceA, fixture.generationRequestId],
      );
    });
    assert.equal(prospectiveSchedule.rows[0].existing_pair, false);
    assert.equal(
      new Date(prospectiveSchedule.rows[0].stop_at).getTime() -
        new Date(prospectiveSchedule.rows[0].cancel_at).getTime(),
      10 * 60 * 1_000,
    );
    const result = await commit(executor, fixture);
    assert.deepEqual(
      result.rows.map((row) => row.lane),
      ["mage_image", "soulx_avatar"],
    );
    assert.equal(new Set(result.rows.map((row) => row.dispatch_token)).size, 2);
    assert.ok(
      result.rows.every(
        (row) => row.dispatch_token.startsWith("dt-") && row.dispatch_token.length === 51,
      ),
    );
    assert.ok(
      result.rows.every(
        (row) =>
          row.deadline_at &&
          row.reconciliation_deadline_at &&
          row.endpoint_id_sha256 &&
          row.output_prefix &&
          row.authority_sha256 &&
          row.request_ttl_seconds > 0,
      ),
    );
    const counts = await executor.query(
      `SELECT (SELECT count(*)::int FROM hosted_paid_dispatch_claims) claims,
        (SELECT count(*)::int FROM serverless_attempts) attempts,
        (SELECT count(*)::int FROM serverless_predispatch_authorities) authorities,
        (SELECT count(*)::int FROM serverless_dispatch_outbox) outboxes,
        (SELECT count(*)::int FROM serverless_cost_ledgers) ledgers,
        (SELECT count(*)::int FROM serverless_cost_events) events,
        (SELECT count(*)::int FROM hosted_dispatch_token_vault) vault`,
    );
    assert.deepEqual(counts.rows[0], {
      claims: 1,
      attempts: 2,
      authorities: 2,
      outboxes: 2,
      ledgers: 2,
      events: 2,
      vault: 2,
    });
    const recovered = await executor.transaction(async (tx) => {
      await tx.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", IDS.accountA]);
      await tx.query("SELECT set_config($1,$2,true)", [
        "videoforge.dispatch_token_key",
        "k".repeat(32),
      ]);
      return tx.query("SELECT * FROM videoforge_recover_hosted_atomic_pair_tokens($1,$2,$3)", [
        IDS.accountA,
        IDS.workspaceA,
        fixture.generationRequestId,
      ]);
    });
    assert.deepEqual(
      recovered.rows.map((row) => row.dispatch_token),
      result.rows.map((row) => row.dispatch_token),
    );
    assert.ok(recovered.rows.every((row) => row.outbox_state === "READY_TO_DISPATCH"));
    const persistedSchedule = await executor.transaction(async (tx) => {
      await tx.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", IDS.accountA]);
      return tx.query(
        `SELECT s.*,c.claimed_at FROM videoforge_load_hosted_pair_workflow_schedule($1,$2,$3) s
          JOIN hosted_paid_dispatch_claims c ON c.account_id=$1 AND c.workspace_id=$2
            AND c.generation_request_id=$3`,
        [IDS.accountA, IDS.workspaceA, fixture.generationRequestId],
      );
    });
    assert.equal(persistedSchedule.rows[0].existing_pair, true);
    assert.equal(
      new Date(persistedSchedule.rows[0].cancel_at).getTime() -
        new Date(persistedSchedule.rows[0].claimed_at).getTime(),
      20 * 60 * 1_000,
    );
    assert.equal(
      new Date(persistedSchedule.rows[0].stop_at).getTime() -
        new Date(persistedSchedule.rows[0].claimed_at).getTime(),
      30 * 60 * 1_000,
    );
    const activation = await executor.transaction(async (tx) => {
      await tx.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", IDS.accountA]);
      return tx.query("SELECT videoforge_load_hosted_pair_activation($1,$2,$3) AS snapshot", [
        IDS.accountA,
        IDS.workspaceA,
        fixture.generationRequestId,
      ]);
    });
    assert.deepEqual(
      activation.rows[0].snapshot.migrationLedger.map((entry) => entry.version),
      [37, 38, 39, 40, 41, 42, 43],
    );
    assert.equal(activation.rows[0].snapshot.paidApproval.exact, true);
    assert.deepEqual(Object.keys(activation.rows[0].snapshot.lanes).sort(), [
      "mage_image",
      "soulx_avatar",
    ]);
    for (const lane of Object.values(activation.rows[0].snapshot.lanes)) {
      assert.equal(
        lane.qualification.deploymentSnapshotSha256,
        lane.deployment.deploymentSnapshotSha256,
      );
      assert.deepEqual(lane.authority.gpuAllowlist, lane.deployment.gpuAllowlist);
    }
    await assert.rejects(
      executor.transaction(async (tx) => {
        await tx.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", IDS.accountA]);
        await tx.query("SELECT set_config($1,$2,true)", [
          "videoforge.dispatch_token_key",
          "x".repeat(32),
        ]);
        return tx.query("SELECT * FROM videoforge_recover_hosted_atomic_pair_tokens($1,$2,$3)", [
          IDS.accountA,
          IDS.workspaceA,
          fixture.generationRequestId,
        ]);
      }),
    );
    const vault = await executor.query(
      "SELECT encode(token_ciphertext,'hex') AS ciphertext FROM hosted_dispatch_token_vault",
    );
    for (const row of vault.rows) {
      assert.ok(
        !result.rows.some((resultRow) => row.ciphertext.includes(resultRow.dispatch_token)),
      );
    }
    await executor.query(
      `UPDATE provider_workload_leases SET state='EXPIRED',
      released_at=transaction_timestamp(),release_reason='0042 recovery freshness test',
      version=version+1 WHERE id=$1`,
      [fixture.leaseId],
    );
    await assert.rejects(
      executor.transaction(async (tx) => {
        await tx.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", IDS.accountA]);
        await tx.query("SELECT set_config($1,$2,true)", [
          "videoforge.dispatch_token_key",
          "k".repeat(32),
        ]);
        return tx.query("SELECT * FROM videoforge_recover_hosted_atomic_pair_tokens($1,$2,$3)", [
          IDS.accountA,
          IDS.workspaceA,
          fixture.generationRequestId,
        ]);
      }),
      /authority is stale or incomplete/u,
    );
  });
});

test("0043 persists one-shot Mage SENT and refuses ghost-job absence settlement", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const fixture = await seededPair(executor);
    await commit(executor, fixture);
    const begun = await executor.transaction(async (tx) => {
      await tx.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", IDS.accountA]);
      await tx.query("SELECT set_config($1,$2,true)", [
        "videoforge.dispatch_token_key",
        "k".repeat(32),
      ]);
      const prepared = await tx.query(
        "SELECT * FROM videoforge_prepare_hosted_pair_send($1,$2,$3)",
        [IDS.accountA, IDS.workspaceA, fixture.generationRequestId],
      );
      return tx.query(
        "SELECT * FROM videoforge_begin_hosted_pair_send($1,$2,$3,'mage_image',$4,$5)",
        [
          IDS.accountA,
          IDS.workspaceA,
          fixture.generationRequestId,
          prepared.rows[0].attempt_id,
          prepared.rows[0].expected_envelope_sha256,
        ],
      );
    });
    assert.equal(begun.rows.length, 1);
    const sent = await executor.query(
      "SELECT state,send_attempt_count,lease_id,lease_holder_sha256 FROM serverless_dispatch_outbox WHERE attempt_id=$1",
      [begun.rows[0].attempt_id],
    );
    assert.deepEqual(
      { state: sent.rows[0].state, sends: sent.rows[0].send_attempt_count },
      { state: "SENT", sends: 1 },
    );
    assert.ok(sent.rows[0].lease_id && sent.rows[0].lease_holder_sha256);
    await assert.rejects(
      executor.transaction(async (tx) => {
        await tx.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", IDS.accountA]);
        await tx.query("SELECT set_config($1,$2,true)", [
          "videoforge.dispatch_token_key",
          "k".repeat(32),
        ]);
        return tx.query(
          "SELECT * FROM videoforge_begin_hosted_pair_send($1,$2,$3,'mage_image',$4,$5)",
          [
            IDS.accountA,
            IDS.workspaceA,
            fixture.generationRequestId,
            begun.rows[0].attempt_id,
            begun.rows[0].expected_envelope_sha256,
          ],
        );
      }),
    );
    await executor.transaction(async (tx) => {
      await tx.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", IDS.accountA]);
      await tx.query(
        "SELECT * FROM videoforge_finish_hosted_pair_send($1,$2,$3,'mage_image','DISPATCH_ACK_UNKNOWN',NULL,$4,$5)",
        [
          IDS.accountA,
          IDS.workspaceA,
          fixture.generationRequestId,
          begun.rows[0].deployment_id,
          begun.rows[0].dispatch_token_sha256,
        ],
      );
    });
    const attempts = await executor.query(
      "SELECT id,lane,deployment_id,dispatch_token_sha256 FROM serverless_attempts WHERE generation_request_id=$1 ORDER BY lane",
      [fixture.generationRequestId],
    );
    const observations = attempts.rows.map((row) => ({
      lane: row.lane,
      attempt_id: row.id,
      deployment_id: row.deployment_id,
      dispatch_token_sha256: row.dispatch_token_sha256,
      provider_job_id: null,
      provider_state: "ABSENT",
      provider_proof_sha256: sha256(`forged-${row.lane}`),
      observed_at: new Date().toISOString(),
    }));
    await assert.rejects(
      executor.transaction(async (tx) => {
        await tx.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", IDS.accountA]);
        return tx.query("SELECT * FROM videoforge_settle_hosted_pair_cleanup($1,$2,$3,$4::jsonb)", [
          IDS.accountA,
          IDS.workspaceA,
          fixture.generationRequestId,
          JSON.stringify(observations),
        ]);
      }),
    );
    await assert.rejects(
      executor.transaction(async (tx) => {
        await tx.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", IDS.accountA]);
        return tx.query("SELECT * FROM videoforge_settle_hosted_pair_cleanup($1,$2,$3,$4::jsonb)", [
          IDS.accountA,
          IDS.workspaceA,
          fixture.generationRequestId,
          JSON.stringify([observations[0], observations[0]]),
        ]);
      }),
    );
    const lease = await executor.query(
      "SELECT state FROM provider_workload_leases WHERE generation_request_id=$1",
      [fixture.generationRequestId],
    );
    assert.equal(lease.rows[0].state, "ACTIVE");
  });
});

test("0044 atomically persists signed two-lane zero proof and settles render readiness", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const fixture = await seededPair(executor, true);
    await commit(executor, fixture);
    const prepared = await executor.transaction(async (tx) => {
      await tx.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", IDS.accountA]);
      await tx.query("SELECT set_config($1,$2,true)", [
        "videoforge.dispatch_token_key",
        "k".repeat(32),
      ]);
      return tx.query("SELECT * FROM videoforge_prepare_hosted_pair_send($1,$2,$3)", [
        IDS.accountA,
        IDS.workspaceA,
        fixture.generationRequestId,
      ]);
    });

    for (const lane of ["mage_image", "soulx_avatar"]) {
      const target = prepared.rows.find((row) => row.lane === lane);
      const providerJobId = `completed-${lane}-job`;
      await executor.transaction(async (tx) => {
        await tx.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", IDS.accountA]);
        await tx.query("SELECT set_config($1,$2,true)", [
          "videoforge.dispatch_token_key",
          "k".repeat(32),
        ]);
        await tx.query(
          "SELECT * FROM videoforge_begin_hosted_pair_send($1,$2,$3,$4,$5,$6)",
          [
            IDS.accountA,
            IDS.workspaceA,
            fixture.generationRequestId,
            lane,
            target.attempt_id,
            target.expected_envelope_sha256,
          ],
        );
        await tx.query(
          "SELECT * FROM videoforge_finish_hosted_pair_send($1,$2,$3,$4,'ASSIGNED',$5,$6,$7)",
          [
            IDS.accountA,
            IDS.workspaceA,
            fixture.generationRequestId,
            lane,
            providerJobId,
            target.deployment_id,
            target.dispatch_token_sha256,
          ],
        );
      });
    }

    const attempts = await executor.query(
      `SELECT a.id,a.lane,a.project_revision_id,a.output_prefix,a.dispatch_token_sha256,
              a.deployment_id,s.id assignment_id,s.provider_job_id,d.endpoint_id_sha256,
              d.endpoint_config_sha256,d.worker_image_digest,d.model_manifest_sha256,
              d.volume_id_sha256,d.volume_manifest_sha256
         FROM serverless_attempts a
         JOIN serverless_provider_assignments s ON s.attempt_id=a.id AND s.is_current
         JOIN serverless_endpoint_deployments d ON d.id=a.deployment_id
        WHERE a.generation_request_id=$1
        ORDER BY CASE a.lane WHEN 'mage_image' THEN 1 ELSE 2 END`,
      [fixture.generationRequestId],
    );
    const observations = [];
    for (const [index, attempt] of attempts.rows.entries()) {
      const itemId = fixture.batches.find((batch) => batch.lane === attempt.lane)?.items[0].item_id;
      assert.ok(itemId);
      const objectKey = `${attempt.output_prefix}/artifact/${itemId}`;
      const checksumSha256 = sha256(`completed-${attempt.lane}-artifact`);
      const artifactReceiptSha256 = sha256(`completed-${attempt.lane}-commit`);
      const provenanceReceiptSha256 = sha256(`completed-${attempt.lane}-provenance`);
      const expectedObjects = [
        {
          item_id: itemId,
          object_key: objectKey,
          content_type: attempt.lane === "mage_image" ? "image/png" : "video/mp4",
          content_length: 1000 + index,
          checksum_sha256: checksumSha256,
        },
      ];
      const bindingComponents = {
        account_id: IDS.accountA,
        workspace_id: IDS.workspaceA,
        project_id: IDS.projectA,
        project_revision_id: IDS.revisionA,
        lane: attempt.lane,
        attempt_id: attempt.id,
        provider_job_id: attempt.provider_job_id,
        dispatch_token_sha256: attempt.dispatch_token_sha256,
        deployment_id: attempt.deployment_id,
        endpoint_id_sha256: attempt.endpoint_id_sha256,
        endpoint_config_sha256: attempt.endpoint_config_sha256,
        worker_image_digest: attempt.worker_image_digest,
        model_manifest_sha256: attempt.model_manifest_sha256,
        volume_id_sha256: attempt.volume_id_sha256,
        volume_manifest_sha256: attempt.volume_manifest_sha256,
        expected_objects: expectedObjects,
      };
      const reservationId = uuid(1_421_000 + index * 4);
      await executor.query(
        `INSERT INTO artifact_reservations(id,account_id,workspace_id,project_id,
          project_revision_id,lane,job_id,artifact_id,object_key,method,content_type,
          content_length,checksum_sha256,expires_at,max_uses,used_count,state,retention_class,
          deletion_owner_account_id,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PUT',$10,$11,$12,
          transaction_timestamp()+interval '1 hour',1,1,'COMMITTED','PROJECT',$2,
          transaction_timestamp(),transaction_timestamp())`,
        [
          reservationId,
          IDS.accountA,
          IDS.workspaceA,
          IDS.projectA,
          IDS.revisionA,
          attempt.lane === "mage_image" ? "MAGE_IMAGE" : "SOULX_AVATAR",
          attempt.id,
          itemId,
          objectKey,
          expectedObjects[0].content_type,
          expectedObjects[0].content_length,
          checksumSha256,
        ],
      );
      await executor.query(
        `INSERT INTO artifact_receipts(id,account_id,workspace_id,reservation_id,callback_id,
          object_key,content_type,content_length,checksum_sha256,probe,receipt_sha256,committed_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}'::jsonb,$10,transaction_timestamp())`,
        [
          uuid(1_421_001 + index * 4),
          IDS.accountA,
          IDS.workspaceA,
          reservationId,
          `completed-${attempt.lane}-callback`,
          objectKey,
          expectedObjects[0].content_type,
          expectedObjects[0].content_length,
          checksumSha256,
          artifactReceiptSha256,
        ],
      );
      await executor.query(
        `INSERT INTO serverless_provenance_receipts(id,account_id,workspace_id,
          project_revision_id,attempt_id,assignment_id,receipt_nonce,attestation_scope,worker_id,
          provider_job_id,gpu_name,gpu_uuid_sha256,driver_version,cuda_version,intended_region,
          intended_volume_id_sha256,manifest_sha256_before,manifest_sha256_after,mutation_detected,
          cross_mount_detected,model_ready,timings,items,receipt_sha256,signature_key_id,
          signature_value,issued_at,accepted_at)
         VALUES($1,$2,$3,$4,$5,$6,1,
          'VIDEOFORGE_APPLICATION_SIGNED_FACTS_NOT_PROVIDER_HARDWARE_ATTESTATION',$7,$8,
          'NVIDIA GeForce RTX 4090',$9,'550.90.07','12.4','EU-RO-1',$10,$11,$11,
          false,false,true,'{}'::jsonb,$12::jsonb,$13,'test-signing-key',$14,
          transaction_timestamp(),transaction_timestamp())`,
        [
          uuid(1_421_002 + index * 4),
          IDS.accountA,
          IDS.workspaceA,
          IDS.revisionA,
          attempt.id,
          attempt.assignment_id,
          `worker-${attempt.lane}`,
          attempt.provider_job_id,
          sha256(`completed-${attempt.lane}-gpu`),
          attempt.volume_id_sha256,
          attempt.volume_manifest_sha256,
          JSON.stringify([
            {
              item_id: itemId,
              state: "SUCCEEDED",
              output_object_key: objectKey,
              output_sha256: checksumSha256,
              output_bytes: expectedObjects[0].content_length,
              probe: {},
            },
          ]),
          provenanceReceiptSha256,
          "a".repeat(64),
        ],
      );
      await executor.query(
        `INSERT INTO hosted_serverless_output_barrier_completions(account_id,workspace_id,
          attempt_id,binding_sha256,callback_sha256,binding_components,
          provenance_receipt_sha256,artifact_commit_receipt_sha256s,completed_at)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,transaction_timestamp())`,
        [
          IDS.accountA,
          IDS.workspaceA,
          attempt.id,
          canonicalSha256(bindingComponents),
          sha256(`completed-${attempt.lane}-barrier-callback`),
          JSON.stringify(bindingComponents),
          provenanceReceiptSha256,
          JSON.stringify([artifactReceiptSha256]),
        ],
      );
      const proofBase = {
        lane: attempt.lane,
        attempt_id: attempt.id,
        deployment_id: attempt.deployment_id,
        dispatch_token_sha256: attempt.dispatch_token_sha256,
        provider_job_id: attempt.provider_job_id,
        provider_state: "COMPLETED",
      };
      observations.push({
        ...proofBase,
        provider_proof_sha256: canonicalSha256(proofBase),
        observed_at: new Date().toISOString(),
      });
    }

    const proofSecretHex = "ab".repeat(32);
    await executor.query(
      "INSERT INTO hosted_provider_proof_keys(key_id,secret_hex) VALUES($1,$2)",
      ["proof-key-v1", proofSecretHex],
    );
    const zeroWorkerProofs = attempts.rows.map((attempt) => {
      const unsigned = {
        schema_version: "videoforge-hosted-zero-worker-proof/v1",
        account_id: IDS.accountA,
        workspace_id: IDS.workspaceA,
        generation_request_id: fixture.generationRequestId,
        lane: attempt.lane,
        endpoint_id_sha256: attempt.endpoint_id_sha256,
        workers_total: 0,
        queued_jobs: 0,
        observed_at: new Date().toISOString(),
      };
      const signatureValue = createHmac("sha256", Buffer.from(proofSecretHex, "hex"))
        .update(canonicalizeJson(unsigned))
        .digest("hex");
      return {
        ...unsigned,
        proof_sha256: canonicalSha256(unsigned),
        signature_key_id: "proof-key-v1",
        signature_value: signatureValue,
        signature_sha256: `sha256:${createHash("sha256").update(signatureValue).digest("hex")}`,
      };
    });
    const settled = await executor.transaction(async (tx) => {
      await tx.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", IDS.accountA]);
      return tx.query(
        "SELECT * FROM videoforge_settle_hosted_pair_cleanup_v2($1,$2,$3,$4::jsonb,$5::jsonb)",
        [
          IDS.accountA,
          IDS.workspaceA,
          fixture.generationRequestId,
          JSON.stringify(observations),
          JSON.stringify(zeroWorkerProofs),
        ],
      );
    });
    assert.deepEqual(settled.rows, [{ pair_phase: "SETTLED", released: true }]);
    const zeroEvidence = await executor.query(
      `SELECT lane,workers_total,queued_jobs FROM hosted_pair_zero_worker_observations
        WHERE generation_request_id=$1 ORDER BY lane`,
      [fixture.generationRequestId],
    );
    assert.deepEqual(zeroEvidence.rows, [
      { lane: "mage_image", workers_total: 0, queued_jobs: 0 },
      { lane: "soulx_avatar", workers_total: 0, queued_jobs: 0 },
    ]);
    const state = await executor.query(
      `SELECT
        (SELECT count(*)::int FROM video_runtime_accepted_units WHERE runtime_id=r.id) accepted,
        (SELECT bool_and(state='SUCCEEDED' AND accepted_item_count=planned_item_count)
           FROM video_runtime_lane_states WHERE runtime_id=r.id) lanes_succeeded,
        r.stage runtime_stage,g.state generation_state,l.state lease_state,p.phase pair_phase
       FROM video_runtime_states r
       JOIN generation_requests g ON g.id=r.generation_request_id
       JOIN provider_workload_leases l ON l.generation_request_id=r.generation_request_id
       JOIN hosted_pair_runtime_states p ON p.generation_request_id=r.generation_request_id
       WHERE r.generation_request_id=$1`,
      [fixture.generationRequestId],
    );
    assert.deepEqual(state.rows[0], {
      accepted: 2,
      lanes_succeeded: true,
      runtime_stage: "RENDERING",
      generation_state: "ACTIVE",
      lease_state: "RELEASED",
      pair_phase: "SETTLED",
    });
  });
});

test("0042 rolls the paid claim and every pair row back after injected row-class failures", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const fixture = await seededPair(executor);
    await executor.execute(`CREATE FUNCTION public.videoforge_test_0042_fail() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF current_setting('videoforge.test_fail_table',true)=TG_TABLE_NAME THEN
          RAISE EXCEPTION 'injected 0042 failure';
        END IF; RETURN NEW; END $$`);
    const tables = [
      "hosted_paid_dispatch_claims",
      "serverless_attempts",
      "serverless_predispatch_authorities",
      "serverless_dispatch_outbox",
      "hosted_dispatch_token_vault",
      "serverless_cost_ledgers",
      "serverless_cost_events",
    ];
    for (const table of tables) {
      await executor.execute(`CREATE TRIGGER test_0042_fail_${table} AFTER INSERT ON ${table}
        FOR EACH ROW EXECUTE FUNCTION public.videoforge_test_0042_fail()`);
    }
    for (const [index, table] of tables.entries()) {
      await assert.rejects(
        commit(executor, fixture, uuid(1_420_400 + index), { failTable: table }),
        /injected 0042 failure/u,
      );
      const counts = await executor.query(
        `SELECT (SELECT count(*)::int FROM hosted_paid_dispatch_claims) claims,
          (SELECT count(*)::int FROM serverless_attempts) attempts,
          (SELECT count(*)::int FROM serverless_predispatch_authorities) authorities,
          (SELECT count(*)::int FROM serverless_dispatch_outbox) outboxes,
          (SELECT count(*)::int FROM hosted_dispatch_token_vault) vault,
          (SELECT count(*)::int FROM serverless_cost_ledgers) ledgers,
          (SELECT count(*)::int FROM serverless_cost_events) events`,
      );
      assert.deepEqual(
        counts.rows[0],
        { claims: 0, attempts: 0, authorities: 0, outboxes: 0, vault: 0, ledgers: 0, events: 0 },
        table,
      );
      const lanes = await executor.query(
        "SELECT state,current_attempt_id,attempt_ordinal FROM video_runtime_lane_states ORDER BY lane",
      );
      assert.ok(
        lanes.rows.every(
          (row) =>
            row.state === "MANIFEST_DURABLE" &&
            row.current_attempt_id === null &&
            row.attempt_ordinal === 0,
        ),
      );
    }
  });
});

test("0042 serializes concurrent claims and rejects cap, hash, lineage, and qualification drift", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const fixture = await seededPair(executor);
    const contenders = await Promise.allSettled([
      commit(executor, fixture, uuid(1_420_500)),
      commit(executor, fixture, uuid(1_420_501)),
    ]);
    assert.equal(contenders.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(contenders.filter((result) => result.status === "rejected").length, 1);
  });
  for (const mutate of [
    () => ({ totalCapUsd: 0.5 }),
    (fixture) => {
      const pair = structuredClone(fixture.pair);
      pair[0].request_body_sha256 = sha256("drift");
      return { pair };
    },
    (fixture) => {
      const pair = structuredClone(fixture.pair);
      pair[0].task_id = uuid(1_429_999);
      return { pair };
    },
    (fixture) => {
      const pair = structuredClone(fixture.pair);
      pair[0].qualification_record_sha256 = sha256("foreign");
      return { pair };
    },
  ]) {
    await withMigratedDatabase(async ({ executor }) => {
      const fixture = await seededPair(executor);
      await assert.rejects(commit(executor, fixture, uuid(1_420_600), mutate(fixture)));
      assert.equal(
        (await executor.query("SELECT count(*)::int count FROM hosted_paid_dispatch_claims"))
          .rows[0].count,
        0,
      );
      assert.equal(
        (await executor.query("SELECT count(*)::int count FROM serverless_attempts")).rows[0].count,
        0,
      );
    });
  }
});

test("0042 populated metadata restores attestations while excluding token ciphertext", async () => {
  const source = await createMigratedDatabase();
  const destination = await createMigratedDatabase();
  try {
    const fixture = await seededPair(source.executor);
    await commit(source.executor, fixture);
    await source.executor.execute(
      "ALTER TABLE hosted_canonical_timing_bridges DISABLE TRIGGER ALL",
    );
    await source.executor.execute("DELETE FROM hosted_canonical_timing_bridges");
    await source.executor.execute("ALTER TABLE hosted_canonical_timing_bridges ENABLE TRIGGER ALL");
    const snapshot = await exportMetadataSnapshot(source.executor);
    assert.equal(
      snapshot.tables.find(
        (table) => table.tableName === "hosted_serverless_qualification_attestations",
      )?.rowCount,
      2,
    );
    assert.equal(
      snapshot.tables.some((table) => table.tableName === "hosted_dispatch_token_vault"),
      false,
    );
    const serialized = serializeMetadataSnapshot(snapshot);
    await restoreMetadataSnapshot(destination.executor, serialized).catch((error) => {
      throw error.cause ?? error;
    });
    assert.equal(
      (
        await destination.executor.query(
          "SELECT count(*)::int count FROM hosted_serverless_qualification_attestations",
        )
      ).rows[0].count,
      2,
    );
    assert.equal(
      (
        await destination.executor.query(
          "SELECT count(*)::int count FROM hosted_dispatch_token_vault",
        )
      ).rows[0].count,
      0,
    );
  } finally {
    await source.database.close();
    await destination.database.close();
  }
});
