import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { TENANT_PRINCIPAL_SETTING } from "@videoforge/control-plane/vocabulary";

import { CloudRunJobsClient } from "../src/server/hosted/cloud-run";
import {
  hostedRuntimeConfiguration,
  type HostedRuntimeEnvironment,
} from "../src/server/hosted/configuration";
import { deriveCallbackToken, sha256, sha256Bytes } from "../src/server/hosted/crypto";
import { createNeonExecutor, createNeonPool } from "../src/server/hosted/neon";
import { HostedR2Signer } from "../src/server/hosted/r2";

interface HostedWorkflowParameters {
  readonly attemptId: string;
  readonly accountId: string;
  readonly workspaceId: string;
}

interface AttemptRow extends Record<string, unknown> {
  readonly id: string;
  readonly kind: "ASR" | "RENDER";
  readonly state: string;
  readonly job_spec_object_key: string;
  readonly job_spec_content_length: string | number;
  readonly job_spec_checksum_sha256: string;
  readonly callback_token_sha256: string;
  readonly provider_operation_name: string | null;
  readonly provider_execution_name: string | null;
  readonly result_receipt_sha256: string | null;
  readonly result_object_key: string;
  readonly result_max_bytes: string | number;
  readonly deadline_at: Date | string;
}

async function discoverResult(
  environment: HostedRuntimeEnvironment,
  attemptId: string,
  objectKey: string,
  maximum: number,
): Promise<{ length: number; checksum: string; receipt: string } | null> {
  const object = await environment.PRIVATE_ARTIFACTS?.get(objectKey);
  if (!object || object.size < 1 || object.size > maximum) return null;
  const bytes = await object.arrayBuffer();
  if (bytes.byteLength !== object.size) return null;
  try {
    JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  const checksum = await sha256Bytes(bytes);
  const receipt = await sha256(
    JSON.stringify({
      attempt_id: attemptId,
      content_length: bytes.byteLength,
      object_key: objectKey,
      result_checksum_sha256: checksum,
    }),
  );
  return { length: bytes.byteLength, checksum, receipt };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function parameters(value: HostedWorkflowParameters): HostedWorkflowParameters {
  if (![value.attemptId, value.accountId, value.workspaceId].every((item) => UUID.test(item))) {
    throw new TypeError("Hosted Workflow parameters must be exact UUID lineage.");
  }
  return Object.freeze({ ...value });
}

async function withAttempt<Value>(
  environment: HostedRuntimeEnvironment,
  params: HostedWorkflowParameters,
  work: (attempt: AttemptRow, query: ReturnType<typeof createNeonExecutor>) => Promise<Value>,
): Promise<Value> {
  const config = hostedRuntimeConfiguration(environment);
  const pool = createNeonPool(config.neon.databaseUrl);
  const executor = createNeonExecutor(pool);
  try {
    return await executor.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        TENANT_PRINCIPAL_SETTING,
        params.accountId,
      ]);
      const result = await transaction.query<AttemptRow>(
        `SELECT * FROM hosted_cpu_job_attempts
          WHERE id = $1 AND account_id = $2 AND workspace_id = $3
          FOR UPDATE`,
        [params.attemptId, params.accountId, params.workspaceId],
      );
      const attempt = result.rows[0];
      if (!attempt) throw new Error("Hosted CPU attempt is not owned or no longer exists.");
      return work(attempt, transaction as ReturnType<typeof createNeonExecutor>);
    });
  } finally {
    await pool.end();
  }
}

async function appendEvent(
  query: ReturnType<typeof createNeonExecutor>,
  params: HostedWorkflowParameters,
  kind: string,
  factsSha256: string,
): Promise<void> {
  await query.query(
    `INSERT INTO hosted_cpu_job_events (
       id, account_id, workspace_id, attempt_id, sequence, kind, facts_sha256, occurred_at
     ) SELECT md5($1 || ':' || $4 || ':' || (COALESCE(max(sequence), 0) + 1)::text)::uuid,
              $2, $3, $1, COALESCE(max(sequence), 0) + 1, $4, $5, now()
         FROM hosted_cpu_job_events
        WHERE account_id = $2 AND workspace_id = $3 AND attempt_id = $1`,
    [params.attemptId, params.accountId, params.workspaceId, kind, factsSha256],
  );
}

function operationObservation(
  value: unknown,
):
  | { status: "WAIT" }
  | { status: "FAILED"; facts: string }
  | { status: "READY"; executionName: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { status: "FAILED", facts: "MALFORMED_OPERATION" };
  const record = value as Record<string, unknown>;
  if (record.done !== true) return { status: "WAIT" };
  if (record.error !== undefined) return { status: "FAILED", facts: "OPERATION_ERROR" };
  const response = record.response;
  if (typeof response !== "object" || response === null || Array.isArray(response))
    return { status: "FAILED", facts: "OPERATION_RESPONSE_MISSING" };
  const name = (response as Record<string, unknown>).name;
  return typeof name === "string" && name.includes("/executions/")
    ? { status: "READY", executionName: name }
    : { status: "FAILED", facts: "EXECUTION_NAME_MISSING" };
}

function executionObservation(value: unknown): "WAIT" | "SUCCEEDED" | "FAILED" | "CANCELLED" {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "FAILED";
  const record = value as Record<string, unknown>;
  if (typeof record.completionTime !== "string") return "WAIT";
  const succeeded = Number(record.succeededCount ?? 0);
  const failed = Number(record.failedCount ?? 0);
  const cancelled = Number(record.cancelledCount ?? 0);
  if (succeeded === 1 && failed === 0 && cancelled === 0) return "SUCCEEDED";
  if (cancelled > 0) return "CANCELLED";
  return "FAILED";
}

export class HostedVideoWorkflow extends WorkflowEntrypoint<
  HostedRuntimeEnvironment,
  HostedWorkflowParameters
> {
  async run(
    event: Readonly<WorkflowEvent<HostedWorkflowParameters>>,
    step: WorkflowStep,
  ): Promise<unknown> {
    const params = parameters(event.payload);
    const config = hostedRuntimeConfiguration(this.env);
    const callbackToken = await deriveCallbackToken(
      config.workflowCallbackSecret,
      params.attemptId,
    );
    const callbackTokenSha256 = await sha256(callbackToken);

    const prepared = await step.do(
      "prepare exact CPU dispatch",
      { retries: { limit: 2, delay: "2 seconds", backoff: "exponential" }, sensitive: "output" },
      async () =>
        withAttempt(this.env, params, async (attempt) => {
          if (attempt.callback_token_sha256 !== callbackTokenSha256)
            throw new Error("CPU callback authority hash does not match the hosted secret.");
          if (
            !["OUTBOXED", "SUBMITTED", "RUNNING", "RECONCILING", "CANCEL_REQUESTED"].includes(
              attempt.state,
            )
          )
            throw new Error("CPU attempt is not dispatchable or recoverable.");
          return {
            state: attempt.state,
            kind: attempt.kind,
            objectKey: attempt.job_spec_object_key,
            contentLength: Number(attempt.job_spec_content_length),
            checksumSha256: attempt.job_spec_checksum_sha256,
            operationName: attempt.provider_operation_name,
            executionName: attempt.provider_execution_name,
            deadlineAt: new Date(attempt.deadline_at).toISOString(),
          };
        }),
    );

    let operationName = prepared.operationName;
    let executionName = prepared.executionName;
    if (operationName === null && executionName === null && prepared.state === "OUTBOXED") {
      const specPort = await new HostedR2Signer(config.r2).sign({
        method: "GET",
        objectKey: prepared.objectKey,
        contentType: "application/json",
        contentLength: prepared.contentLength,
        checksumSha256: prepared.checksumSha256,
        lifetimeSeconds: 900,
      });
      const dispatch = await step.do(
        "submit Cloud Run CPU job once",
        { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" },
        async () => {
          try {
            const accepted = await new CloudRunJobsClient(config.cloudRun).run({
              attemptId: params.attemptId,
              kind: prepared.kind,
              jobSpecUrl: specPort.url,
              callbackUrl: `${config.publicOrigin}/api/v2/internal/cloud-run/callback/${params.attemptId}`,
              callbackToken,
              taskTimeoutSeconds: Math.max(
                60,
                Math.min(
                  86_400,
                  Math.floor((Date.parse(prepared.deadlineAt) - Date.now()) / 1_000),
                ),
              ),
            });
            return {
              ok: true as const,
              operationName: accepted.providerOperationName,
              operationNameSha256: accepted.operationNameSha256,
            };
          } catch {
            return { ok: false as const, reason: "DISPATCH_ACK_UNKNOWN" as const };
          }
        },
      );
      if (!dispatch.ok) {
        await step.do("persist ambiguous Cloud Run dispatch", async () =>
          withAttempt(this.env, params, async (_attempt, query) => {
            await query.query(
              `UPDATE hosted_cpu_job_attempts SET state = 'RECONCILING', poll_after = now(), version = version + 1, updated_at = now() WHERE id = $1`,
              [params.attemptId],
            );
            await appendEvent(query, params, "REPLAYED", await sha256(dispatch.reason));
            return { state: "RECONCILING" };
          }),
        );
        operationName = null;
      } else {
        operationName = dispatch.operationName;
        await step.do("bind exact Cloud Run operation", async () =>
          withAttempt(this.env, params, async (attempt, query) => {
            if (
              attempt.provider_operation_name &&
              attempt.provider_operation_name !== dispatch.operationName
            )
              throw new Error("Cloud Run operation assignment conflicts with durable truth.");
            await query.query(
              `UPDATE hosted_cpu_job_attempts SET state = 'SUBMITTED', provider_operation_name = $2, provider_operation_name_sha256 = $3, submitted_at = COALESCE(submitted_at, now()), poll_after = now(), version = version + 1, updated_at = now() WHERE id = $1`,
              [params.attemptId, dispatch.operationName, dispatch.operationNameSha256],
            );
            await appendEvent(query, params, "SUBMITTED", dispatch.operationNameSha256);
            return { state: "SUBMITTED" };
          }),
        );
      }
    }

    const client = new CloudRunJobsClient(config.cloudRun);
    for (let poll = 0; poll < 240; poll += 1) {
      const durable = await step.do(`load CPU recovery state ${poll}`, async () =>
        withAttempt(this.env, params, async (attempt) => ({
          state: attempt.state,
          operationName: attempt.provider_operation_name,
          executionName: attempt.provider_execution_name,
          receipt: attempt.result_receipt_sha256,
          resultObjectKey: attempt.result_object_key,
          resultMaxBytes: Number(attempt.result_max_bytes),
          deadlineAt: new Date(attempt.deadline_at).toISOString(),
        })),
      );
      operationName = durable.operationName;
      executionName = durable.executionName;
      if (["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(durable.state))
        return { state: durable.state };
      if (Date.now() >= Date.parse(durable.deadlineAt)) {
        return step.do("expire CPU attempt", async () =>
          withAttempt(this.env, params, async (_attempt, query) => {
            await query.query(
              `UPDATE hosted_cpu_job_attempts SET state = 'EXPIRED', terminal_at = now(), version = version + 1, updated_at = now() WHERE id = $1 AND state NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED')`,
              [params.attemptId],
            );
            await appendEvent(query, params, "EXPIRED", await sha256("DEADLINE_EXPIRED"));
            return { state: "EXPIRED" };
          }),
        );
      }
      if (!operationName && !executionName && durable.state === "RECONCILING") {
        const discoveredExecution = await step.do(
          `reconcile ambiguous Cloud Run dispatch ${poll}`,
          { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
          async () => client.findExecution(prepared.kind, params.attemptId),
        );
        if (discoveredExecution) {
          executionName = discoveredExecution;
          await step.do("bind reconciled Cloud Run execution", async () =>
            withAttempt(this.env, params, async (attempt, query) => {
              if (
                attempt.provider_execution_name &&
                attempt.provider_execution_name !== discoveredExecution
              ) {
                throw new Error("Reconciled Cloud Run execution conflicts with durable truth.");
              }
              const executionHash = await sha256(discoveredExecution);
              await query.query(
                `UPDATE hosted_cpu_job_attempts
                  SET state = 'RUNNING', provider_execution_name = $2,
                      execution_name_sha256 = $3, poll_after = now(),
                      version = version + 1, updated_at = now()
                WHERE id = $1`,
                [params.attemptId, discoveredExecution, executionHash],
              );
              await appendEvent(query, params, "REPLAYED", executionHash);
              return { state: "RUNNING" };
            }),
          );
        }
      }
      if (!executionName && operationName) {
        const observed = operationObservation(
          JSON.parse(
            await step.do(
              `poll Cloud Run operation ${poll}`,
              { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
              async () => JSON.stringify(await client.observeOperation(operationName!)),
            ),
          ),
        );
        if (observed.status === "FAILED") {
          return step.do("fail malformed Cloud Run operation", async () =>
            withAttempt(this.env, params, async (_attempt, query) => {
              await query.query(
                `UPDATE hosted_cpu_job_attempts SET state = 'FAILED', terminal_at = now(), version = version + 1, updated_at = now() WHERE id = $1`,
                [params.attemptId],
              );
              await appendEvent(query, params, "FAILED", await sha256(observed.facts));
              return { state: "FAILED" };
            }),
          );
        }
        if (observed.status === "READY") {
          executionName = observed.executionName;
          await step.do("bind exact Cloud Run execution", async () =>
            withAttempt(this.env, params, async (_attempt, query) => {
              await query.query(
                `UPDATE hosted_cpu_job_attempts SET state = 'RUNNING', provider_execution_name = $2, execution_name_sha256 = $3, poll_after = now(), version = version + 1, updated_at = now() WHERE id = $1`,
                [params.attemptId, executionName, await sha256(executionName!)],
              );
              await appendEvent(query, params, "OBSERVED_RUNNING", await sha256(executionName!));
              return { state: "RUNNING" };
            }),
          );
        }
      } else if (executionName) {
        if (durable.state === "CANCEL_REQUESTED") {
          await step.do(
            `cancel exact Cloud Run execution ${poll}`,
            { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
            async () => client.cancelExecution(executionName!),
          );
        }
        const observed = executionObservation(
          JSON.parse(
            await step.do(
              `poll Cloud Run execution ${poll}`,
              { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
              async () => JSON.stringify(await client.observeExecution(executionName!)),
            ),
          ),
        );
        if (observed !== "WAIT") {
          const discovered =
            observed === "SUCCEEDED" && !durable.receipt
              ? await step.do(
                  `discover exact CPU result ${poll}`,
                  { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
                  async () =>
                    discoverResult(
                      this.env,
                      params.attemptId,
                      durable.resultObjectKey,
                      durable.resultMaxBytes,
                    ),
                )
              : null;
          return step.do("settle CPU execution", async () =>
            withAttempt(this.env, params, async (attempt, query) => {
              if (discovered && !attempt.result_receipt_sha256) {
                await query.query(
                  `UPDATE hosted_cpu_job_attempts
                    SET result_content_length = $2, result_checksum_sha256 = $3,
                        result_receipt_sha256 = $4, version = version + 1, updated_at = now()
                  WHERE id = $1 AND result_receipt_sha256 IS NULL`,
                  [params.attemptId, discovered.length, discovered.checksum, discovered.receipt],
                );
              }
              const state =
                attempt.state === "CANCEL_REQUESTED" || observed === "CANCELLED"
                  ? "CANCELLED"
                  : observed === "SUCCEEDED" && (attempt.result_receipt_sha256 || discovered)
                    ? "SUCCEEDED"
                    : observed === "SUCCEEDED"
                      ? "RECONCILING"
                      : "FAILED";
              await query.query(
                `UPDATE hosted_cpu_job_attempts SET state = $2, terminal_at = CASE WHEN $2 IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN now() ELSE NULL END, poll_after = CASE WHEN $2 = 'RECONCILING' THEN now() + interval '15 seconds' ELSE NULL END, version = version + 1, updated_at = now() WHERE id = $1`,
                [params.attemptId, state],
              );
              await appendEvent(
                query,
                params,
                state === "RECONCILING" ? "POLL_OBSERVATION" : state,
                await sha256(`EXECUTION_${observed}`),
              );
              return { state };
            }),
          );
        }
      }
      await step.sleep(`wait before CPU poll ${poll}`, "15 seconds");
    }
    return { state: "RECONCILING", reason: "BOUNDED_POLL_WINDOW_EXHAUSTED" };
  }
}
