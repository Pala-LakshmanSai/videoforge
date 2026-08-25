import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { applyMigrations } from "../dist/src/index.js";
import { loadMigrationSources, PGliteExecutor } from "./support/pglite.mjs";

const account = "11111111-1111-4111-8111-111111111111";
const workspace = "22222222-2222-4222-8222-222222222222";
const request = "33333333-3333-4333-8333-333333333333";
const digest = (c) => `sha256:${c.repeat(64)}`;

test("0044 pins pgcrypto HMAC and rejects forged and cross-scope proofs before persistence", async () => {
  const database = new PGlite();
  try {
    const executor = new PGliteExecutor(database);
    const sources = await loadMigrationSources();
    const migration = sources.find((source) => source.version === 44)?.sql ?? "";
    assert.match(migration, /encode\(hmac\(convert_to\(public\.videoforge_canonical_jsonb\(/u);
    assert.match(migration, /decode\(proof_secret,'hex'\),'sha256'\),'hex'\)/u);
    await applyMigrations(executor, sources);
    await executor.query(
      "INSERT INTO hosted_provider_proof_keys(key_id,secret_hex) VALUES($1,$2)",
      ["proof-key-v1", "ab".repeat(32)],
    );
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [account]);
    const proof = (lane, accountId = account) => ({
      schema_version: "videoforge-hosted-zero-worker-proof/v1",
      account_id: accountId,
      workspace_id: workspace,
      generation_request_id: request,
      lane,
      endpoint_id_sha256: digest(lane === "mage_image" ? "a" : "b"),
      workers_total: 0,
      queued_jobs: 0,
      observed_at: new Date().toISOString(),
      proof_sha256: digest("c"),
      signature_key_id: "proof-key-v1",
      signature_value: "d".repeat(64),
      signature_sha256: digest("e"),
    });
    for (const candidate of [
      [proof("mage_image"), proof("soulx_avatar")],
      [proof("mage_image", workspace), proof("soulx_avatar", workspace)],
    ]) {
      await assert.rejects(
        executor.query(
          "SELECT public.videoforge_record_hosted_pair_zero_worker($1,$2,$3,$4::jsonb)",
          [account, workspace, request, JSON.stringify(candidate)],
        ),
        /zero evidence binding invalid/u,
      );
    }
    const count = await executor.query("SELECT count(*)::integer AS count FROM hosted_pair_zero_worker_observations");
    assert.equal(count.rows[0].count, 0);
  } finally {
    await database.close();
  }
});
