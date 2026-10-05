import type { SqlExecutor } from "@videoforge/control-plane";
import type { CloudComputeSnapshot, CloudRental } from "../../lib/cloud-compute";
import { sha256 } from "./crypto";
import { canonicalJson } from "./submission";

function timestamp(value: unknown): string | null {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function readCloudCompute(
  sql: SqlExecutor,
  accountId: string,
  workspaceId: string,
  projectId: string,
): Promise<CloudComputeSnapshot> {
  // Read reservations directly: a SPAN rental can serve several attempts.
  const { rows } = await sql.query(
    `SELECT r.id, r.leased_attempt_id, r.fence_id, r.gpu,
            r.cpu_placement, r.actual_hourly_usd, r.state, r.launch_outcome,
            r.pod_id IS NOT NULL AS has_pod,
            r.verified_at, r.cleanup_verified_at, now() AS observed_at
       FROM cloud_media_reservations r
      WHERE r.account_id=$1 AND r.workspace_id=$2 AND r.project_id=$3
      ORDER BY r.created_at, r.id`,
    [accountId, workspaceId, projectId],
  );
  const proofs = await Promise.all(
    rows.map(async (row) => ({
      row,
      hash: await sha256(
        canonicalJson({
          schema_version: "videoforge-cloud-media-owned-absence/v1",
          reservation_id: row.id,
          attempt_id: row.leased_attempt_id,
          fence_id: row.fence_id,
          inventory_complete: true,
          owned_pods: 0,
        }),
      ),
    })),
  );
  const events = proofs.length
    ? (
        await sql.query(
          `SELECT e.attempt_id, e.facts_sha256, e.occurred_at
       FROM hosted_cpu_job_events e
       JOIN jsonb_array_elements_text($3::jsonb) AS wanted(facts)
         ON e.id=md5(wanted.facts)::uuid AND e.facts_sha256=wanted.facts
      WHERE e.account_id=$1 AND e.workspace_id=$2 AND e.kind='POLL_OBSERVATION'`,
          [accountId, workspaceId, JSON.stringify(proofs.map((proof) => proof.hash))],
        )
      ).rows
    : [];
  const rentals: CloudRental[] = proofs.map(({ row, hash }) => {
    const startedAt = timestamp(row.verified_at);
    const cleanupAt = timestamp(row.cleanup_verified_at);
    const absenceAt = timestamp(
      events.find(
        (event) => event.facts_sha256 === hash && event.attempt_id === row.leased_attempt_id,
      )?.occurred_at,
    );
    const stoppedAt =
      [cleanupAt, absenceAt].filter((value): value is string => value !== null).sort()[0] ?? null;
    const rate = Number(row.actual_hourly_usd);
    const cpu = row.cpu_placement as Record<string, unknown> | null;
    const neverStarted =
      !startedAt &&
      row.has_pod === false &&
      row.launch_outcome !== "CONFIRMED" &&
      row.launch_outcome !== "UNKNOWN";
    return {
      id: String(row.id),
      machine: cpu?.id
        ? `${cpu.vcpuCount} vCPU / ${cpu.memory} GB RAM`
        : String(row.gpu ?? "Cloud GPU"),
      hourly_usd: Number.isFinite(rate) && rate > 0 ? rate : null,
      started_at: startedAt,
      stopped_at: stoppedAt,
      status: neverStarted
        ? "NOT_STARTED"
        : stoppedAt
          ? "STOPPED"
          : startedAt
            ? "RUNNING"
            : "UNCONFIRMED",
    };
  });
  return { observed_at: timestamp(rows[0]?.observed_at) ?? new Date().toISOString(), rentals };
}
