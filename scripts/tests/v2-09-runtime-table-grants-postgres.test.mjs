// Explicit integration: cached PostgreSQL17, no network, disposable tmpfs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
const source = readFileSync(
  new URL("../../deploy/v2-09/neon-v209-runtime-grants.sql", import.meta.url),
  "utf8",
);
const baseline = readFileSync(
  new URL("../../deploy/v2-06/neon-runtime-grants.sql", import.meta.url),
  "utf8",
);
const tableNames = [
  ...new Set(
    [...source.matchAll(/\('([a-z_]+)','(?:SELECT|INSERT|UPDATE|DELETE)'\)/gu)].map((m) => m[1]),
  ),
];
const signatures = [...source.matchAll(/\('([^']+\([^']*\))'\)/gu)].map((m) => m[1]);
test(
  "fresh runtime has exact baseline table privileges, heartbeat tenant isolation and no future capability",
  { timeout: 30000 },
  async () => {
    const name = `v209-runtime-acl-${randomUUID()}`;
    const docker = (args, input) =>
      spawnSync("docker", args, { input, encoding: "utf8", timeout: 10000 });
    const ok = (r) => {
      assert.equal(r.status, 0, r.stderr || r.error?.message);
      return r.stdout.trim();
    };
    const sql = (text) =>
      docker(
        ["exec", "-i", name, "psql", "-U", "postgres", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"],
        text,
      );
    const denied = (text) => {
      const r = sql("\\set VERBOSITY verbose\nSET ROLE vf_runtime;" + text);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /42501/u);
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
        await new Promise((r) => setTimeout(r, 250));
      }
      // Function bodies unrelated to table ACLs are stubbed; exact production grants execute unchanged.
      ok(
        sql(
          "CREATE ROLE vf_runtime LOGIN NOINHERIT;" +
            signatures
              .map(
                (s) =>
                  `CREATE FUNCTION public.${s} RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;`,
              )
              .join("\n") +
            tableNames
              .map(
                (t) =>
                  `CREATE TABLE public.${t}(id integer PRIMARY KEY,account_id text,status text);`,
              )
              .join("\n") +
            "CREATE TABLE future_v210_secret(id integer);CREATE FUNCTION future_v210_mutation() RETURNS text LANGUAGE sql AS $$SELECT 'forbidden'$$;",
        ),
      );
      assert.equal(
        ok(
          sql(
            "SELECT has_table_privilege('vf_runtime','media_worker_devices','SELECT'),has_table_privilege('vf_runtime','media_worker_devices','UPDATE');",
          ),
        ),
        "f|f",
      );
      denied("UPDATE media_worker_devices SET status='ONLINE' WHERE id=1 RETURNING id;");
      ok(sql("\\set runtime_role vf_runtime\n" + source));
      // Independently compare baseline table matrix, not only the new implementation's list.
      const expected = [];
      for (const m of baseline.matchAll(
        /GRANT (SELECT(?:, INSERT)?(?:, UPDATE)?(?:, DELETE)?) ON\s+([a-z_\s,]+?)\s+TO :"runtime_role";/gu,
      ))
        for (const t of m[2].split(",").map((x) => x.trim()))
          for (const privilege of m[1].split(", ")) expected.push(`${t}:${privilege}`);
      const actual = ok(
        sql(
          "SELECT table_name||':'||privilege_type FROM information_schema.role_table_grants WHERE grantee='vf_runtime' AND table_schema='public' ORDER BY 1;",
        ),
      );
      assert.deepEqual(actual.split("\n"), [...new Set(expected)].sort());
      ok(
        sql(
          "ALTER TABLE media_worker_devices ENABLE ROW LEVEL SECURITY;ALTER TABLE media_worker_devices FORCE ROW LEVEL SECURITY;CREATE POLICY tenant ON media_worker_devices USING(account_id=current_setting('videoforge.account_id',true)) WITH CHECK(account_id=current_setting('videoforge.account_id',true));INSERT INTO media_worker_devices VALUES(1,'tenant-a','OFFLINE'),(2,'tenant-b','OFFLINE');",
        ),
      );
      assert.equal(
        ok(
          sql(
            "SET ROLE vf_runtime; SET videoforge.account_id='tenant-a'; UPDATE media_worker_devices SET status='ONLINE' WHERE id=1 RETURNING id; SELECT count(*) FROM media_worker_devices WHERE id=2; UPDATE media_worker_devices SET status='ONLINE' WHERE id=2 RETURNING id;",
          ),
        ),
        "1\n0",
      );
      denied(
        "SET videoforge.account_id='tenant-a'; INSERT INTO media_worker_devices VALUES(3,'tenant-b','ONLINE');",
      );
      assert.equal(ok(sql("SELECT status FROM media_worker_devices WHERE id=2;")), "OFFLINE");
      denied("SELECT * FROM future_v210_secret;");
      denied("SELECT future_v210_mutation();");
      denied("DELETE FROM media_worker_devices;");
      denied("UPDATE hosted_render_plans SET status='forged';");
      assert.equal(
        ok(
          sql("SELECT rolsuper,rolbypassrls,rolinherit FROM pg_roles WHERE rolname='vf_runtime';"),
        ),
        "f|f|f",
      );
      // Reapplication revokes an accidentally broadened future ACL rather than retaining it.
      ok(sql("GRANT SELECT ON future_v210_secret TO vf_runtime;"));
      ok(sql("\\set runtime_role vf_runtime\n" + source));
      denied("SELECT * FROM future_v210_secret;");
    } finally {
      docker(["rm", "-f", name]);
    }
  },
);
