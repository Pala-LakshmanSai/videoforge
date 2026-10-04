import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { createPostgreSqlExecutor } from "../dist/src/adapters/postgres.js";
import {
  loadMigrationSources,
  applyMigrationSliceThrough,
  sha256,
  uuid,
} from "./support/pglite.mjs";
import { seedFairAccount } from "./support/fair-account.mjs";

const connectionString = process.env.VIDEOFORGE_CAPACITY_NATIVE_POSTGRES_URL;

// Requires a disposable local database. Ordinary test runs cannot contact any database.
test(
  "native PostgreSQL 259-261: ten simultaneous sessions, same-job race, rollback isolation and no over-admission",
  {
    skip: !connectionString,
    timeout: 120000,
  },
  async () => {
    const url = new URL(connectionString);
    assert.ok(
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
      "native proof requires loopback",
    );
    assert.match(
      url.pathname,
      /^\/vf_capacity_native_[a-z0-9_]+$/u,
      "native proof requires a dedicated disposable database",
    );
    const pool = new pg.Pool({ connectionString, max: 15 });
    const admin = await pool.connect();
    const direct = createPostgreSqlExecutor({
      query: (...args) => admin.query(...args),
      connect: () => pool.connect(),
    });
    try {
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::integer AS n FROM pg_tables WHERE schemaname='public'",
          )
        ).rows[0].n,
        0,
        "refuse non-empty database",
      );
      for (const role of [
        "videoforge_v209_runtime_dc9612d6",
        "videoforge_v209_reconciler_dc9612d6",
      ])
        await admin.query(
          `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; END IF; END $$`,
        );
      await admin.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
      const sources = await loadMigrationSources();
      const prereq = await Promise.all(
        [
          "0160_hosted_continuation_heartbeats.sql",
          "0162_hosted_continuation_tenant_scoped_sweeps.sql",
          "0163_hosted_continuation_heartbeat_sequence.sql",
        ].map((f) => readFile(new URL(`../migrations/${f}`, import.meta.url), "utf8")),
      );
      const wrap = (port) => ({
        ...port,
        execute: async (sql) => {
          if (sql === sources.find((s) => s.version === 195).sql)
            await port.execute(prereq.join("\n"));
          await port.execute(sql);
        },
        ...(port.transaction
          ? { transaction: (work) => port.transaction((inner) => work(wrap(inner))) }
          : {}),
      });
      const executor = wrap(direct);
      await applyMigrationSliceThrough(executor, 261, sources);
      const accounts = [];
      const seed = async (table, sql, args) => {
        await admin.query(`ALTER TABLE ${table} DISABLE TRIGGER ALL`);
        try {
          await admin.query(sql, args);
        } finally {
          await admin.query(`ALTER TABLE ${table} ENABLE TRIGGER ALL`);
        }
      };
      for (let i = 0; i < 10; i++) {
        const a = await seedFairAccount(executor, 800 + i);
        a.g = uuid(261800 + i * 10);
        a.j = uuid(261801 + i * 10);
        a.t = uuid(261802 + i * 10);
        a.claim = uuid(261803 + i * 10);
        await seed(
          "generation_requests",
          `INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,created_by_user_id,state,queue_order,available_at,idempotency_key,admitted_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',$7,now(),$8,now(),now(),now())`,
          [
            a.g,
            a.accountId,
            a.workspaceId,
            a.projectId,
            a.revisionId,
            a.userId,
            i + 1,
            `native-${i}`,
          ],
        );
        await seed(
          "hosted_api_generation_jobs",
          `INSERT INTO hosted_api_generation_jobs(id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,generation_task_id,task_key,lane,input_manifest,input_sha256,output_object_key,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'IMAGE','{"prompt":"Native capacity proof"}',$9,$10,'PREPARED')`,
          [
            a.j,
            a.accountId,
            a.workspaceId,
            a.projectId,
            a.revisionId,
            a.g,
            a.t,
            `image:${i}`,
            sha256(`native-${i}`),
            `tenant/${a.accountId}/workspace/${a.workspaceId}/project/${a.projectId}/revision/${a.revisionId}/lane/mage-image/job/${a.j}/artifact/${a.t}`,
          ],
        );
        accounts.push(a);
      }
      const args = (a) => [a.accountId, a.workspaceId, a.g, a.t, a.claim];
      const sql = "SELECT videoforge_claim_hosted_api_job($1,$2,$3,$4,$5) AS value";
      const prepare = async (a) => {
        const client = await pool.connect();
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE videoforge_v209_runtime_dc9612d6");
        await client.query("SELECT set_config('videoforge.account_id',$1,true)", [a.accountId]);
        return {
          a,
          client,
          pid: (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
        };
      };
      await admin.query(
        "UPDATE provider_api_policies SET max_inflight=3,min_start_interval_ms=0 WHERE provider='KIE'",
      );
      const sessions = await Promise.all(accounts.map(prepare));
      assert.equal(
        new Set(sessions.map((s) => s.pid)).size,
        10,
        "ten physically distinct concurrent PostgreSQL sessions",
      );
      const outcomes = await Promise.all(
        sessions.map(async (s) => {
          try {
            const row = (await s.client.query(sql, args(s.a))).rows[0].value;
            await s.client.query("COMMIT");
            return row;
          } catch (e) {
            await s.client.query("ROLLBACK");
            throw e;
          } finally {
            s.client.release();
          }
        }),
      );
      assert.equal(outcomes.filter((r) => r.state === "SUBMITTING").length, 3);
      assert.equal(outcomes.filter((r) => r.state === "PREPARED").length, 7);
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::integer AS n FROM hosted_api_generation_jobs WHERE state='SUBMITTING'",
          )
        ).rows[0].n,
        3,
      );
      const reset = async () => {
        await admin.query("DELETE FROM provider_api_waiters");
        await admin.query("DELETE FROM provider_api_account_turns");
        await seed(
          "hosted_api_generation_jobs",
          "UPDATE hosted_api_generation_jobs SET state='PREPARED',claim_id=NULL",
          [],
        );
        await admin.query(
          "UPDATE provider_api_policies SET max_inflight=1,min_start_interval_ms=0,next_start_at='-infinity',cooldown_until='-infinity' WHERE provider='KIE'",
        );
      };
      await reset();
      const same = [accounts[0], { ...accounts[0], claim: uuid(261999) }];
      const racers = await Promise.all(same.map(prepare));
      const sameResults = await Promise.all(
        racers.map(async (s) => {
          try {
            const r = (await s.client.query(sql, args(s.a))).rows[0].value;
            await s.client.query("COMMIT");
            return r;
          } finally {
            s.client.release();
          }
        }),
      );
      assert.equal(
        new Set(sameResults.map((r) => r.claimId)).size,
        1,
        "one immutable dispatch owner wins same-job race",
      );
      assert.ok(same.some((a) => a.claim === sameResults[0].claimId));
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::integer AS n FROM hosted_api_generation_jobs WHERE state='SUBMITTING'",
          )
        ).rows[0].n,
        1,
      );
      await reset();
      const held = await prepare(accounts[0]);
      const blocked = await prepare(accounts[1]);
      try {
        assert.equal(
          (await held.client.query(sql, args(held.a))).rows[0].value.state,
          "SUBMITTING",
        );
        assert.equal(
          (
            await admin.query("SELECT state FROM hosted_api_generation_jobs WHERE id=$1", [
              held.a.j,
            ])
          ).rows[0].state,
          "PREPARED",
          "uncommitted admission is invisible to another session",
        );
        const waiting = blocked.client.query(sql, args(blocked.a));
        let lockSeen = false;
        for (let i = 0; i < 20; i++) {
          const row = (
            await admin.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [
              blocked.pid,
            ])
          ).rows[0];
          if (row?.wait_event_type === "Lock") {
            lockSeen = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(lockSeen, true, "competing transaction waits on real PostgreSQL lock");
        await held.client.query("ROLLBACK");
        assert.equal(
          (await waiting).rows[0].value.state,
          "SUBMITTING",
          "rollback releases gate without stranding waiting account",
        );
        await blocked.client.query("COMMIT");
        assert.equal(
          (
            await admin.query(
              "SELECT count(*)::integer AS n FROM hosted_api_generation_jobs WHERE state='SUBMITTING'",
            )
          ).rows[0].n,
          1,
        );
      } finally {
        await held.client.query("ROLLBACK");
        await blocked.client.query("ROLLBACK");
        held.client.release();
        blocked.client.release();
      }
      console.info(
        JSON.stringify({
          schema_version: "videoforge-native-provider-capacity-proof/v1",
          postgres: (await admin.query("SELECT version() AS value")).rows[0].value,
          migrationVersions: [259, 260, 261],
          simultaneousSessions: 10,
          configuredCap: 3,
          admitted: 3,
          waiting: 7,
          sameJobOwners: 1,
          rollbackLockObserved: true,
          paidCalls: 0,
        }),
      );
    } finally {
      admin.release();
      await pool.end();
    }
  },
);
