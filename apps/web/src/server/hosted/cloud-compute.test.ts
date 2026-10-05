// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import type { SqlExecutor, SqlPrimitive } from "@videoforge/control-plane";
import { expect, it } from "vitest";
import { readCloudCompute } from "./cloud-compute";
import { sha256 } from "./crypto";
import { canonicalJson } from "./submission";

const id = (value: number) => `${String(value).padStart(8, "0")}-1111-4111-8111-111111111111`;

it("reads each scoped rental once and stops its clock only on the exact tenant-owned absence proof", async () => {
  const db = new PGlite();
  const account = id(1),
    workspace = id(2),
    project = id(3),
    rental = id(4),
    attempt = id(5),
    fence = id(6);
  const sql: SqlExecutor = {
    execute: async (query) => {
      await db.exec(query);
    },
    query: async <Row extends Record<string, unknown>>(
      query: string,
      parameters: readonly SqlPrimitive[] = [],
    ) => {
      const result = await db.query<Row>(query, [...parameters]);
      return { rows: result.rows, affectedRows: result.affectedRows ?? result.rows.length };
    },
  };
  try {
    await db.exec(`CREATE TABLE cloud_media_reservations (
      id uuid PRIMARY KEY, account_id uuid, workspace_id uuid, project_id uuid,
      leased_attempt_id uuid, fence_id uuid, gpu text, cpu_placement jsonb,
      actual_hourly_usd numeric, state text, launch_outcome text, pod_id text,
      verified_at timestamptz, cleanup_verified_at timestamptz, created_at timestamptz DEFAULT now()
    ); CREATE TABLE cloud_media_jobs (
      account_id uuid, workspace_id uuid, reservation_id uuid, attempt_id uuid
    ); CREATE TABLE hosted_cpu_job_events (
      id uuid PRIMARY KEY, account_id uuid, workspace_id uuid, attempt_id uuid,
      facts_sha256 text, kind text, occurred_at timestamptz
    );`);
    const add = async (
      rentalId: string,
      owner = account,
      space = workspace,
      projectId = project,
      outcome: string | null = "CONFIRMED",
      started: string | null = "2026-10-05T09:00:00Z",
      state = "STOPPING",
    ) => {
      await db.query(
        `INSERT INTO cloud_media_reservations
        (id, account_id, workspace_id, project_id, leased_attempt_id, fence_id, gpu, actual_hourly_usd, state, launch_outcome, verified_at)
        VALUES ($1,$2,$3,$4,$5,$6,'RTX 4090',0.8,$7,$8,$9)`,
        [rentalId, owner, space, projectId, attempt, fence, state, outcome, started],
      );
    };
    await add(rental);
    // A SPAN rental is still one reservation even when it serves multiple jobs.
    await db.query("INSERT INTO cloud_media_jobs VALUES ($1,$2,$3,$4),($1,$2,$3,$5)", [
      account,
      workspace,
      rental,
      attempt,
      id(31),
    ]);
    await add(id(7), id(8));
    await add(id(9), account, id(10));
    await add(id(11), account, workspace, id(12));
    const read = () => readCloudCompute(sql, account, workspace, project);
    let result = await read();
    expect(result.rentals).toHaveLength(1);
    expect(result.rentals[0]).toMatchObject({
      id: rental,
      hourly_usd: 0.8,
      status: "RUNNING",
      stopped_at: null,
    });
    expect(Number.isFinite(Date.parse(result.observed_at))).toBe(true);

    const hash = await sha256(
      canonicalJson({
        schema_version: "videoforge-cloud-media-owned-absence/v1",
        reservation_id: rental,
        attempt_id: attempt,
        fence_id: fence,
        inventory_complete: true,
        owned_pods: 0,
      }),
    );
    const proof = async (
      owner: string,
      space: string,
      eventAttempt = attempt,
      kind = "POLL_OBSERVATION",
      facts = hash,
    ) => {
      await db.exec("DELETE FROM hosted_cpu_job_events");
      await db.query(
        `INSERT INTO hosted_cpu_job_events VALUES (md5($1)::uuid,$2,$3,$4,$5,$6,'2026-10-05T09:10:00Z')`,
        [hash, owner, space, eventAttempt, facts, kind],
      );
    };
    for (const invalid of [
      [id(8), workspace, attempt, "POLL_OBSERVATION", hash],
      [account, id(10), attempt, "POLL_OBSERVATION", hash],
      [account, workspace, id(20), "POLL_OBSERVATION", hash],
      [account, workspace, attempt, "OTHER", hash],
      [account, workspace, attempt, "POLL_OBSERVATION", `sha256:${"0".repeat(64)}`],
    ]) {
      await proof(...(invalid as [string, string, string, string, `sha256:${string}`]));
      expect((await read()).rentals[0]?.stopped_at).toBeNull();
    }
    await proof(account, workspace);
    expect((await read()).rentals[0]).toMatchObject({
      status: "STOPPED",
      stopped_at: "2026-10-05T09:10:00.000Z",
    });
    // Receipt/storage reconciliation may finish later; the earlier owned-absence proof remains the stop time.
    await db.query(
      "UPDATE cloud_media_reservations SET state='CLEAN',cleanup_verified_at='2026-10-05T09:20:00Z' WHERE id=$1",
      [rental],
    );
    expect((await read()).rentals[0]?.stopped_at).toBe("2026-10-05T09:10:00.000Z");

    await add(id(21), account, workspace, project, "REFUSED", null, "CLEAN");
    await add(id(22), account, workspace, project, "UNKNOWN", null, "STOPPING");
    await add(id(24), account, workspace, project, null, null, "WAITING_CAPACITY");
    await add(id(25), account, workspace, project, "REFUSED", null, "WAITING_CAPACITY");
    await add(id(26), account, workspace, project, "CONFIRMED", null, "STARTING");
    await add(id(27), account, workspace, project, "UNKNOWN", null, "STARTING");
    await add(id(28), account, workspace, project, "REFUSED", null, "STOPPING");
    await db.query(
      "UPDATE cloud_media_reservations SET pod_id='existing-pod' WHERE id IN ($1,$2,$3)",
      [id(26), id(27), id(28)],
    );
    await add(id(29), account, workspace, project, "CONFIRMED", null, "STARTING");
    await add(id(23), account, workspace, project, "CONFIRMED", "2026-10-05T09:00:00Z", "STARTING");
    await db.query(
      "UPDATE cloud_media_reservations SET actual_hourly_usd=NULL,cpu_placement=$2::jsonb WHERE id=$1",
      [id(23), JSON.stringify({ id: "cpu", vcpuCount: 16, memory: 64 })],
    );
    result = await read();
    expect(result.rentals.find((item) => item.id === id(21))).toMatchObject({
      status: "NOT_STARTED",
      started_at: null,
    });
    expect(result.rentals.find((item) => item.id === id(22))).toMatchObject({
      status: "UNCONFIRMED",
      started_at: null,
    });
    for (const waiting of [id(24), id(25)]) {
      expect(result.rentals.find((item) => item.id === waiting)).toMatchObject({
        status: "NOT_STARTED",
        started_at: null,
      });
    }
    // A confirmed/ambiguous launch or any remaining pod is not evidence of a free rental.
    for (const unresolved of [id(26), id(27), id(28), id(29)]) {
      expect(result.rentals.find((item) => item.id === unresolved)).toMatchObject({
        status: "UNCONFIRMED",
        started_at: null,
      });
    }
    expect(result.rentals.find((item) => item.id === id(23))).toMatchObject({
      machine: "16 vCPU / 64 GB RAM",
      hourly_usd: null,
    });
    expect(await readCloudCompute(sql, account, workspace, id(30))).toMatchObject({ rentals: [] });
  } finally {
    await db.close();
  }
});
