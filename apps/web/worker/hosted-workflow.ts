import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { TENANT_PRINCIPAL_SETTING } from "@videoforge/control-plane/vocabulary";

import {
  hostedRuntimeConfiguration,
  type HostedRuntimeEnvironment,
} from "../src/server/hosted/configuration";
import { sha256 } from "../src/server/hosted/crypto";
import { createNeonExecutor, createNeonPool } from "../src/server/hosted/neon";
import { hostedPairProductionBindingState } from "../src/server/hosted/hosted-pair-production-composition";

interface HostedWorkflowParameters {
  readonly attemptId: string;
  readonly accountId: string;
  readonly workspaceId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DATABASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function parameters(value: HostedWorkflowParameters): HostedWorkflowParameters {
  if (
    !UUID.test(value.attemptId) ||
    ![value.accountId, value.workspaceId].every((item) => DATABASE_UUID.test(item))
  ) {
    throw new TypeError("Hosted Workflow parameters must be exact UUID lineage.");
  }
  return Object.freeze({ ...value });
}

/**
 * Cloudflare remains the durable coordinator, but it no longer dispatches or observes a paid
 * compute provider. Personal workers claim account-owned attempts through outbound HTTPS. The
 * workflow only repairs abandoned leases, settles queued cancellation, and enforces deadlines.
 */
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
    // Provider-free activation seam. Production remains DISABLED_UNQUALIFIED, which returns before
    // reading any paid-pair secret binding or constructing a provider transport.
    hostedPairProductionBindingState(this.env);

    // Five-minute lease granularity keeps the complete 24-hour offline window inside a bounded
    // 290-observation Workflow while still repairing an abandoned device promptly. The final
    // observation occurs after the deadline instead of sleeping out of the loop with live work.
    for (let observation = 0; observation < 290; observation += 1) {
      const state = await step.do(`reconcile personal worker ${observation}`, async () => {
        const pool = createNeonPool(config.neon.databaseUrl);
        try {
          return await createNeonExecutor(pool).transaction(async (transaction) => {
            await transaction.query("SELECT set_config($1, $2, true)", [
              TENANT_PRINCIPAL_SETTING,
              params.accountId,
            ]);
            const appendJobEvent = async (
              kind: "CANCELLED" | "EXPIRED" | "FAILED" | "REPLAYED",
              facts: `sha256:${string}`,
            ) => {
              await transaction.query(
                `INSERT INTO hosted_cpu_job_events (
                   id, account_id, workspace_id, attempt_id, sequence, kind, facts_sha256, occurred_at
                 ) SELECT md5($1::text || ':' || $4::text || ':' || (COALESCE(max(sequence), 0) + 1)::text)::uuid,
                          $2::uuid, $3::uuid, $1::uuid, COALESCE(max(sequence), 0) + 1, $4, $5, now()
                    FROM hosted_cpu_job_events
                   WHERE account_id = $2::uuid AND workspace_id = $3::uuid AND attempt_id = $1::uuid`,
                [params.attemptId, params.accountId, params.workspaceId, kind, facts],
              );
            };
            const appendWorkerExpiryEvents = async (
              leases: readonly { readonly id: string; readonly device_id: string }[],
            ) => {
              for (const lease of leases) {
                const facts = await sha256(
                  JSON.stringify({
                    attempt_id: params.attemptId,
                    device_id: lease.device_id,
                    lease_id: lease.id,
                    reason: "LEASE_EXPIRED",
                    schema_version: "videoforge-personal-worker-lease-expired/v1",
                  }),
                );
                await transaction.query(
                  `SELECT id
                     FROM media_worker_devices
                    WHERE id = $1 AND account_id = $2 AND workspace_id = $3
                    FOR UPDATE`,
                  [lease.device_id, params.accountId, params.workspaceId],
                );
                await transaction.query(
                  `INSERT INTO media_worker_events (
                     id, account_id, workspace_id, device_id, lease_id, sequence, kind,
                     facts_sha256, occurred_at
                   ) SELECT md5($1::text || ':expired:' || (COALESCE(max(sequence), 0) + 1)::text)::uuid,
                            $2::uuid, $3::uuid, $4::uuid, $1::uuid,
                            COALESCE(max(sequence), 0) + 1, 'EXPIRED', $5, now()
                      FROM media_worker_events
                     WHERE account_id = $2::uuid AND workspace_id = $3::uuid AND device_id = $4::uuid`,
                  [lease.id, params.accountId, params.workspaceId, lease.device_id, facts],
                );
              }
            };
            const loaded = await transaction.query<{
              state: string;
              deadline_at: Date | string;
              replay_count: number;
            }>(
              `SELECT state, deadline_at, replay_count FROM hosted_cpu_job_attempts
                WHERE id = $1 AND account_id = $2 AND workspace_id = $3
                  AND execution_backend = 'PERSONAL_WORKER'
                FOR UPDATE`,
              [params.attemptId, params.accountId, params.workspaceId],
            );
            const attempt = loaded.rows[0];
            if (!attempt)
              throw new Error("Personal worker attempt is not owned or no longer exists.");
            if (["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(attempt.state)) {
              return attempt.state;
            }

            const expiredLeases = await transaction.query<{
              id: string;
              device_id: string;
            }>(
              `UPDATE media_worker_leases
                  SET state = 'EXPIRED', completed_at = now(), updated_at = now()
                WHERE attempt_id = $1 AND state IN ('CLAIMED', 'RUNNING', 'COMPLETING')
                  AND lease_expires_at <= now()
                RETURNING id, device_id`,
              [params.attemptId],
            );
            await appendWorkerExpiryEvents(expiredLeases.rows);
            const active = await transaction.query(
              `SELECT 1 FROM media_worker_leases
                WHERE attempt_id = $1 AND state IN ('CLAIMED', 'RUNNING', 'COMPLETING')
                  AND lease_expires_at > now()`,
              [params.attemptId],
            );
            const databaseClock = await transaction.query<{ observed_at: Date | string }>(
              `SELECT now() AS observed_at`,
            );
            if (
              new Date(databaseClock.rows[0]!.observed_at).getTime() >=
              new Date(attempt.deadline_at).getTime()
            ) {
              const deadlineLeases = await transaction.query<{
                id: string;
                device_id: string;
              }>(
                `UPDATE media_worker_leases
                    SET state = 'EXPIRED', completed_at = now(), updated_at = now()
                  WHERE attempt_id = $1 AND state IN ('CLAIMED', 'RUNNING', 'COMPLETING')
                  RETURNING id, device_id`,
                [params.attemptId],
              );
              await appendWorkerExpiryEvents(deadlineLeases.rows);
              await transaction.query(
                `UPDATE hosted_cpu_job_attempts
                    SET state = 'EXPIRED', submitted_at = COALESCE(submitted_at, now()),
                        terminal_at = now(), retain_until = now() + interval '30 minutes',
                        version = version + 1, updated_at = now()
                  WHERE id = $1`,
                [params.attemptId],
              );
              await appendJobEvent(
                "EXPIRED",
                await sha256(
                  JSON.stringify({
                    attempt_id: params.attemptId,
                    reason: "DEADLINE_REACHED",
                    schema_version: "videoforge-hosted-cpu-expired/v1",
                  }),
                ),
              );
              return "EXPIRED";
            }
            if (!active.rows[0] && attempt.state === "CANCEL_REQUESTED") {
              await transaction.query(
                `UPDATE hosted_cpu_job_attempts
                    SET state = 'CANCELLED', submitted_at = COALESCE(submitted_at, now()),
                        terminal_at = now(),
                        retain_until = GREATEST(deadline_at, now() + interval '30 minutes'),
                        version = version + 1, updated_at = now()
                  WHERE id = $1`,
                [params.attemptId],
              );
              await appendJobEvent(
                "CANCELLED",
                await sha256(
                  JSON.stringify({
                    attempt_id: params.attemptId,
                    reason: "CANCEL_REQUESTED_WITH_NO_ACTIVE_LEASE",
                    schema_version: "videoforge-hosted-cpu-cancelled/v1",
                  }),
                ),
              );
              return "CANCELLED";
            }
            if (!active.rows[0] && attempt.state === "RUNNING") {
              if (Number(attempt.replay_count) >= 32) {
                await transaction.query(
                  `UPDATE hosted_cpu_job_attempts
                      SET state = 'FAILED', failure_code = 'PERSONAL_WORKER_REPLAY_LIMIT',
                          submitted_at = COALESCE(submitted_at, now()), terminal_at = now(),
                          retain_until = GREATEST(deadline_at, now() + interval '30 minutes'),
                          version = version + 1, updated_at = now()
                    WHERE id = $1`,
                  [params.attemptId],
                );
                await appendJobEvent(
                  "FAILED",
                  await sha256(
                    JSON.stringify({
                      attempt_id: params.attemptId,
                      reason: "PERSONAL_WORKER_REPLAY_LIMIT",
                      schema_version: "videoforge-hosted-cpu-failed/v1",
                    }),
                  ),
                );
                return "FAILED";
              }
              await transaction.query(
                `UPDATE hosted_cpu_job_attempts
                    SET state = 'OUTBOXED', submitted_at = NULL, terminal_at = NULL,
                        replay_count = replay_count + 1,
                        version = version + 1, updated_at = now()
                  WHERE id = $1`,
                [params.attemptId],
              );
              await appendJobEvent(
                "REPLAYED",
                await sha256(
                  JSON.stringify({
                    attempt_id: params.attemptId,
                    reason: "ABANDONED_PERSONAL_WORKER_LEASE",
                    schema_version: "videoforge-hosted-cpu-replayed/v1",
                  }),
                ),
              );
              return "OUTBOXED";
            }
            return attempt.state;
          });
        } finally {
          await pool.end();
        }
      });

      if (["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(state)) return { state };
      if (observation < 289) {
        await step.sleep(`wait for account-owned worker ${observation}`, "5 minutes");
      }
    }
    return {
      state: "WAITING_FOR_PERSONAL_WORKER",
      facts_sha256: await sha256(`bounded-observation-window:${params.attemptId}`),
    };
  }
}
