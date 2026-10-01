import type { SqlExecutor } from "@videoforge/control-plane";
import type { HostedRuntimeConfiguration } from "./configuration";

export const LOCAL_MEDIA_HEADROOM_BYTES = 2 * 1024 ** 3;
export const localMediaRequiredBytes = (inputBytes: number) =>
  LOCAL_MEDIA_HEADROOM_BYTES + inputBytes * 2;

export const QUALIFIED_PERSONAL_WORKERS_SQL = `SELECT status, count(*) AS count, max(available_disk_bytes) AS available_disk_bytes
  FROM media_worker_devices
  WHERE account_id=$1 AND workspace_id=$2 AND removed_at IS NULL
    AND status IN ('ONLINE','BUSY')
    AND last_seen_at >= now() - interval '90 seconds'
    AND protocol_version >= $3 AND execution_bundle_sha256=$4
  GROUP BY status`;

export async function qualifiedPersonalWorkers(
  transaction: SqlExecutor,
  release: HostedRuntimeConfiguration["mediaWorkerRelease"],
  accountId: string,
  workspaceId: string,
): Promise<{
  count: number;
  state: "ONLINE" | "BUSY" | "WAITING_FOR_YOUR_COMPUTER";
  availableDiskBytes: number | null;
}> {
  const result = await transaction.query<{
    status: string;
    count: string | number;
    available_disk_bytes?: string | number | null;
  }>(QUALIFIED_PERSONAL_WORKERS_SQL, [
    accountId,
    workspaceId,
    release.minimumProtocolVersion,
    release.executionBundleSha256,
  ]);
  const counts = new Map(result.rows.map((row) => [row.status, Number(row.count)]));
  const online = counts.get("ONLINE") ?? 0,
    busy = counts.get("BUSY") ?? 0;
  const capacities = result.rows
    .flatMap((row) => (row.available_disk_bytes == null ? [] : [Number(row.available_disk_bytes)]))
    .filter((value) => Number.isSafeInteger(value) && value >= 0);
  return {
    availableDiskBytes: capacities.length ? Math.max(...capacities) : null,
    count: online + busy,
    state: online > 0 ? "ONLINE" : busy > 0 ? "BUSY" : "WAITING_FOR_YOUR_COMPUTER",
  };
}
