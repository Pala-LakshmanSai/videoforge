import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash, createHmac } from "node:crypto";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrationSliceThrough, loadMigrationSources, PGliteExecutor } from "./support/pglite.mjs";

const canonical = (value) =>
  JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
const hash = (value) => "sha256:" + createHash("sha256").update(value).digest("hex");
const secret = "ab".repeat(32);
const sign = (body) => {
  const bytes = canonical(body);
  const signature = createHmac("sha256", Buffer.from(secret, "hex")).update(bytes).digest("hex");
  return {
    ...body,
    proof_sha256: hash(bytes),
    signature_key_id: "proof-key-v1",
    signature_value: signature,
    signature_sha256: hash(signature),
  };
};

test("140 preserves legacy zero and verifies signed standby zero without accepting live compute", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  try {
    const sources = await loadMigrationSources();
    await applyMigrationSliceThrough(new PGliteExecutor(db), 139, sources);
    await db.exec("BEGIN");
    const original = (
      await db.query(
        "SELECT pg_get_functiondef('videoforge_record_hosted_pair_zero_worker(uuid,uuid,uuid,jsonb)'::regprocedure) AS body",
      )
    ).rows[0].body;
    await db.exec(
      await readFile(
        new URL("../migrations/0140_hosted_standby_zero_evidence.sql", import.meta.url),
        "utf8",
      ),
    );
    // Execute the actual verifier against minimal isolated relation fixtures, including its HMAC checks.
    let body = (
      await db.query(
        "SELECT pg_get_functiondef('videoforge_record_hosted_pair_zero_worker(uuid,uuid,uuid,jsonb)'::regprocedure) AS body",
      )
    ).rows[0].body;
    await db.exec(`CREATE TEMP TABLE zero_keys(key_id text,secret_hex text,active boolean);
      INSERT INTO zero_keys VALUES('proof-key-v1','${secret}',true);
      CREATE TEMP TABLE zero_attempts(id uuid,account_id uuid,workspace_id uuid,generation_request_id uuid,lane text);
      CREATE TEMP TABLE zero_authorities(attempt_id uuid,endpoint_id_sha256 text);
      CREATE TEMP TABLE zero_observations (LIKE public.hosted_pair_zero_worker_observations INCLUDING CONSTRAINTS INCLUDING INDEXES);`);
    for (const [from, to] of Object.entries({
      hosted_provider_proof_keys: "zero_keys",
      serverless_attempts: "zero_attempts",
      serverless_predispatch_authorities: "zero_authorities",
      hosted_pair_zero_worker_observations: "zero_observations",
    }))
      body = body.replaceAll("public." + from, "pg_temp." + to);
    body = body.replace("public.videoforge_record_hosted_pair_zero_worker", "pg_temp.verify_zero");
    await db.exec(body);
    const account = "11111111-1111-4111-8111-111111111111",
      workspace = "22222222-2222-4222-8222-222222222222",
      request = "33333333-3333-4333-8333-333333333333";
    await db.query("SELECT set_config('videoforge.account_id',$1,true)", [account]);
    for (const [index, lane] of ["mage_image", "soulx_avatar"].entries()) {
      const id = `44444444-4444-4444-8444-44444444444${index}`;
      await db.query("INSERT INTO zero_attempts VALUES($1,$2,$3,$4,$5)", [
        id,
        account,
        workspace,
        request,
        lane,
      ]);
      await db.query("INSERT INTO zero_authorities VALUES($1,$2)", [id, hash(lane)]);
    }
    const now = (await db.query("SELECT transaction_timestamp() AS now")).rows[0].now;
    const make = (lane, extra = {}) => ({
      schema_version: "videoforge-hosted-zero-worker-proof/v2",
      account_id: account,
      workspace_id: workspace,
      generation_request_id: request,
      lane,
      endpoint_id_sha256: hash(lane),
      workers_total: 2,
      queued_jobs: 0,
      observed_at: new Date(now).toISOString(),
      inventory_zero_confirmed: true,
      billable_workers: 0,
      running_workers: 0,
      initializing_workers: 0,
      throttled_workers: 0,
      unhealthy_workers: 0,
      pending_jobs: 0,
      ...extra,
    });
    const invoke = async (extra = {}, tamper = false) => {
      const proofs = ["mage_image", "soulx_avatar"].map((lane) => sign(make(lane, extra)));
      if (tamper) proofs[0].workers_total = 3;
      return db.query("SELECT pg_temp.verify_zero($1,$2,$3,$4::jsonb)", [
        account,
        workspace,
        request,
        JSON.stringify(proofs),
      ]);
    };
    for (const extra of [
      { billable_workers: 1 },
      { pending_jobs: 1 },
      { running_workers: 1 },
      { initializing_workers: 1 },
      { throttled_workers: 1 },
      { unhealthy_workers: 1 },
      { inventory_zero_confirmed: false },
      { queued_jobs: 1 },
      { schema_version: "videoforge-hosted-zero-worker-proof/v1" },
      { billable_workers: null },
    ]) {
      await db.exec("SAVEPOINT rejected");
      await assert.rejects(invoke(extra), /zero evidence binding invalid/);
      await db.exec("ROLLBACK TO SAVEPOINT rejected");
    }
    await db.exec("SAVEPOINT tampered");
    await assert.rejects(invoke({}, true), /zero evidence binding invalid/);
    await db.exec("ROLLBACK TO SAVEPOINT tampered");
    await invoke();
    assert.deepEqual(
      (await db.query("SELECT workers_total FROM zero_observations ORDER BY lane")).rows.map(
        (r) => r.workers_total,
      ),
      [2, 2],
    );
    await db.exec("TRUNCATE zero_observations");
    await invoke({ schema_version: "videoforge-hosted-zero-worker-proof/v1", workers_total: 0 });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM zero_observations")).rows[0].n, 2);
    await db.exec("ROLLBACK");
    assert.equal(
      (
        await db.query(
          "SELECT pg_get_functiondef('videoforge_record_hosted_pair_zero_worker(uuid,uuid,uuid,jsonb)'::regprocedure) AS body",
        )
      ).rows[0].body,
      original,
    );
  } finally {
    await db.close();
  }
});
