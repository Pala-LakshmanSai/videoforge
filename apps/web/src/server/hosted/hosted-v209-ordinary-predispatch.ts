import type { TransactionalSqlExecutor } from "@videoforge/control-plane";

import { HostedDispatchCoordinationError } from "./hosted-serverless-dispatch-coordinator";
import type { V209OrdinaryLiveAdmission } from "../runtime/v209-ordinary-live-cost";

type CommitRow = {
  lane: "mage_image" | "soulx_avatar";
  attempt_id: string;
  dispatch_token: string;
  dispatch_token_sha256: string;
  endpoint_id_sha256: string;
  output_prefix: string;
  request_ttl_seconds: number;
  deadline_at: string | Date;
  reconciliation_deadline_at: string | Date;
} & Record<string, unknown>;

export interface HostedV209OrdinaryPlannedLane {
  readonly lane: "mage_image" | "soulx_avatar";
  readonly attemptId: string;
  readonly dispatchToken: string;
  readonly dispatchTokenSha256: string;
  readonly endpointIdSha256: string;
  readonly outputPrefix: string;
  readonly requestTtlSeconds: number;
  readonly deadlineAt: string;
  readonly reconciliationDeadlineAt: string;
}

function iso(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_PREDISPATCH_INVALID");
  return date.toISOString();
}

/** Calls only the tenant-owned ordinary-project atomic boundary from migration 0074. Browser input
 * never supplies approval, deployment, artifact, request, lease, or generation identities. */
export class HostedSqlV209OrdinaryPredispatch {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  async commit(input: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly userId: string;
    readonly projectId: string;
    readonly admission: V209OrdinaryLiveAdmission;
    readonly dispatchTokenKey: string;
  }): Promise<readonly HostedV209OrdinaryPlannedLane[]> {
    return this.database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        input.accountId,
      ]);
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.dispatch_token_key",
        input.dispatchTokenKey,
      ]);
      const result = await transaction.query<CommitRow>(
        `SELECT * FROM public.videoforge_commit_hosted_v209_ordinary_pair(
          $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb)`,
        [
          input.accountId,
          input.workspaceId,
          input.userId,
          input.projectId,
          JSON.stringify(input.admission),
        ],
      );
      if (
        result.rows.length !== 2 ||
        result.rows[0]?.lane !== "mage_image" ||
        result.rows[1]?.lane !== "soulx_avatar"
      )
        throw new HostedDispatchCoordinationError("HOSTED_V209_ORDINARY_PREDISPATCH_INVALID");
      return Object.freeze(
        result.rows.map((row) =>
          Object.freeze({
            lane: row.lane,
            attemptId: row.attempt_id,
            dispatchToken: row.dispatch_token,
            dispatchTokenSha256: row.dispatch_token_sha256,
            endpointIdSha256: row.endpoint_id_sha256,
            outputPrefix: row.output_prefix,
            requestTtlSeconds: row.request_ttl_seconds,
            deadlineAt: iso(row.deadline_at),
            reconciliationDeadlineAt: iso(row.reconciliation_deadline_at),
          }),
        ),
      );
    });
  }
}
