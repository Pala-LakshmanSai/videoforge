import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../packages/control-plane/migrations/0089_hosted_v209_activation_rebind.sql",
    import.meta.url,
  ),
  "utf8",
);

test(
  "0089 actual PostgreSQL permits version-specific activation rebind and keeps latest selection deterministic",
  { timeout: 30000 },
  async () => {
    const name = "v209-rebind-" + randomUUID().slice(0, 8);
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
    const ok = (result) => {
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
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
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // This is the pre-0089 shape: one historical row and the old source/config uniqueness.
      ok(
        sql(`
CREATE TABLE hosted_v209_qualified_activations(
  id uuid PRIMARY KEY,
  observed_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL,
  mage_deployment_id uuid NOT NULL,
  soulx_deployment_id uuid NOT NULL,
  mage_qualification_id uuid NOT NULL,
  soulx_qualification_id uuid NOT NULL,
  source_commit text NOT NULL,
  cloudflare_version_id_sha256 text NOT NULL,
  deployed_config_sha256 text NOT NULL,
  readback_sha256 text NOT NULL,
  evidence_document jsonb NOT NULL,
  evidence_sha256 text NOT NULL,
  UNIQUE(source_commit,deployed_config_sha256)
);
CREATE TABLE serverless_endpoint_deployments(
  id uuid PRIMARY KEY,
  is_active boolean,
  worker_count_min int,
  worker_count_max int,
  handler_concurrency int,
  region text,
  gpu_allowlist text[],
  endpoint_id_sha256 text,
  endpoint_config_sha256 text,
  worker_image_digest text,
  model_manifest_sha256 text,
  volume_id_sha256 text,
  volume_manifest_sha256 text
);
CREATE TABLE hosted_serverless_qualification_attestations(
  id uuid PRIMARY KEY,
  expires_at timestamptz,
  verified_at timestamptz,
  deployment_snapshot_sha256 text,
  independent_audit_accepted boolean,
  qualification_record_sha256 text
);
CREATE TABLE videoforge_schema_migrations(version int,sha256 text);
INSERT INTO videoforge_schema_migrations
  SELECT n,'sha256:'||repeat('a',64) FROM generate_series(37,89)n;
CREATE FUNCTION videoforge_canonical_jsonb(jsonb) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$SELECT $1::text$$;
CREATE FUNCTION videoforge_hosted_deployment_snapshot_sha256(uuid) RETURNS text
  LANGUAGE sql STABLE AS $$SELECT endpoint_config_sha256 FROM serverless_endpoint_deployments WHERE id=$1$$;
CREATE FUNCTION videoforge_vnext_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'append-only'; END$$;
CREATE TRIGGER hosted_v209_qualified_activations_append_only
  BEFORE UPDATE OR DELETE ON hosted_v209_qualified_activations
  FOR EACH ROW EXECUTE FUNCTION videoforge_vnext_append_only();
INSERT INTO serverless_endpoint_deployments
  SELECT ('00000000-0000-4000-8000-00000000010'||n)::uuid,true,0,1,1,'EU-RO-1',
    ARRAY['NVIDIA GeForce RTX 4090'],'sha256:'||repeat('a',64),'sha256:'||repeat('b',64),
    'sha256:'||repeat('c',64),'sha256:'||repeat('d',64),'sha256:'||repeat('e',64),
    'sha256:'||repeat('f',64) FROM generate_series(1,2)n;
INSERT INTO hosted_serverless_qualification_attestations
  SELECT id,now()+interval '1 hour',now()-interval '20 minutes','sha256:'||repeat('b',64),true,
    'sha256:'||repeat('a',64) FROM serverless_endpoint_deployments;
INSERT INTO hosted_v209_qualified_activations VALUES(
  '00000000-0000-4000-8000-000000000001',now()-interval '1 minute',
  timestamp '2026-09-08 12:00:00+00','00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',repeat('a',40),'sha256:'||repeat('d',64),
  'sha256:'||repeat('b',64),'sha256:'||repeat('c',64),
  jsonb_build_object('evidence','historical'), 'sha256:'||repeat('e',64));
CREATE FUNCTION videoforge_load_hosted_pair_activation(uuid,uuid,uuid) RETURNS jsonb
  LANGUAGE sql AS $$SELECT jsonb_build_object(
    'databaseNow',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'paidApproval',jsonb_build_object('approved',true,'exact',true,
      'expiresAt',now()+interval '2 minutes'),
    'lanes',jsonb_build_object(
      'mage_image',jsonb_build_object('deployment',jsonb_build_object(
        'deploymentId','00000000-0000-4000-8000-000000000101',
        'deploymentSnapshotSha256','sha256:'||repeat('b',64))),
      'soulx_avatar',jsonb_build_object('deployment',jsonb_build_object(
        'deploymentId','00000000-0000-4000-8000-000000000102',
        'deploymentSnapshotSha256','sha256:'||repeat('b',64)))))$$;
`),
      );

      ok(sql(migration));
      ok(
        sql(`
INSERT INTO hosted_v209_qualified_activations VALUES(
  '00000000-0000-4000-8000-000000000002',now()-interval '1 minute',
  timestamp '2026-09-08 12:00:00+00','00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',repeat('a',40),'sha256:'||repeat('1',64),
  'sha256:'||repeat('b',64),'sha256:'||repeat('c',64),
  jsonb_build_object('evidence','rebound'), 'sha256:'||repeat('2',64));
`),
      );

      const rows = JSON.parse(
        ok(
          sql(
            "SELECT json_agg(json_build_object('id',id::text,'mageDeploymentId',mage_deployment_id::text,'soulxDeploymentId',soulx_deployment_id::text,'mageQualificationId',mage_qualification_id::text,'soulxQualificationId',soulx_qualification_id::text,'versionIdSha256',cloudflare_version_id_sha256,'deployedConfigSha256',deployed_config_sha256,'readbackSha256',readback_sha256,'evidence',evidence_document->>'evidence') ORDER BY id) FROM hosted_v209_qualified_activations;",
          ),
        ),
      );
      assert.deepEqual(rows, [
        {
          id: "00000000-0000-4000-8000-000000000001",
          mageDeploymentId: "00000000-0000-4000-8000-000000000101",
          soulxDeploymentId: "00000000-0000-4000-8000-000000000102",
          mageQualificationId: "00000000-0000-4000-8000-000000000101",
          soulxQualificationId: "00000000-0000-4000-8000-000000000102",
          versionIdSha256: "sha256:" + "d".repeat(64),
          deployedConfigSha256: "sha256:" + "b".repeat(64),
          readbackSha256: "sha256:" + "c".repeat(64),
          evidence: "historical",
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          mageDeploymentId: "00000000-0000-4000-8000-000000000101",
          soulxDeploymentId: "00000000-0000-4000-8000-000000000102",
          mageQualificationId: "00000000-0000-4000-8000-000000000101",
          soulxQualificationId: "00000000-0000-4000-8000-000000000102",
          versionIdSha256: "sha256:" + "1".repeat(64),
          deployedConfigSha256: "sha256:" + "b".repeat(64),
          readbackSha256: "sha256:" + "c".repeat(64),
          evidence: "rebound",
        },
      ]);

      const duplicate = sql(`
INSERT INTO hosted_v209_qualified_activations VALUES(
  '00000000-0000-4000-8000-000000000003',now(),now(),
  '00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102',
  repeat('a',40),'sha256:'||repeat('1',64),'sha256:'||repeat('b',64),
  'sha256:'||repeat('c',64),jsonb_build_object('evidence','duplicate'),'sha256:'||repeat('3',64));
`);
      assert.notEqual(duplicate.status, 0);
      assert.match(duplicate.stderr, /source_config_version_key|duplicate key/u);

      const update = sql(
        "UPDATE hosted_v209_qualified_activations SET evidence_document='{}'::jsonb WHERE id='00000000-0000-4000-8000-000000000001';",
      );
      assert.notEqual(update.status, 0);
      assert.match(update.stderr, /append-only/u);

      const loaded = JSON.parse(ok(sql("SELECT videoforge_load_hosted_gpu_activation_v2();")));
      assert.equal(loaded.verification.gate.cloudflare.versionIdSha256, "sha256:" + "1".repeat(64));
      assert.equal(loaded.evidence.evidence, "rebound");
      assert.equal(loaded.verification.gate.migrationLedger.length, 51);
    } finally {
      docker(["rm", "-f", name]);
    }
  },
);
