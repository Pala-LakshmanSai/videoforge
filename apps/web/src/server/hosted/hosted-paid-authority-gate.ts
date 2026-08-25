import type {
  SqlExecutor,
  SqlPrimitive,
  TransactionalSqlExecutor,
} from "@videoforge/control-plane";

import {
  dispatchHostedPreparedGeneration,
  HostedDispatchCoordinationError,
  type HostedPaidAuthorityClaim,
  type HostedPaidAuthorityGate,
} from "./hosted-serverless-dispatch-coordinator";

const CLAIM_FUNCTION = "public.videoforge_claim_hosted_paid_dispatch";

type ClaimRow = {
  readonly approval_id: string;
  readonly approval_sha256: string;
  readonly claim_id: string;
  readonly account_id: string;
  readonly workspace_id: string;
  readonly generation_request_id: string;
  readonly total_cap_usd: string | number;
  readonly cumulative_reservation_usd: string | number;
  readonly expires_at: string | Date;
  readonly claimed_at: string | Date;
} & Record<string, unknown>;

function timestamp(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new HostedDispatchCoordinationError("HOSTED_SERVERLESS_PAID_AUTHORITY_CLAIM_INVALID");
  }
  return parsed.toISOString();
}

/** Concrete composition used by a future authenticated route once the remaining activation gates
 * are satisfied. Keeping the database dependency explicit prevents a caller from substituting the
 * former in-memory/time-trusting claim seam. */
export function dispatchHostedPreparedGenerationWithSqlAuthority(
  input: Omit<Parameters<typeof dispatchHostedPreparedGeneration>[0], "paidAuthorityGate"> & {
    readonly database: TransactionalSqlExecutor;
  },
) {
  return dispatchHostedPreparedGeneration({
    scope: input.scope,
    generationRequestId: input.generationRequestId,
    inspection: input.inspection,
    runtime: input.runtime,
    now: input.now,
    paidAuthorityGate: new HostedSqlPaidAuthorityGate(input.database),
  });
}

/**
 * The runtime owns no authority-table DML. Its only capability is the migration-owned atomic
 * claim routine, which rechecks tenant, current lease, two-lane deployment lineage, cap, and expiry
 * against PostgreSQL transaction time before appending the single claim.
 */
export class HostedSqlPaidAuthorityGate implements HostedPaidAuthorityGate {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  claimOnce(input: Parameters<HostedPaidAuthorityGate["claimOnce"]>[0]) {
    return this.database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        input.scope.accountId,
      ]);
      const laneBindings = input.lanes.map((lane) => ({
        lane: lane.lane,
        checkpoint_id: lane.checkpointId,
        operations: lane.operations,
        resources: lane.resources,
        deployment_id: lane.deploymentId,
        endpoint_id_sha256: lane.endpointIdSha256,
        endpoint_config_sha256: lane.endpointConfigSha256,
        worker_image_digest: lane.workerImageDigest,
        model_manifest_sha256: lane.modelManifestSha256,
        volume_id_sha256: lane.volumeIdSha256,
        volume_manifest_sha256: lane.volumeManifestSha256,
        deployment_snapshot_sha256: lane.deploymentSnapshotSha256,
      }));
      const result = await this.#query<ClaimRow>(
        transaction,
        `SELECT approval_id, approval_sha256, claim_id, account_id, workspace_id,
                generation_request_id, total_cap_usd, cumulative_reservation_usd,
                expires_at, claimed_at
           FROM ${CLAIM_FUNCTION}(
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::numeric,$13::numeric,$14::timestamptz
           )`,
        [
          input.approvalId,
          input.approvalSha256,
          input.claimId,
          input.scope.accountId,
          input.scope.workspaceId,
          input.projectId,
          input.projectRevisionId,
          input.generationRequestId,
          input.generationPlanSha256,
          input.leaseId,
          JSON.stringify(laneBindings),
          input.totalCapUsd,
          input.cumulativeReservationUsd,
          input.expiresAt,
        ],
      );
      if (result.rows.length !== 1) {
        throw new HostedDispatchCoordinationError("HOSTED_SERVERLESS_PAID_AUTHORITY_CLAIM_INVALID");
      }
      return this.#claim(result.rows[0]!);
    });
  }

  #query<Row extends Record<string, unknown>>(
    transaction: SqlExecutor,
    sql: string,
    parameters: readonly SqlPrimitive[],
  ) {
    return transaction.query<Row>(sql, parameters);
  }

  #claim(row: ClaimRow): HostedPaidAuthorityClaim {
    const totalCapUsd = Number(row.total_cap_usd);
    const cumulativeReservationUsd = Number(row.cumulative_reservation_usd);
    if (!Number.isFinite(totalCapUsd) || !Number.isFinite(cumulativeReservationUsd)) {
      throw new HostedDispatchCoordinationError("HOSTED_SERVERLESS_PAID_AUTHORITY_CLAIM_INVALID");
    }
    return Object.freeze({
      approvalId: row.approval_id,
      approvalSha256: row.approval_sha256 as HostedPaidAuthorityClaim["approvalSha256"],
      claimId: row.claim_id,
      accountId: row.account_id,
      workspaceId: row.workspace_id,
      generationRequestId: row.generation_request_id,
      totalCapUsd,
      cumulativeReservationUsd,
      expiresAt: timestamp(row.expires_at),
      claimedAt: timestamp(row.claimed_at),
    });
  }
}
