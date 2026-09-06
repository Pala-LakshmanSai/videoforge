import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const unassignedSql = await readFile(
  new URL("../../../deploy/v2-09/neon-reconcile-v209-unassigned-attempts.sql", import.meta.url),
  "utf8",
);
const terminalSql = await readFile(
  new URL("../../../deploy/v2-09/neon-settle-v209-terminal-pair.sql", import.meta.url),
  "utf8",
);
const ids = {
  account: "00000000-0000-4000-8000-000000000001",
  workspace: "00000000-0000-4000-8000-000000000002",
  request: "00000000-0000-4000-8000-000000000003",
  runtime: "00000000-0000-4000-8000-000000000004",
  lease: "00000000-0000-4000-8000-000000000005",
  mageAttempt: "00000000-0000-4000-8000-000000000006",
  soulxAttempt: "00000000-0000-4000-8000-000000000007",
  mageDeployment: "00000000-0000-4000-8000-000000000008",
  soulxDeployment: "00000000-0000-4000-8000-000000000009",
  mageTask: "00000000-0000-4000-8000-000000000010",
  soulxTask: "00000000-0000-4000-8000-000000000011",
  mageLane: "00000000-0000-4000-8000-000000000012",
  soulxLane: "00000000-0000-4000-8000-000000000013",
  mageLedger: "00000000-0000-4000-8000-000000000014",
  soulxLedger: "00000000-0000-4000-8000-000000000015",
};

function executable(sql, payload) {
  const base64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  return sql
    .replace(/^\\set ON_ERROR_STOP on\n/u, "")
    .replaceAll(":'payload_base64'", `'${base64}'`);
}

async function fixture() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE FUNCTION videoforge_canonical_jsonb(value jsonb) RETURNS text
      LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT value::text $$;
    CREATE TABLE generation_requests(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,state text,
      terminal_at timestamptz,version int,updated_at timestamptz);
    CREATE TABLE video_runtime_states(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,
      generation_request_id uuid,stage text,terminal_reason text,terminal_at timestamptz,version int,updated_at timestamptz);
    CREATE TABLE hosted_pair_runtime_states(generation_request_id uuid PRIMARY KEY,account_id uuid,
      workspace_id uuid,phase text,cleanup_reason text,created_at timestamptz,updated_at timestamptz,version int DEFAULT 1);
    CREATE TABLE provider_workload_leases(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,
      generation_request_id uuid,state text,released_at timestamptz,release_reason text,version int,
      heartbeat_at timestamptz,expires_at timestamptz);
    CREATE TABLE serverless_attempts(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,
      project_revision_id uuid,generation_request_id uuid,task_id uuid,deployment_id uuid,lane text,
      state text,dispatch_token_sha256 text,terminal_at timestamptz,version int,updated_at timestamptz,
      created_at timestamptz);
    CREATE TABLE serverless_dispatch_outbox(attempt_id uuid PRIMARY KEY,state text,send_attempt_count int,
      lease_id uuid,lease_holder_sha256 text,leased_at timestamptz,lease_expires_at timestamptz,
      version int,updated_at timestamptz);
    CREATE TABLE serverless_provider_assignments(id uuid PRIMARY KEY,attempt_id uuid,is_current boolean,
      provider_job_id text);
    CREATE TABLE serverless_cost_ledgers(id uuid PRIMARY KEY,attempt_id uuid,reported_usd numeric DEFAULT 0,
      possible_duplicate_usd numeric DEFAULT 0,settled_usd numeric DEFAULT 0,refunded_usd numeric DEFAULT 0,
      ceiling_usd numeric DEFAULT 1,version int,updated_at timestamptz);
    CREATE TABLE serverless_cost_events(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,
      project_revision_id uuid,attempt_id uuid,ledger_id uuid,sequence int,kind text,amount_usd numeric,
      rate_source text,rate_checked_at timestamptz,confidence text,recorded_at timestamptz);
    CREATE TABLE video_runtime_lane_states(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,
      runtime_id uuid,lane text,state text,current_attempt_id uuid,version int,updated_at timestamptz);
    CREATE TABLE generation_tasks(id uuid PRIMARY KEY,state text,finished_at timestamptz,version int,updated_at timestamptz);
    CREATE TABLE serverless_predispatch_authorities(attempt_id uuid PRIMARY KEY,rate_source text,
      rate_checked_at timestamptz,endpoint_id_sha256 text);
    CREATE TABLE hosted_v209_short_admissions(generation_request_id uuid PRIMARY KEY,account_id uuid,
      workspace_id uuid,admission_sha256 text,billing_baseline_micro_usd bigint,phase_cap_micro_usd bigint);
    CREATE TABLE hosted_pair_cleanup_observations(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,
      generation_request_id uuid,attempt_id uuid,lane text,deployment_id uuid,dispatch_token_sha256 text,
      provider_job_id text,provider_state text,provider_proof_sha256 text,observed_at timestamptz,
      created_at timestamptz,UNIQUE(attempt_id,provider_proof_sha256));
  `);
  const now = new Date().toISOString();
  await db.query(`INSERT INTO generation_requests VALUES($1,$2,$3,'ACTIVE',NULL,1,$4)`, [
    ids.request,
    ids.account,
    ids.workspace,
    now,
  ]);
  await db.query(
    `INSERT INTO video_runtime_states VALUES($1,$2,$3,$4,'WAITING_FOR_WORKER',NULL,NULL,1,$5)`,
    [ids.runtime, ids.account, ids.workspace, ids.request, now],
  );
  await db.query(
    `INSERT INTO provider_workload_leases VALUES($1,$2,$3,$4,'ACTIVE',NULL,NULL,1,$5,$5::timestamptz+interval '1 hour')`,
    [ids.lease, ids.account, ids.workspace, ids.request, now],
  );
  for (const row of [
    [ids.mageAttempt, ids.mageTask, ids.mageDeployment, "mage_image", ids.mageLane, ids.mageLedger],
    [
      ids.soulxAttempt,
      ids.soulxTask,
      ids.soulxDeployment,
      "soulx_avatar",
      ids.soulxLane,
      ids.soulxLedger,
    ],
  ]) {
    await db.query(`INSERT INTO generation_tasks VALUES($1,'READY',NULL,1,$2)`, [row[1], now]);
    await db.query(
      `INSERT INTO serverless_attempts VALUES($1,$2,$3,$3,$4,$5,$6,$7,'OUTBOXED',$8,NULL,1,$9,$9)`,
      [
        row[0],
        ids.account,
        ids.workspace,
        ids.request,
        row[1],
        row[2],
        row[3],
        `sha256:${row[0].replaceAll("-", "").padEnd(64, "0")}`,
        now,
      ],
    );
    await db.query(
      `INSERT INTO serverless_dispatch_outbox VALUES($1,'READY_TO_DISPATCH',0,NULL,NULL,NULL,NULL,1,$2)`,
      [row[0], now],
    );
    await db.query(`INSERT INTO serverless_cost_ledgers VALUES($1,$2,0,0,0,0,1,1,$3)`, [
      row[5],
      row[0],
      now,
    ]);
    await db.query(
      `INSERT INTO serverless_cost_events VALUES(gen_random_uuid(),$1,$2,$2,$3,$4,1,'RESERVATION',0.744,'fixture',$5,'ESTIMATED',$5)`,
      [ids.account, ids.workspace, row[0], row[5], now],
    );
    await db.query(
      `INSERT INTO video_runtime_lane_states VALUES($1,$2,$3,$4,$5,'WAITING_FOR_WORKER',$6,1,$7)`,
      [row[4], ids.account, ids.workspace, ids.runtime, row[3], row[0], now],
    );
  }
  return { db, now };
}

test("unassigned cleanup atomically closes the exact pair at zero cost and replays", async () => {
  const { db, now } = await fixture();
  const payload = {
    schemaVersion: "videoforge.v2-09-reconcile-unassigned-attempts/v1",
    accountId: ids.account,
    workspaceId: ids.workspace,
    generationRequestId: ids.request,
    issuedAt: new Date(Date.parse(now) - 1000).toISOString(),
    deploymentIds: [ids.mageDeployment, ids.soulxDeployment].sort(),
  };
  try {
    const first = await db.exec(executable(unassignedSql, payload));
    assert.equal(
      first.findLast(({ rows }) => rows.length > 0).rows[0].document.reconciledPairCount,
      1,
    );
    assert.equal(
      first.findLast(({ rows }) => rows.length > 0).rows[0].document.zeroCostSettlementCount,
      2,
    );
    const replay = await db.exec(executable(unassignedSql, payload));
    assert.equal(
      replay.findLast(({ rows }) => rows.length > 0).rows[0].document.pairPhase,
      "SETTLED",
    );
    const state = await db.query(`SELECT
      (SELECT count(*)::int FROM serverless_attempts WHERE state='CANCELLED') attempts,
      (SELECT count(*)::int FROM serverless_cost_events WHERE kind='SETTLED' AND amount_usd=0) settlements,
      (SELECT count(*)::int FROM provider_workload_leases WHERE state='ACTIVE') active_leases`);
    assert.deepEqual(state.rows[0], { attempts: 2, settlements: 2, active_leases: 0 });
  } finally {
    await db.close();
  }
});

async function proof(db, value) {
  const result = await db.query(
    `SELECT 'sha256:'||encode(sha256(convert_to(videoforge_canonical_jsonb($1::jsonb),'UTF8')),'hex') value`,
    [JSON.stringify(value)],
  );
  return result.rows[0].value;
}

test("mixed assigned and never-sent pair settles actual sealed-rate cost and replays", async () => {
  const { db, now } = await fixture();
  const hash = (character) => `sha256:${character.repeat(64)}`;
  const rateCheckedAt = new Date(Date.parse(now) - 90_000).toISOString();
  const terminalAt = new Date(Date.parse(now) - 60_000).toISOString();
  const zeroAt = new Date(Date.parse(now) - 30_000).toISOString();
  const billingAt = new Date(Date.parse(now) - 10_000).toISOString();
  try {
    await db.query(
      `INSERT INTO hosted_pair_runtime_states VALUES($1,$2,$3,'MAGE_ASSIGNED',NULL,$4,$4,1)`,
      [ids.request, ids.account, ids.workspace, now],
    );
    await db.query(`UPDATE serverless_attempts SET state='ASSIGNED' WHERE id=$1`, [
      ids.mageAttempt,
    ]);
    await db.query(
      `UPDATE serverless_dispatch_outbox SET state='ASSIGNED',send_attempt_count=1 WHERE attempt_id=$1`,
      [ids.mageAttempt],
    );
    await db.query(`INSERT INTO serverless_provider_assignments VALUES($1,$2,true,'mage-job-1')`, [
      "00000000-0000-4000-8000-000000000016",
      ids.mageAttempt,
    ]);
    for (const [attemptId, endpointHash] of [
      [ids.mageAttempt, hash("a")],
      [ids.soulxAttempt, hash("b")],
    ])
      await db.query(`INSERT INTO serverless_predispatch_authorities VALUES($1,$2,$3,$4)`, [
        attemptId,
        "V2-09_APPROVED_MAX_USD_1.116_GPU_HOUR",
        rateCheckedAt,
        endpointHash,
      ]);
    await db.query(`INSERT INTO hosted_v209_short_admissions VALUES($1,$2,$3,$4,1000000,2000000)`, [
      ids.request,
      ids.account,
      ids.workspace,
      hash("c"),
    ]);
    const terminalBase = {
      costBasis: "exact_execution",
      executionTimeMs: 1000,
      lane: "mage_image",
      observedAt: terminalAt,
      providerJobId: "mage-job-1",
      providerState: "FAILED",
      rateCheckedAt,
      rateSource: "V2-09_APPROVED_MAX_USD_1.116_GPU_HOUR",
      settledCostUsd: 0.00031,
    };
    const terminalFact = { ...terminalBase, proofSha256: await proof(db, terminalBase) };
    const zeroWorkerFacts = [];
    for (const [lane, endpointIdSha256] of [
      ["mage_image", hash("a")],
      ["soulx_avatar", hash("b")],
    ]) {
      const base = { endpointIdSha256, lane, observedAt: zeroAt, queuedJobs: 0, workersTotal: 0 };
      zeroWorkerFacts.push({ ...base, proofSha256: await proof(db, base) });
    }
    const payload = {
      accountId: ids.account,
      costGuard: {
        finalCumulativeEndpointBillingMicroUsd: 1000310,
        providerObservedAt: billingAt,
        schemaVersion: "videoforge-v2-09-settlement-cost-guard/v1",
      },
      generationRequestId: ids.request,
      schemaVersion: "videoforge.v2-09-terminal-pair-settlement/v1",
      terminalFacts: [terminalFact],
      workspaceId: ids.workspace,
      zeroWorkerFacts,
    };
    for (const nullBase of [{ ...terminalBase, settledCostUsd: null }]) {
      const nullPayload = {
        ...payload,
        terminalFacts: [{ ...nullBase, proofSha256: await proof(db, nullBase) }],
      };
      await assert.rejects(
        db.exec(executable(terminalSql, nullPayload)),
        /assigned terminal fact binding invalid/u,
      );
      await db.exec("ROLLBACK");
    }
    const first = await db.exec(executable(terminalSql, payload));
    const firstReceipt = first.findLast(({ rows }) => rows.length > 0).rows[0].document;
    assert.equal(firstReceipt.exactPairTerminalCount, 2);
    assert.equal(firstReceipt.zeroCostSettlementCount, 1);
    assert.equal(firstReceipt.nonzeroCostSettlementCount, 1);
    assert.equal(Number(firstReceipt.totalSettledCostUsd), 0.00031);
    const durable = await db.query(`SELECT c.provider_state,c.provider_proof_sha256,
      e.amount_usd,e.rate_source,e.confidence FROM hosted_pair_cleanup_observations c
      JOIN serverless_cost_events e ON e.attempt_id=c.attempt_id AND e.kind='PROVIDER_REPORT'`);
    assert.deepEqual(durable.rows[0], {
      provider_state: "FAILED",
      provider_proof_sha256: terminalFact.proofSha256,
      amount_usd: "0.00031",
      rate_source:
        "V2-09_APPROVED_MAX_USD_1.116_GPU_HOUR;costBasis=exact_execution;executionTimeMs=1000",
      confidence: "PROVIDER_REPORTED",
    });
    const replay = await db.exec(executable(terminalSql, payload));
    const replayReceipt = replay.findLast(({ rows }) => rows.length > 0).rows[0].document;
    assert.deepEqual(
      {
        active: replayReceipt.activeLeaseCount,
        pair: replayReceipt.pairPhase,
        settlements: replayReceipt.settledEventCount,
      },
      { active: 0, pair: "SETTLED", settlements: 2 },
    );
  } finally {
    await db.close();
  }
});

test("missing provider execution time settles the persisted reservation ceiling and replays", async () => {
  const { db, now } = await fixture();
  const hash = (character) => `sha256:${character.repeat(64)}`;
  const rateCheckedAt = new Date(Date.parse(now) - 90_000).toISOString();
  const terminalAt = new Date(Date.parse(now) - 60_000).toISOString();
  const zeroAt = new Date(Date.parse(now) - 30_000).toISOString();
  const billingAt = new Date(Date.parse(now) - 10_000).toISOString();
  try {
    await db.query(
      `INSERT INTO hosted_pair_runtime_states VALUES($1,$2,$3,'MAGE_ASSIGNED',NULL,$4,$4,1)`,
      [ids.request, ids.account, ids.workspace, now],
    );
    await db.query(`UPDATE serverless_attempts SET state='ASSIGNED' WHERE id=$1`, [
      ids.mageAttempt,
    ]);
    await db.query(
      `UPDATE serverless_dispatch_outbox SET state='ASSIGNED',send_attempt_count=1 WHERE attempt_id=$1`,
      [ids.mageAttempt],
    );
    await db.query(`INSERT INTO serverless_provider_assignments VALUES($1,$2,true,'mage-job-1')`, [
      "00000000-0000-4000-8000-000000000016",
      ids.mageAttempt,
    ]);
    for (const [attemptId, endpointHash] of [
      [ids.mageAttempt, hash("a")],
      [ids.soulxAttempt, hash("b")],
    ])
      await db.query(`INSERT INTO serverless_predispatch_authorities VALUES($1,$2,$3,$4)`, [
        attemptId,
        "V2-09_APPROVED_MAX_USD_1.116_GPU_HOUR",
        rateCheckedAt,
        endpointHash,
      ]);
    await db.query(`INSERT INTO hosted_v209_short_admissions VALUES($1,$2,$3,$4,1000000,2000000)`, [
      ids.request,
      ids.account,
      ids.workspace,
      hash("c"),
    ]);
    const terminalBase = {
      costBasis: "conservative_reservation",
      executionTimeMs: null,
      lane: "mage_image",
      observedAt: terminalAt,
      providerJobId: "mage-job-1",
      providerState: "FAILED",
      rateCheckedAt,
      rateSource: "V2-09_APPROVED_MAX_USD_1.116_GPU_HOUR",
      settledCostUsd: 1,
    };
    const terminalFact = { ...terminalBase, proofSha256: await proof(db, terminalBase) };
    const zeroWorkerFacts = [];
    for (const [lane, endpointIdSha256] of [
      ["mage_image", hash("a")],
      ["soulx_avatar", hash("b")],
    ]) {
      const base = { endpointIdSha256, lane, observedAt: zeroAt, queuedJobs: 0, workersTotal: 0 };
      zeroWorkerFacts.push({ ...base, proofSha256: await proof(db, base) });
    }
    const payload = {
      accountId: ids.account,
      costGuard: {
        finalCumulativeEndpointBillingMicroUsd: 1_000_000,
        providerObservedAt: billingAt,
        schemaVersion: "videoforge-v2-09-settlement-cost-guard/v1",
      },
      generationRequestId: ids.request,
      schemaVersion: "videoforge.v2-09-terminal-pair-settlement/v1",
      terminalFacts: [terminalFact],
      workspaceId: ids.workspace,
      zeroWorkerFacts,
    };
    const first = await db.exec(executable(terminalSql, payload));
    const receipt = first.findLast(({ rows }) => rows.length > 0).rows[0].document;
    assert.equal(Number(receipt.totalSettledCostUsd), 1);
    assert.equal(Number(receipt.exactItemizedCostUsd), 0);
    assert.equal(Number(receipt.conservativeLiabilityUsd), 1);
    assert.equal(receipt.providerTerminalEvidenceCount, 1);
    const durable = await db.query(`SELECT c.provider_state,c.provider_proof_sha256,
      e.amount_usd,e.rate_source,e.confidence FROM hosted_pair_cleanup_observations c
      JOIN serverless_cost_events e ON e.attempt_id=c.attempt_id AND e.kind='PROVIDER_REPORT'`);
    assert.deepEqual(durable.rows[0], {
      provider_state: "FAILED",
      provider_proof_sha256: terminalFact.proofSha256,
      amount_usd: "1",
      rate_source:
        "V2-09_APPROVED_MAX_USD_1.116_GPU_HOUR;costBasis=conservative_reservation;executionTimeMs=null",
      confidence: "ESTIMATED",
    });
    const replay = await db.exec(executable(terminalSql, payload));
    assert.equal(
      replay.findLast(({ rows }) => rows.length > 0).rows[0].document.providerTerminalEvidenceCount,
      1,
    );
  } finally {
    await db.close();
  }
});

test("assigned and mixed settlement SQL cross-binds terminal jobs, zero workers, cost, and parent closure", () => {
  for (const expression of [
    /assignment_count<>fact_count/u,
    /attempt\.outbox_state<>'ASSIGNED'/u,
    /missing lane is not proven never-sent/u,
    /provider_job_id=fact->>'providerJobId'/u,
    /cost_basis='conservative_reservation'/u,
    /jsonb_typeof\(fact->'settledCostUsd'\)<>'number'/u,
    /settled_cost<>attempt\.ceiling_usd/u,
    /hosted_pair_cleanup_observations/u,
    /final_billing<admission\.billing_baseline_micro_usd\+round\(exact_cost\*1000000\)/u,
    /round\(conservative_liability\*1000000\).*admission\.phase_cap_micro_usd/u,
    /'conservativeLiabilityUsd',\(SELECT coalesce\(sum\(e\.amount_usd\),0\)/u,
    /zero_fact->>'proofSha256'<>/u,
    /p\.endpoint_id_sha256=zero_fact->>'endpointIdSha256'/u,
    /terminal_count\+zero_count<1/u,
    /kind='SETTLED'/u,
    /release_reason='V209_TERMINAL_PAIR_FAILURE'/u,
    /'exactPairTerminalCount',\(SELECT count\(\*\)/u,
    /'activeLeaseCount',\(SELECT count\(\*\)/u,
    /'zeroWorkerProofCount',jsonb_array_length\(zeros\)/u,
    /'zeroCostSettlementCount',\(SELECT count\(\*\) FROM public\.serverless_cost_events e[\s\S]*e\.amount_usd=0\)/u,
    /'nonzeroCostSettlementCount',\(SELECT count\(\*\) FROM public\.serverless_cost_events e[\s\S]*e\.amount_usd<>0\)/u,
  ])
    assert.match(terminalSql, expression);
  assert.doesNotMatch(terminalSql, /serverless_run\b/u);
  assert.doesNotMatch(terminalSql, /\bredispatch\b|DELETE FROM/u);
});
