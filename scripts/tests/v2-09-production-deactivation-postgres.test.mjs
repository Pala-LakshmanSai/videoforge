// Run explicitly: node --test scripts/tests/v2-09-production-deactivation-postgres.test.mjs
// Uses only cached PostgreSQL 17, with no network or retained storage.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../deploy/v2-09/neon-deactivate-v209-production.sql", import.meta.url),
  "utf8",
);
const ids = [1, 2, 3, 4].map((n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const payload = (deploymentIds) => ({
  schemaVersion: "videoforge.v2-09-deactivate-production/v1",
  deploymentIds,
});

test(
  "real PostgreSQL 17 deactivation is atomic, exact, idempotent and observes updated rows",
  { timeout: 30_000 },
  async () => {
    const container = `videoforge-v209-deactivation-${randomUUID()}`;
    let started = false;
    const docker = (args, input) =>
      spawnSync("docker", args, { input, encoding: "utf8", timeout: 10_000 });
    const success = (result) => {
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      return result.stdout.trim();
    };
    const sql = (input, args = []) =>
      docker(
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
          ...args,
        ],
        input,
      );
    const execute = (value) =>
      sql(source, [
        "-v",
        `payload_base64=${Buffer.from(JSON.stringify(value)).toString("base64")}`,
      ]);
    const readRows = () =>
      JSON.parse(
        success(
          sql(
            "SELECT json_agg(json_build_object('id',id,'active',is_active) ORDER BY id) FROM public.serverless_endpoint_deployments;",
          ),
        ),
      );
    const reset = () =>
      success(sql("UPDATE public.serverless_endpoint_deployments SET is_active=true;"));
    const result = (matchedCount, deactivatedCount) => ({
      schemaVersion: "videoforge.v2-09-deactivate-production-result/v1",
      matchedCount,
      deactivatedCount,
      allInactive: true,
    });
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
        sql(
          `CREATE TABLE public.serverless_endpoint_deployments(id uuid PRIMARY KEY,is_active boolean NOT NULL); INSERT INTO public.serverless_endpoint_deployments VALUES ${ids
            .slice(0, 3)
            .map((id) => `('${id}',true)`)
            .join(",")};`,
        ),
      );

      // Observe the exact production advisory lock from an UPDATE trigger, so removing
      // or changing that lock makes the real mutation test fail.
      success(
        sql(`CREATE FUNCTION require_cleanup_lock() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE lock_key bigint := hashtextextended('videoforge:v209:production-pair',209);
      BEGIN
        IF NOT NEW.is_active AND NOT EXISTS(SELECT 1 FROM pg_locks
          WHERE pid=pg_backend_pid() AND locktype='advisory' AND granted
            AND classid=((lock_key >> 32) & 4294967295)::oid
            AND objid=(lock_key & 4294967295)::oid AND objsubid=1) THEN
          RAISE EXCEPTION 'required cleanup lock missing';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER require_cleanup_lock BEFORE UPDATE ON public.serverless_endpoint_deployments
        FOR EACH ROW EXECUTE FUNCTION require_cleanup_lock();`),
      );

      assert.deepEqual(JSON.parse(success(execute(payload(ids.slice(0, 2))))), result(2, 2));
      assert.deepEqual(
        readRows(),
        ids.slice(0, 3).map((id, index) => ({ id, active: index === 2 })),
      );
      assert.deepEqual(JSON.parse(success(execute(payload(ids.slice(0, 2))))), result(2, 0));
      success(
        sql(
          `UPDATE public.serverless_endpoint_deployments SET is_active=true WHERE id='${ids[1]}';`,
        ),
      );
      assert.deepEqual(JSON.parse(success(execute(payload(ids.slice(0, 2))))), result(2, 1));
      assert.deepEqual(JSON.parse(success(execute(payload([ids[2]])))), result(1, 1));

      for (const invalid of [
        null,
        {},
        [],
        { ...payload([ids[0]]), extra: true },
        { ...payload([ids[0]]), schemaVersion: "wrong" },
        payload(null),
        payload([]),
        payload(ids.slice(0, 3)),
        payload([ids[0], ids[0]]),
        payload([ids[0], null]),
        payload([ids[0], 5]),
        payload([ids[0], "not-a-uuid"]),
        payload([ids[0], ids[3]]),
      ]) {
        reset();
        assert.notEqual(
          execute(invalid).status,
          0,
          `accepted invalid input ${JSON.stringify(invalid)}`,
        );
        assert.deepEqual(
          readRows(),
          ids.slice(0, 3).map((id) => ({ id, active: true })),
          "invalid input must not deactivate a partial match",
        );
      }

      // A trigger error after an earlier row update must roll back the entire transaction.
      success(
        sql(
          `CREATE FUNCTION reject_second() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${ids[1]}'::uuid THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_second BEFORE UPDATE ON public.serverless_endpoint_deployments FOR EACH ROW EXECUTE FUNCTION reject_second();`,
        ),
      );
      assert.notEqual(execute(payload(ids.slice(0, 2))).status, 0);
      assert.deepEqual(
        readRows(),
        ids.slice(0, 3).map((id) => ({ id, active: true })),
      );
    } finally {
      if (started) success(docker(["rm", "-f", container]));
    }
  },
);
