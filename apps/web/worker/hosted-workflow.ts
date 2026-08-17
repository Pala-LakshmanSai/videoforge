import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { TENANT_PRINCIPAL_SETTING } from "@videoforge/control-plane/vocabulary";

import {
  hostedRuntimeConfiguration,
  type HostedRuntimeEnvironment,
} from "../src/server/hosted/configuration";
import { sha256 } from "../src/server/hosted/crypto";
import { createNeonExecutor, createNeonPool } from "../src/server/hosted/neon";

interface HostedWorkflowParameters {
  readonly attemptId: string;
  readonly accountId: string;
  readonly workspaceId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function parameters(value: HostedWorkflowParameters): HostedWorkflowParameters {
  if (![value.attemptId, value.accountId, value.workspaceId].every((item) => UUID.test(item))) {
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
            const loaded = await transaction.query<{
              state: string;
              deadline_at: Date | string;
            }>(
              `SELECT state, deadline_at FROM hosted_cpu_job_attempts
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

            await transaction.query(
              `UPDATE media_worker_leases
                  SET state = 'EXPIRED', completed_at = now(), updated_at = now()
                WHERE attempt_id = $1 AND state IN ('CLAIMED', 'RUNNING', 'COMPLETING')
                  AND lease_expires_at <= now()`,
              [params.attemptId],
            );
            const active = await transaction.query(
              `SELECT 1 FROM media_worker_leases
                WHERE attempt_id = $1 AND state IN ('CLAIMED', 'RUNNING', 'COMPLETING')
                  AND lease_expires_at > now()`,
              [params.attemptId],
            );
            if (Date.now() >= new Date(attempt.deadline_at).getTime()) {
              await transaction.query(
                `UPDATE media_worker_leases
                    SET state = 'EXPIRED', completed_at = now(), updated_at = now()
                  WHERE attempt_id = $1 AND state IN ('CLAIMED', 'RUNNING', 'COMPLETING')`,
                [params.attemptId],
              );
              await transaction.query(
                `UPDATE hosted_cpu_job_attempts
                    SET state = 'EXPIRED', terminal_at = now(), retain_until = now() + interval '30 minutes',
                        version = version + 1, updated_at = now()
                  WHERE id = $1`,
                [params.attemptId],
              );
              return "EXPIRED";
            }
            if (!active.rows[0] && attempt.state === "CANCEL_REQUESTED") {
              await transaction.query(
                `UPDATE hosted_cpu_job_attempts
                    SET state = 'CANCELLED', terminal_at = now(),
                        retain_until = GREATEST(deadline_at, now() + interval '30 minutes'),
                        version = version + 1, updated_at = now()
                  WHERE id = $1`,
                [params.attemptId],
              );
              return "CANCELLED";
            }
            if (!active.rows[0] && attempt.state === "RUNNING") {
              await transaction.query(
                `UPDATE hosted_cpu_job_attempts
                    SET state = 'OUTBOXED', terminal_at = NULL,
                        version = version + 1, updated_at = now()
                  WHERE id = $1`,
                [params.attemptId],
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
