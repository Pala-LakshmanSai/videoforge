import type { HostedExecutionContext } from "./auth";
import type { HostedRuntimeConfiguration } from "./configuration";
import { createNeonExecutor, createNeonPool } from "./neon";
import {
  parseHostedJson,
  response,
  sameOrigin,
  sessionScope,
} from "./hosted-product-route-common";
import { exactHostedRenderSubmission, type HostedCpuSubmission } from "./submission";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export async function retryHostedApiRender(
  request: Request,
  projectId: string,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
  dependencies: {
    schedule(input: {
      accountId: string;
      workspaceId: string;
      submission: HostedCpuSubmission;
      expectedAttemptId: string;
      renderRecoveryKey: string;
    }): Promise<{ readonly state: string }>;
  },
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  const body = await parseHostedJson(request, "HOSTED_RENDER_DISK_RETRY_REJECTED", 1024);
  if (body instanceof Response) return body;
  if (
    typeof body !== "object" || body === null || Array.isArray(body) ||
    Object.keys(body).sort().join(",") !== "failed_attempt_id,schema_version" ||
    (body as Record<string, unknown>).schema_version !== "videoforge-hosted-render-disk-retry/v1" ||
    !UUID.test(String((body as Record<string, unknown>).failed_attempt_id))
  ) return response({ error: { code: "HOSTED_RENDER_DISK_RETRY_REJECTED" } }, 400);
  const failedAttemptId = (body as { failed_attempt_id: string }).failed_attempt_id;
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const prepared = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", scope.account_id]);
      const result = await transaction.query<{ recovery: unknown }>(
        "SELECT public.videoforge_prepare_hosted_api_render_recovery($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid) AS recovery",
        [scope.account_id, scope.workspace_id, scope.user_id, projectId, failedAttemptId, crypto.randomUUID()],
      );
      const recovery = result.rows[0]?.recovery as Record<string, unknown> | undefined;
      if (
        recovery?.schema_version !== "videoforge-hosted-render-disk-recovery/v1" ||
        typeof recovery.revision_id !== "string" || !UUID.test(recovery.revision_id) ||
        typeof recovery.retry_attempt_id !== "string" || !UUID.test(recovery.retry_attempt_id) ||
        !["DISK", "IO"].includes(String(recovery.recovery_kind))
      ) throw new Error("HOSTED_RENDER_DISK_RECOVERY_INVALID");
      const plan = await transaction.query<{ payload: unknown }>(
        `SELECT payload FROM public.hosted_render_plans
          WHERE account_id=$1 AND workspace_id=$2 AND project_id=$3 AND project_revision_id=$4`,
        [scope.account_id, scope.workspace_id, projectId, recovery.revision_id],
      );
      const submission = exactHostedRenderSubmission(plan.rows[0]?.payload, projectId, recovery.revision_id);
      if (!submission) throw new Error("HOSTED_RENDER_DISK_RECOVERY_PLAN_INVALID");
      return { retryAttemptId: recovery.retry_attempt_id, recoveryKind: recovery.recovery_kind, submission };
    });
    const scheduled = await dependencies.schedule({
      accountId: scope.account_id,
      workspaceId: scope.workspace_id,
      submission: prepared.submission,
      expectedAttemptId: prepared.retryAttemptId,
      renderRecoveryKey: `render-${prepared.recoveryKind === "IO" ? "io" : "disk"}-recovery:${prepared.submission.projectRevisionId}`,
    });
    if (!["OUTBOXED", "RUNNING", "SUCCEEDED"].includes(scheduled.state))
      return response({ error: { code: "HOSTED_RENDER_DISK_RETRY_STOPPED" }, attempt_id: prepared.retryAttemptId, state: scheduled.state }, 409);
    return response({
      schema_version: "videoforge-hosted-render-disk-retry/v1",
      attempt_id: prepared.retryAttemptId,
      state: scheduled.state,
      provider_calls_authorized: false,
    }, 202);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error &&
      ["23514", "42501", "23505", "55000"].includes(String(error.code)))
      return response({ error: { code: "HOSTED_RENDER_DISK_RETRY_NOT_ELIGIBLE" } }, 409);
    throw error;
  } finally {
    await pool.end();
  }
}
