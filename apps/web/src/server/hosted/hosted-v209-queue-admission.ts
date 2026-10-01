import type { SqlExecutor, TransactionalSqlExecutor } from "@videoforge/control-plane";

export const HOSTED_CLOUD_CLEANUP_PENDING_MESSAGE =
  "An earlier project's Cloud cleanup is unconfirmed. New work is paused until cleanup is verified.";

export async function hostedAccountCleanupPending(
  transaction: SqlExecutor,
  accountId: string,
  workspaceId: string,
  projectId: string | null = null,
  executionBackend: "PERSONAL_WORKER" | "RUNPOD_POD" = "RUNPOD_POD",
): Promise<boolean> {
  const result = await transaction.query<{ pending: boolean } & Record<string, unknown>>(
    `SELECT EXISTS(SELECT 1 FROM cloud_media_reservations r
 WHERE r.account_id=$1 AND r.workspace_id=$2 AND r.state IN ('AMBIGUOUS','STOPPING')
 AND r.cleanup_verified_at IS NULL AND ($3::uuid IS NULL OR r.project_id<>$3::uuid)
 AND ($4::text<>'PERSONAL_WORKER' OR NOT public.videoforge_cloud_cleanup_only(r.id))) AS pending`,
    [accountId, workspaceId, projectId, executionBackend],
  );
  return result.rows[0]?.pending === true;
}

export interface HostedV209AdmissionIdentity {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly projectId: string;
}

export interface HostedV209AdmissionResult {
  readonly generationRequestId: string;
  readonly state: "ACTIVE" | "WAITING";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function exactAdmission(value: unknown): HostedV209AdmissionResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("HOSTED_V209_ADMISSION_RESULT_INVALID");
  const result = value as Record<string, unknown>;
  if (
    typeof result.generationRequestId !== "string" ||
    !UUID.test(result.generationRequestId) ||
    (result.state !== "ACTIVE" && result.state !== "WAITING")
  )
    throw new Error("HOSTED_V209_ADMISSION_RESULT_INVALID");
  return Object.freeze({
    generationRequestId: result.generationRequestId,
    state: result.state,
  });
}

/** The hosted login has SELECT-only queue table ACLs. All queue mutations stay behind the
 * narrowly granted SECURITY DEFINER function whose SQL owns tenant, fairness, cap, audit,
 * idempotency, and lease checks. */
export async function ensureHostedV209GenerationAdmission(
  database: TransactionalSqlExecutor,
  identity: HostedV209AdmissionIdentity,
): Promise<HostedV209AdmissionResult> {
  return database.transaction(async (transaction) => {
    await transaction.query("SELECT set_config($1,$2,true)", [
      "videoforge.account_id",
      identity.accountId,
    ]);
    const result = await transaction.query<{ admission: unknown } & Record<string, unknown>>(
      `SELECT public.videoforge_admit_hosted_v209_generation($1::uuid,$2::uuid,$3::uuid,$4::uuid)
                AS admission`,
      [identity.accountId, identity.workspaceId, identity.userId, identity.projectId],
    );
    if (result.rows.length !== 1) throw new Error("HOSTED_V209_ADMISSION_RESULT_INVALID");
    return exactAdmission(result.rows[0]?.admission);
  });
}

export async function hasHostedV209OrdinaryDispatchCandidate(
  database: TransactionalSqlExecutor,
  input: Pick<HostedV209AdmissionIdentity, "accountId" | "workspaceId"> & {
    readonly generationRequestId: string;
  },
): Promise<boolean> {
  return database.transaction(async (transaction) => {
    await transaction.query("SELECT set_config($1,$2,true)", [
      "videoforge.account_id",
      input.accountId,
    ]);
    const result = await transaction.query<{ present: boolean } & Record<string, unknown>>(
      `SELECT public.videoforge_has_hosted_v209_ordinary_candidate($1::uuid,$2::uuid,$3::uuid)
                AS present`,
      [input.accountId, input.workspaceId, input.generationRequestId],
    );
    return result.rows.length === 1 && result.rows[0]?.present === true;
  });
}
