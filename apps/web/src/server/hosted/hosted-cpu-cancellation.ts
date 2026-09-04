const CANCELLATION_SCHEMA = "videoforge-hosted-cpu-cancellation/v1";

export interface HostedCpuCancellationConfirmation {
  readonly schema_version: typeof CANCELLATION_SCHEMA;
  readonly attempt_id: string;
  readonly confirmation: "STOP";
}

/**
 * A per-attempt POST is destructive. Require an exact, attempt-bound confirmation body so an
 * empty POST, a stale UI handler, or a generic request helper cannot stop active media work.
 */
export function exactHostedCpuCancellationConfirmation(
  value: unknown,
  attemptId: string,
): value is HostedCpuCancellationConfirmation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    Object.keys(row).sort().join(",") === "attempt_id,confirmation,schema_version" &&
    row.schema_version === CANCELLATION_SCHEMA &&
    row.attempt_id === attemptId &&
    row.confirmation === "STOP"
  );
}
