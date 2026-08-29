import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

import { expectDatabaseError, PGliteExecutor, sha256, uuid } from "./support/pglite.mjs";

async function sources() {
  const manifest = JSON.parse(
    await readFile(new URL("../migrations/manifest.json", import.meta.url), "utf8"),
  );
  return Promise.all(
    manifest.migrations.map(async (entry) => {
      const sql = await readFile(
        new URL(`../migrations/${entry.filename}`, import.meta.url),
        "utf8",
      );
      assert.equal(`sha256:${createHash("sha256").update(sql).digest("hex")}`, entry.sha256);
      return { ...entry, sql };
    }),
  );
}

async function applyRange(executor, migrations) {
  await executor.transaction(async (transaction) => {
    for (const migration of migrations) {
      await transaction.execute(migration.sql);
      await transaction.query(
        `INSERT INTO public.videoforge_schema_migrations(version,name,filename,sha256)
         VALUES($1,$2,$3,$4)`,
        [migration.version, migration.name, migration.filename, migration.sha256],
      );
    }
  });
}

async function authorityDocument(executor, suffix, ttlMs = 3_600_000) {
  const [{ now }] = (await executor.query("SELECT transaction_timestamp()::text now")).rows;
  return {
    schemaVersion: "videoforge-v2-13-full-live-authority/v1",
    authorityId: `authority-${suffix}`,
    proposalSha256: sha256(`proposal-${suffix}`),
    approvalSha256: sha256(`approval-${suffix}`),
    proposalCommit: "a".repeat(40),
    sourceCommit: "b".repeat(40),
    executorSha256: sha256(`executor-${suffix}`),
    staticReleaseDescriptorSha256: sha256(`descriptor-${suffix}`),
    phaseCapsUsd: {
      mage_qualification: 4.5,
      soulx_qualification: 1,
      v2_09_short_hosted_project: 2,
      v2_10_operator_free_ranga_pilot: 2,
      v2_11_two_concurrent_owned_projects: 4,
      v2_12_long_output: 2,
      v2_13_final_two_lane_smoke: 2,
    },
    maximumCumulativeSpendUsd: 17.5,
    retention: {
      region: "EU-RO-1",
      volumeCount: 2,
      volumeSizeGb: 50,
      monthlyUsd: 7,
      separatelyApproved: true,
    },
    singleUse: true,
    approvedAt: new Date(Date.parse(now) - 60_000).toISOString(),
    expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(),
  };
}

async function seedLane(executor, lane, deploymentId, qualificationId, serial) {
  const h = (label) => sha256(`${lane}-${label}-${serial}`);
  await executor.query(
    `INSERT INTO serverless_endpoint_deployments(id,lane,endpoint_profile_id,endpoint_id_sha256,
      endpoint_config_sha256,worker_image_digest,model_manifest_sha256,region,volume_id_sha256,
      volume_manifest_sha256,volume_mount,volume_size_gb,gpu_allowlist,gpu_count_per_worker,
      worker_count_min,worker_count_max,worker_ceiling_scope,retained_active_workers,scaler_type,
      scaler_value,handler_concurrency,idle_timeout_seconds,init_timeout_seconds,
      execution_timeout_seconds,request_ttl_seconds,request_ttl_scope,
      reconciliation_deadline_seconds,provider_result_window_seconds,polling_interval_seconds,
      max_replacement_attempts,blind_resubmit_permitted,timeout_evidence,deployment_version,
      is_active,record_sha256,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,'EU-RO-1',$8,$9,'/runpod-volume',50,
       ARRAY['NVIDIA GeForce RTX 4090']::text[],1,0,1,'ACTIVE_PLUS_FLEX',0,'REQUEST_COUNT',1,1,
       300,900,1800,3600,'PROVIDER_QUEUE_PLUS_EXECUTION_PLUS_OUTPUT_UPLOAD',1200,1800,5,0,false,
       $10::jsonb,1,true,$11,transaction_timestamp())`,
    [
      deploymentId,
      lane,
      `v213-${lane}`,
      h("endpoint"),
      h("config"),
      h("image"),
      h("model"),
      h("volume"),
      h("volume-manifest"),
      JSON.stringify({ provider_defaults_accepted: "false", sealed_lineage: { lane, serial } }),
      h("record"),
    ],
  );
  const [{ snapshot }] = (
    await executor.query("SELECT videoforge_hosted_deployment_snapshot_sha256($1::uuid) snapshot", [
      deploymentId,
    ])
  ).rows;
  await executor.query(
    `INSERT INTO hosted_serverless_qualification_attestations(id,lane,deployment_id,
       deployment_snapshot_sha256,qualification_record_sha256,independent_audit_accepted,
       verified_at,expires_at,created_by_operator,created_at)
     VALUES($1,$2,$3,$4,$5,true,transaction_timestamp()-interval '1 minute',
       transaction_timestamp()+interval '1 hour','test-operator',transaction_timestamp())`,
    [qualificationId, lane, deploymentId, snapshot, h("qualification")],
  );
  return {
    deploymentId,
    qualificationId,
    deploymentSnapshotSha256: snapshot,
    qualificationSha256: h("qualification"),
  };
}

async function jsonHash(executor, value) {
  const [{ hash }] = (
    await executor.query("SELECT videoforge_v213_jit_sha256($1::jsonb) hash", [
      JSON.stringify(value),
    ])
  ).rows;
  return hash;
}

test("retained 0045 upgrades through 0046 and replays old disabled/cleanup evidence", async () => {
  const database = new PGlite({ extensions: { pgcrypto } });
  try {
    await database.exec("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    const executor = new PGliteExecutor(database);
    const migrations = await sources();
    assert.equal(migrations.length, 49);
    await executor.execute(
      `CREATE TABLE public.videoforge_schema_migrations(
        version integer PRIMARY KEY,name text NOT NULL,filename text NOT NULL UNIQUE,
        sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    await applyRange(executor, migrations.slice(0, 45));
    assert.equal(
      (await executor.query("SELECT count(*)::int count FROM videoforge_schema_migrations")).rows[0]
        .count,
      45,
    );
    await applyRange(executor, migrations.slice(45, 46));
    assert.equal(
      (await executor.query("SELECT max(version)::int version FROM videoforge_schema_migrations"))
        .rows[0].version,
      46,
    );

    const fullLiveAuthorityId = uuid(46001);
    const authority = await authorityDocument(executor, "0046-promotion");
    const [recorded] = (
      await executor.query(
        "SELECT * FROM videoforge_record_hosted_full_live_authority($1,$2::jsonb)",
        [fullLiveAuthorityId, JSON.stringify(authority)],
      )
    ).rows;
    const mage = await seedLane(executor, "mage_image", uuid(46002), uuid(46003), 1);
    const soulx = await seedLane(executor, "soulx_avatar", uuid(46004), uuid(46005), 2);
    const [{ ledger }] = (
      await executor.query(`SELECT 'sha256:'||encode(sha256(convert_to(videoforge_canonical_jsonb(
        jsonb_agg(jsonb_build_object('version',version,'name',name,'filename',filename,'sha256',sha256)
        ORDER BY version)),'UTF8')),'hex') ledger FROM videoforge_schema_migrations`)
    ).rows;
    const promotionId = uuid(46006);
    const promotion = {
      authorityDocumentSha256: recorded.authority_document_sha256,
      sourceCommit: authority.sourceCommit,
      executorSha256: authority.executorSha256,
      migrationLedgerSha256: ledger,
      disabledConfigSha256: sha256("disabled-0046"),
      enabledConfigSha256: sha256("enabled-0046"),
      lanes: { mage_image: mage, soulx_avatar: soulx },
    };
    await executor.query("SELECT * FROM videoforge_promote_hosted_full_live($1,$2,$3::jsonb)", [
      promotionId,
      fullLiveAuthorityId,
      JSON.stringify(promotion),
    ]);

    const [{ oldObservedAt }] = (
      await executor.query(
        `SELECT to_char((transaction_timestamp()-interval '10 minutes') AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') "oldObservedAt"`,
      )
    ).rows;
    const closureId = uuid(46007);
    const closure = {
      schemaVersion: "videoforge.v213-disabled-promotion-closure/v1",
      promotionId,
      disabledVersionIdSha256: sha256("disabled-version-0046"),
      disabledConfigSha256: promotion.disabledConfigSha256,
      routeStatus: 503,
      routeVersionSha256: sha256("disabled-version-0046"),
      observedAt: oldObservedAt,
    };
    const closureSha256 = await jsonHash(executor, closure);
    await executor.query(
      `INSERT INTO hosted_full_live_disabled_promotion_closures(id,promotion_id,
        disabled_version_id_sha256,disabled_config_sha256,route_status,route_version_sha256,
        closure_document,closure_sha256,observed_at)
       VALUES($1,$2,$3,$4,503,$5,$6::jsonb,$7,$8::timestamptz)`,
      [
        closureId,
        promotionId,
        closure.disabledVersionIdSha256,
        closure.disabledConfigSha256,
        closure.routeVersionSha256,
        JSON.stringify(closure),
        closureSha256,
        closure.observedAt,
      ],
    );
    const [{ replay }] = (
      await executor.query(
        "SELECT videoforge_record_v213_disabled_promotion_closure($1,$2::jsonb) replay",
        [closureId, JSON.stringify(closure)],
      )
    ).rows;
    assert.equal(replay.rollbackSha256, closureSha256);
    await expectDatabaseError(
      executor.query(
        `INSERT INTO hosted_full_live_cloudflare_activations(id,promotion_id,source_commit,
          version_id_sha256,deployed_config_sha256,readback_document,readback_sha256,observed_at)
         VALUES($1,$2,$3,$4,$5,'{}'::jsonb,$6,transaction_timestamp())`,
        [
          uuid(46008),
          promotionId,
          authority.sourceCommit,
          sha256("late-activation-version"),
          promotion.enabledConfigSha256,
          sha256("late-activation-readback"),
        ],
      ),
      "23514",
    );

    const cleanupAuthorityId = uuid(46009);
    const cleanupAuthority = await authorityDocument(executor, "expired-cleanup", 150);
    await executor.query(
      "SELECT * FROM videoforge_record_hosted_full_live_authority($1,$2::jsonb)",
      [cleanupAuthorityId, JSON.stringify(cleanupAuthority)],
    );
    await new Promise((resolve) => setTimeout(resolve, 220));
    const summary = { allResourcesAbsent: true, promotions: 0, activations: 0 };
    const providerCleanupEvidenceSha256 = await jsonHash(executor, summary);
    const document = {
      schemaVersion: "videoforge.v213-current-run-cleanup-receipt/v1",
      fullLiveAuthorityId: cleanupAuthorityId,
      operationId: "reconcile-exact-resources",
      outerStateSha256: sha256("expired-cleanup-outer"),
      providerCleanupEvidenceSha256,
      summary,
    };
    const receiptArtifactSha256 = await jsonHash(executor, document);
    const intent = {
      fullLiveAuthorityId: cleanupAuthorityId,
      operationId: document.operationId,
      outerStateSha256: document.outerStateSha256,
      providerCleanupEvidenceSha256,
      receiptArtifactSha256,
      document,
    };
    const [{ claimed }] = (
      await executor.query(
        "SELECT videoforge_claim_v213_cleanup_receipt_intent($1::jsonb) claimed",
        [JSON.stringify(intent)],
      )
    ).rows;
    assert.equal(claimed.intentState, "NO_ATTEMPT");
    await executor.query(
      `INSERT INTO hosted_provider_proof_keys(key_id,secret_hex,active)
       VALUES('v213-cleanup-test-key',$1,true) ON CONFLICT(key_id) DO NOTHING`,
      ["1".repeat(64)],
    );
    await executor.query(
      `INSERT INTO hosted_full_live_signed_evidence(
        artifact_sha256,kind,document,key_id,signature_hex)
       VALUES($1,'RELEASE',$2::jsonb,'v213-cleanup-test-key',$3)`,
      [receiptArtifactSha256, JSON.stringify(document), "2".repeat(64)],
    );
    const [{ receipt }] = (
      await executor.query("SELECT videoforge_record_v213_operation_receipt($1::jsonb) receipt", [
        JSON.stringify({
          fullLiveAuthorityId: cleanupAuthorityId,
          operationId: document.operationId,
          artifactSha256: receiptArtifactSha256,
          document,
        }),
      ])
    ).rows;
    assert.equal(receipt, receiptArtifactSha256);
    assert.equal(
      (
        await executor.query(
          "SELECT count(*)::int count FROM hosted_full_live_promotions WHERE authority_id=$1",
          [cleanupAuthorityId],
        )
      ).rows[0].count,
      0,
    );
  } finally {
    await database.close();
  }
});

test("0046 keeps cleanup bridge and receipt identity across restart for every safety operation", async () => {
  const database = new PGlite({ extensions: { pgcrypto } });
  try {
    await database.exec("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    const executor = new PGliteExecutor(database);
    const migrations = await sources();
    await executor.execute(
      `CREATE TABLE public.videoforge_schema_migrations(
        version integer PRIMARY KEY,name text NOT NULL,filename text NOT NULL UNIQUE,
        sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    await applyRange(executor, migrations);

    const fullLiveAuthorityId = uuid(46020);
    const authority = await authorityDocument(executor, "cleanup-restart");
    await executor.query(
      "SELECT * FROM videoforge_record_hosted_full_live_authority($1::uuid,$2::jsonb)",
      [fullLiveAuthorityId, JSON.stringify(authority)],
    );
    const operations = [
      ["restore-endpoints-max-one", "cancel"],
      ["prove-zero-workers", "status"],
      ["read-settled-billing", "readback"],
      ["reconcile-exact-resources", "status"],
    ];
    for (const [operationId, kind] of operations) {
      const commandId = `v213:${fullLiveAuthorityId}:${operationId}`;
      const logicalRequestSha256 = sha256(`cleanup-logical-${operationId}`);
      const initialOuterStateSha256 = sha256(`cleanup-outer-initial-${operationId}`);
      const resourceKey = `v213:${operationId}:${commandId}`;
      const initial = (
        await executor.query(
          "SELECT videoforge_claim_v213_cleanup_bridge_command($1::jsonb) claim",
          [
            JSON.stringify({
              operationId: commandId,
              stageAuthorityId: fullLiveAuthorityId,
              kind,
              requestSha256: logicalRequestSha256,
              resourceKey,
              outerStateSha256: initialOuterStateSha256,
              readbackOnly: false,
            }),
          ],
        )
      ).rows[0].claim;
      assert.deepEqual(initial, {
        action: "EXECUTE",
        bridgeRowPresent: true,
        identityRecorded: true,
        identitySha256: initial.identitySha256,
        originalOuterStateSha256: initialOuterStateSha256,
        requestSha256: logicalRequestSha256,
      });
      await executor.query("SELECT videoforge_transition_v213_bridge_command($1::jsonb)", [
        JSON.stringify({ operationId: commandId, to: "ACK_UNKNOWN" }),
      ]);
      const restarted = (
        await executor.query(
          "SELECT videoforge_claim_v213_cleanup_bridge_command($1::jsonb) claim",
          [
            JSON.stringify({
              operationId: commandId,
              stageAuthorityId: fullLiveAuthorityId,
              kind,
              requestSha256: logicalRequestSha256,
              resourceKey,
              outerStateSha256: sha256(`cleanup-outer-restart-${operationId}`),
              readbackOnly: true,
            }),
          ],
        )
      ).rows[0].claim;
      assert.deepEqual(restarted, {
        action: "RECONCILE",
        bridgeRowPresent: true,
        identityRecorded: true,
        identitySha256: initial.identitySha256,
        originalOuterStateSha256: initialOuterStateSha256,
        requestSha256: logicalRequestSha256,
      });
    }
    assert.equal(
      (
        await executor.query(
          "SELECT count(*)::int count FROM hosted_full_live_cleanup_command_identities WHERE full_live_authority_id=$1",
          [fullLiveAuthorityId],
        )
      ).rows[0].count,
      4,
    );
    assert.equal(
      (
        await executor.query(
          "SELECT count(*)::int count FROM hosted_full_live_bridge_command_events WHERE full_live_authority_id=$1",
          [fullLiveAuthorityId],
        )
      ).rows[0].count,
      8,
    );

    const noBridgeCommandId = `v213:${fullLiveAuthorityId}:no-bridge-recovery`;
    const noBridge = (
      await executor.query("SELECT videoforge_claim_v213_cleanup_bridge_command($1::jsonb) claim", [
        JSON.stringify({
          operationId: noBridgeCommandId,
          stageAuthorityId: fullLiveAuthorityId,
          kind: "status",
          requestSha256: sha256("no-bridge-logical"),
          resourceKey: `v213:reconcile-exact-resources:${noBridgeCommandId}`,
          outerStateSha256: sha256("no-bridge-outer"),
          readbackOnly: true,
        }),
      ])
    ).rows[0].claim;
    assert.deepEqual(noBridge, {
      action: "RECONCILE",
      bridgeRowPresent: false,
      identityRecorded: false,
    });
    assert.equal(
      (
        await executor.query(
          "SELECT count(*)::int count FROM hosted_full_live_bridge_command_events WHERE operation_id=$1",
          [noBridgeCommandId],
        )
      ).rows[0].count,
      0,
    );

    const receiptOperation = "reconcile-exact-resources";
    const summary = { operationId: receiptOperation, readback: "stable" };
    const evidenceSha256 = await jsonHash(executor, summary);
    const initialOuterStateSha256 = sha256("cleanup-outer-initial-reconcile-exact-resources");
    const initialDocument = {
      schemaVersion: "videoforge.v213-current-run-cleanup-receipt/v1",
      fullLiveAuthorityId,
      operationId: receiptOperation,
      outerStateSha256: initialOuterStateSha256,
      providerCleanupEvidenceSha256: evidenceSha256,
      summary,
    };
    const initialReceipt = (
      await executor.query("SELECT videoforge_claim_v213_cleanup_receipt_intent($1::jsonb) claim", [
        JSON.stringify({
          fullLiveAuthorityId,
          operationId: receiptOperation,
          outerStateSha256: initialOuterStateSha256,
          providerCleanupEvidenceSha256: evidenceSha256,
          receiptArtifactSha256: await jsonHash(executor, initialDocument),
          document: initialDocument,
        }),
      ])
    ).rows[0].claim;
    assert.equal(initialReceipt.intentState, "NO_ATTEMPT");
    const restartSummary = {
      operationId: receiptOperation,
      readback: "restart",
      observedAt: "2026-08-29T00:00:01.000Z",
    };
    const restartEvidenceSha256 = await jsonHash(executor, restartSummary);
    const restartDocument = {
      ...initialDocument,
      outerStateSha256: sha256("cleanup-outer-restart-reconcile-exact-resources"),
      providerCleanupEvidenceSha256: restartEvidenceSha256,
      summary: restartSummary,
    };
    const restartArtifactSha256 = await jsonHash(executor, restartDocument);
    const restartedReceipt = (
      await executor.query("SELECT videoforge_claim_v213_cleanup_receipt_intent($1::jsonb) claim", [
        JSON.stringify({
          fullLiveAuthorityId,
          operationId: receiptOperation,
          outerStateSha256: restartDocument.outerStateSha256,
          providerCleanupEvidenceSha256: restartEvidenceSha256,
          receiptArtifactSha256: restartArtifactSha256,
          document: restartDocument,
        }),
      ])
    ).rows[0].claim;
    assert.equal(restartedReceipt.intentState, "ACK_UNKNOWN");
    assert.equal(restartedReceipt.outerStateSha256, initialOuterStateSha256);
    assert.equal(restartedReceipt.providerCleanupEvidenceSha256, evidenceSha256);
    assert.deepEqual(restartedReceipt.receiptDocument, initialDocument);
    assert.equal(restartedReceipt.receiptArtifactSha256, initialReceipt.receiptArtifactSha256);
    assert.equal(
      (
        await executor.query(
          `SELECT count(*)::int count FROM hosted_full_live_cleanup_receipt_intents
           WHERE full_live_authority_id=$1 AND operation_id=$2`,
          [fullLiveAuthorityId, receiptOperation],
        )
      ).rows[0].count,
      1,
    );
  } finally {
    await database.close();
  }
});
