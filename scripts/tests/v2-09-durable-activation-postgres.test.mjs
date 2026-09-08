import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
const migration = readFileSync(
  new URL(
    "../../packages/control-plane/migrations/0087_hosted_durable_qualified_activation.sql",
    import.meta.url,
  ),
  "utf8",
);
test(
  "0087 actual PostgreSQL loaders retain acceptance history and reject live lineage drift",
  { timeout: 30000 },
  async () => {
    const name = "v209-durable-" + randomUUID().slice(0, 8);
    const docker = (args) => spawnSync("docker", args, { encoding: "utf8", timeout: 30000 });
    const sql = (text) =>
      spawnSync(
        "docker",
        [
          "exec",
          "-i",
          name,
          "psql",
          "-U",
          "postgres",
          "-X",
          "-q",
          "-A",
          "-t",
          "--set",
          "ON_ERROR_STOP=1",
        ],
        { input: text, encoding: "utf8", timeout: 10000 },
      );
    const ok = (r) => {
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    try {
      ok(
        docker([
          "run",
          "--pull=never",
          "--network",
          "none",
          "--rm",
          "-d",
          "--name",
          name,
          "--tmpfs",
          "/var/lib/postgresql/data",
          "-e",
          "POSTGRES_HOST_AUTH_METHOD=trust",
          "postgres:17-alpine",
        ]),
      );
      for (let i = 0; i < 40; i++) {
        if (docker(["exec", name, "pg_isready", "-U", "postgres"]).status === 0) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      // Minimal prerequisite schema and original pair-loader seam; both new0087 function bodies execute unchanged.
      ok(
        sql(`CREATE TABLE hosted_v209_qualified_activations(id uuid,observed_at timestamptz,imported_at timestamptz,mage_deployment_id uuid,soulx_deployment_id uuid,mage_qualification_id uuid,soulx_qualification_id uuid,source_commit text,cloudflare_version_id_sha256 text,deployed_config_sha256 text,readback_sha256 text,evidence_document jsonb,evidence_sha256 text);
 CREATE TABLE serverless_endpoint_deployments(id uuid,is_active boolean,worker_count_min int,worker_count_max int,handler_concurrency int,region text,gpu_allowlist text[],endpoint_id_sha256 text,endpoint_config_sha256 text,worker_image_digest text,model_manifest_sha256 text,volume_id_sha256 text,volume_manifest_sha256 text);
 CREATE TABLE hosted_serverless_qualification_attestations(id uuid,expires_at timestamptz,verified_at timestamptz,deployment_snapshot_sha256 text,independent_audit_accepted boolean,qualification_record_sha256 text);
 CREATE TABLE videoforge_schema_migrations(version int,sha256 text);
 INSERT INTO videoforge_schema_migrations SELECT n,'sha256:'||repeat('a',64) FROM generate_series(37,87)n;
 CREATE FUNCTION videoforge_canonical_jsonb(jsonb)RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT $1::text$$;
 CREATE FUNCTION videoforge_hosted_deployment_snapshot_sha256(uuid)RETURNS text LANGUAGE sql STABLE AS $$SELECT endpoint_config_sha256 FROM serverless_endpoint_deployments WHERE id=$1$$;
 INSERT INTO serverless_endpoint_deployments SELECT ('00000000-0000-4000-8000-00000000000'||n)::uuid,true,0,1,1,'EU-RO-1',ARRAY['NVIDIA GeForce RTX 4090'],'sha256:'||repeat('a',64),'sha256:'||repeat('b',64),'sha256:'||repeat('c',64),'sha256:'||repeat('d',64),'sha256:'||repeat('e',64),'sha256:'||repeat('f',64) FROM generate_series(1,2)n;
 INSERT INTO hosted_serverless_qualification_attestations SELECT id,now()+interval '1 hour',now()-interval '20 minutes','sha256:'||repeat('b',64),true,'sha256:'||repeat('a',64) FROM serverless_endpoint_deployments;
 INSERT INTO hosted_v209_qualified_activations VALUES('00000000-0000-4000-8000-000000000003',now()-interval '20 minutes',now()-interval '20 minutes','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',repeat('a',40),'sha256:'||repeat('a',64),'sha256:'||repeat('b',64),'sha256:'||repeat('c',64),'{}','sha256:'||repeat('d',64));
 CREATE FUNCTION videoforge_load_hosted_pair_activation(uuid,uuid,uuid)RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('databaseNow',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'paidApproval',jsonb_build_object('approved',true,'exact',true,'expiresAt',now()+interval '2 minutes'),'lanes',jsonb_build_object('mage_image',jsonb_build_object('deployment',jsonb_build_object('deploymentId','00000000-0000-4000-8000-000000000001','deploymentSnapshotSha256','sha256:'||repeat('b',64))),'soulx_avatar',jsonb_build_object('deployment',jsonb_build_object('deploymentId','00000000-0000-4000-8000-000000000002','deploymentSnapshotSha256','sha256:'||repeat('b',64)))))$$;`),
      );
      ok(sql(migration));
      const read = () => JSON.parse(ok(sql("SELECT videoforge_load_hosted_gpu_activation_v2();")));
      const value = read();
      const gate = value.verification.gate;
      assert.ok(Date.parse(gate.now) - Date.parse(gate.cloudflare.observedAt) > 19 * 60 * 1000);
      assert.equal(gate.cloudflare.databaseVerification.kind, "PERSISTED_EXACT_ACTIVATION");
      assert.equal(
        gate.cloudflare.databaseVerification.observedAt,
        value.verification.databaseObservedAt,
      );
      assert.equal(gate.cloudflare.databaseVerification.expiresAt, value.verification.expiresAt);
      assert.equal(gate.migrationLedger.length, 51);
      const pair = JSON.parse(
        ok(sql("SELECT videoforge_load_hosted_pair_activation_v2(NULL,NULL,NULL);")),
      );
      assert.equal(pair.cloudflare.observedAt, gate.cloudflare.observedAt);
      assert.ok(
        Date.parse(pair.cloudflare.databaseVerification.expiresAt) <=
          Date.parse(pair.paidApproval.expiresAt),
      );
      for (const alteration of [
        "UPDATE serverless_endpoint_deployments SET is_active=false;",
        "UPDATE hosted_serverless_qualification_attestations SET expires_at=now()-interval '1 second';",
        "UPDATE serverless_endpoint_deployments SET endpoint_config_sha256='tampered';",
      ]) {
        const result = sql(
          "BEGIN;" + alteration + "SELECT videoforge_load_hosted_gpu_activation_v2();ROLLBACK;",
        );
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /activation v2 drifted/);
      }
      ok(
        sql(
          "UPDATE serverless_endpoint_deployments SET endpoint_config_sha256='sha256:'||repeat('e',64); UPDATE hosted_serverless_qualification_attestations SET deployment_snapshot_sha256='sha256:'||repeat('e',64);",
        ),
      );
      const mismatch = sql("SELECT videoforge_load_hosted_pair_activation_v2(NULL,NULL,NULL);");
      assert.notEqual(mismatch.status, 0);
      assert.match(mismatch.stderr, /deployment mismatch/);
    } finally {
      docker(["rm", "-f", name]);
    }
  },
);
