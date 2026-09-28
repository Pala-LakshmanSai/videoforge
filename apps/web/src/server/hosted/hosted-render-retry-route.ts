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
      executionBackend?: "RUNPOD_POD";
    }): Promise<{ readonly state: string }>;
  },
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  const body = await parseHostedJson(request, "HOSTED_RENDER_DISK_RETRY_REJECTED", 1024);
  if (body instanceof Response) return body;
  const fields = typeof body === "object" && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown> : {};
  const cloudRetry = fields.schema_version === "videoforge-hosted-render-retry/v2" && fields.execution_backend === "RUNPOD_POD";
  if (!UUID.test(String(fields.failed_attempt_id)) ||
    (cloudRetry ? Object.keys(fields).sort().join(",") !== "execution_backend,failed_attempt_id,schema_version"
      : Object.keys(fields).sort().join(",") !== "failed_attempt_id,schema_version" ||
        fields.schema_version !== "videoforge-hosted-render-disk-retry/v1"))
    return response({ error: { code: "HOSTED_RENDER_DISK_RETRY_REJECTED" } }, 400);
  if (cloudRetry && !config.cloudMedia)
    return response({ error: { code: "CLOUD_MEDIA_UNAVAILABLE" } }, 503);
  const failedAttemptId = String(fields.failed_attempt_id);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const prepared = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", scope.account_id]);
      const result = await transaction.query<{ recovery: unknown }>(
        cloudRetry
          ? "SELECT public.videoforge_prepare_cloud_media_render_recovery($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::text) AS recovery"
          : "SELECT public.videoforge_prepare_hosted_api_render_recovery($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::text,$8::text) AS recovery",
        cloudRetry
          ? [scope.account_id, scope.workspace_id, scope.user_id, projectId, failedAttemptId,
              crypto.randomUUID(), config.cloudMedia!.sourceSha256]
          : [scope.account_id, scope.workspace_id, scope.user_id, projectId, failedAttemptId,
              crypto.randomUUID(), config.mediaWorkerRelease.executionBundleSha256, config.mediaWorkerRelease.version],
      );
      const recovery = result.rows[0]?.recovery as Record<string, unknown> | undefined;
      if (
        recovery?.schema_version !== "videoforge-hosted-render-disk-recovery/v1" ||
        typeof recovery.revision_id !== "string" || !UUID.test(recovery.revision_id) ||
        typeof recovery.retry_attempt_id !== "string" || !UUID.test(recovery.retry_attempt_id) ||
        !["DISK", "IO", "INPUT", "PROCESS", "SIGNAL", "OUTPUT", "LOCAL", "CLOUD"].includes(String(recovery.recovery_kind))
      ) throw new Error("HOSTED_RENDER_DISK_RECOVERY_INVALID");
      const plan = await transaction.query<{ payload: unknown }>(
        `SELECT payload FROM public.hosted_render_plans
          WHERE account_id=$1 AND workspace_id=$2 AND project_id=$3 AND project_revision_id=$4`,
        [scope.account_id, scope.workspace_id, projectId, recovery.revision_id],
      );
      const submission = exactHostedRenderSubmission(plan.rows[0]?.payload, projectId, recovery.revision_id);
      if (!submission) throw new Error("HOSTED_RENDER_DISK_RECOVERY_PLAN_INVALID");
      if ((cloudRetry && recovery.recovery_kind !== "CLOUD") || (!cloudRetry && recovery.recovery_kind === "CLOUD") ||
        (["LOCAL", "CLOUD"].includes(String(recovery.recovery_kind)) &&
          recovery.recovery_key !== `render-${String(recovery.recovery_kind).toLowerCase()}-recovery:${recovery.retry_attempt_id}`))
        throw new Error("HOSTED_RENDER_DISK_RECOVERY_INVALID");
      return { retryAttemptId: recovery.retry_attempt_id, recoveryKind: recovery.recovery_kind,
        recoveryKey: recovery.recovery_key, submission };
    });
    const scheduled = await dependencies.schedule({
      accountId: scope.account_id,
      workspaceId: scope.workspace_id,
      submission: prepared.submission,
      expectedAttemptId: prepared.retryAttemptId,
      executionBackend: cloudRetry ? "RUNPOD_POD" : undefined,
      renderRecoveryKey: ["LOCAL", "CLOUD"].includes(String(prepared.recoveryKind)) ? String(prepared.recoveryKey)
        : `render-${String(prepared.recoveryKind).toLowerCase()}-recovery:${prepared.submission.projectRevisionId}`,
    });
    if (!["OUTBOXED", "RUNNING", "SUCCEEDED"].includes(scheduled.state))
      return response({ error: { code: "HOSTED_RENDER_DISK_RETRY_STOPPED" }, attempt_id: prepared.retryAttemptId, state: scheduled.state }, 409);
    return response({
      schema_version: cloudRetry ? "videoforge-hosted-render-retry/v2" : "videoforge-hosted-render-disk-retry/v1",
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
