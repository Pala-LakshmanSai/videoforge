// Dedicated provider-free integration: node --test scripts/tests/v2-09-media-heartbeat-postgres.test.mjs
// Requires an already cached postgres:17-alpine image; never pulls or publishes images.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  v209OnlineHeartbeatSql,
  v209HeartbeatReadAccessSql,
} from "../../deploy/v2-09/media-worker-production-operator.mjs";

const installationId = "00000000-0000-4000-8000-000000000001";
const executionBundleSha256 = `sha256:${"a".repeat(64)}`;

test(
  "real PostgreSQL 17 heartbeat preserves closed operator ACLs and fails closed on forced RLS",
  { timeout: 30_000 },
  async () => {
    const container = `videoforge-v209-heartbeat-${randomUUID()}`;
    let started = false;
    function docker(args, input) {
      return spawnSync("docker", args, { input, encoding: "utf8", timeout: 10_000 });
    }
    function success(result) {
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      return result.stdout.trim();
    }
    function sql(input) {
      return docker(
        [
          "exec",
          "-i",
          container,
          "psql",
          "-X",
          "-q",
          "-U",
          "postgres",
          "-v",
          "ON_ERROR_STOP=1",
          "-At",
        ],
        input,
      );
    }
    const heartbeat = v209OnlineHeartbeatSql({ installationId, executionBundleSha256 });
    try {
      success(docker(["image", "inspect", "postgres:17-alpine", "--format", "{{.Id}}"]));
      success(
        docker([
          "run",
          "-d",
          "--rm",
          "--pull=never",
          "--network",
          "none",
          "--name",
          container,
          "--tmpfs",
          "/var/lib/postgresql/data",
          "-e",
          "POSTGRES_HOST_AUTH_METHOD=trust",
          "postgres:17-alpine",
        ]),
      );
      started = true;
      let ready = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        // TCP readiness skips the temporary Unix-only server used during initdb.
        if (
          docker(["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]).status ===
          0
        ) {
          ready = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(ready, true, "disposable PostgreSQL did not become ready");
      success(
        sql(`
      CREATE ROLE fixture_owner LOGIN NOINHERIT;
      CREATE ROLE fixture_operator LOGIN NOINHERIT;
      CREATE TABLE public.media_worker_devices (
        installation_id uuid, platform text, architecture text, worker_version text,
        protocol_version integer, execution_bundle_sha256 text, status text, last_seen_at timestamptz
      );
      INSERT INTO public.media_worker_devices VALUES (
        '${installationId}', 'MACOS', 'AARCH64', '0.1.15', 1,
        '${executionBundleSha256}', 'ONLINE', now()
      );
      ALTER TABLE public.media_worker_devices OWNER TO fixture_owner;
      ALTER TABLE public.media_worker_devices ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.media_worker_devices FORCE ROW LEVEL SECURITY;
      CREATE POLICY fixture_denied ON public.media_worker_devices USING (false);
      GRANT USAGE ON SCHEMA public TO fixture_operator;
      REVOKE ALL ON ALL TABLES IN SCHEMA public FROM fixture_operator;
    `),
      );
      const legacyHeartbeat = heartbeat.replace("SET LOCAL row_security = off; ", "");
      const operator = sql(
        `\\set VERBOSITY verbose\nSET ROLE fixture_operator; ${legacyHeartbeat}`,
      );
      assert.equal(operator.status, 3);
      assert.match(operator.stderr, /42501: permission denied for table media_worker_devices/u);
      assert.equal(
        success(sql(`SET ROLE fixture_operator; ${v209HeartbeatReadAccessSql()}`)),
        "V209_HEARTBEAT_READ_DENIED",
      );
      assert.equal(
        success(sql(`SET ROLE fixture_owner; ${v209HeartbeatReadAccessSql()}`)),
        "V209_HEARTBEAT_READ_DENIED",
      );
      const ownerWithoutBypass = sql(`SET ROLE fixture_owner; ${heartbeat}`);
      assert.equal(ownerWithoutBypass.status, 3);
      assert.match(
        ownerWithoutBypass.stderr,
        /query would be affected by row-level security policy/u,
      );
      // Fixture-only capability models an already privileged migration owner; production grants are untouched.
      success(sql("ALTER ROLE fixture_owner BYPASSRLS;"));
      assert.equal(
        success(sql(`SET ROLE fixture_owner; ${v209HeartbeatReadAccessSql()}`)),
        "V209_HEARTBEAT_READ_ALLOWED",
      );
      const observed = JSON.parse(success(sql(`SET ROLE fixture_owner; ${heartbeat}`)));
      assert.deepEqual(Object.keys(observed).sort(), [
        "architecture",
        "execution_bundle_sha256",
        "installation_id",
        "last_seen_at",
        "platform",
        "protocol_version",
        "status",
        "worker_version",
      ]);
      assert.equal(observed.installation_id, installationId);
      assert.equal(observed.execution_bundle_sha256, executionBundleSha256);
      assert.equal(observed.worker_version, "0.1.15");
      assert.equal(observed.status, "ONLINE");
      for (const assignment of [
        "last_seen_at = now() - interval '91 seconds'",
        "installation_id = '00000000-0000-4000-8000-000000000002'",
        "worker_version = '0.1.14'",
        `execution_bundle_sha256 = 'sha256:${"b".repeat(64)}'`,
        "status = 'UPDATE_REQUIRED'",
      ]) {
        success(
          sql(
            `UPDATE public.media_worker_devices SET installation_id = '${installationId}', worker_version = '0.1.15', execution_bundle_sha256 = '${executionBundleSha256}', status = 'ONLINE', last_seen_at = now(); UPDATE public.media_worker_devices SET ${assignment};`,
          ),
        );
        assert.equal(success(sql(`SET ROLE fixture_owner; ${heartbeat}`)), "", assignment);
      }
      assert.equal(
        success(
          sql(
            "SELECT has_table_privilege('fixture_operator', 'public.media_worker_devices', 'SELECT');",
          ),
        ),
        "f",
      );
    } finally {
      if (started) success(docker(["rm", "-f", container]));
    }
  },
);
