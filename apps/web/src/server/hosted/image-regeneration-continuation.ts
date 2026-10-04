import type { HostedRuntimeEnvironment, HostedNeonPool } from "./configuration";
import { createNeonExecutor } from "./neon";

/** Restart only existing, settled Workflow invocations with durable resumable jobs.
 * SQL owns tenant/state eligibility; the executor's claim CAS prevents paid replay. */
export async function restartPendingImageRegenerationWorkflows(
  environment: HostedRuntimeEnvironment,
  pool: HostedNeonPool,
): Promise<{ dispatched: string[]; failures: string[] }> {
  const dispatched: string[] = [],
    failures: string[] = [];
  const workflow = environment.HOSTED_PAIR_WORKFLOW;
  if (!workflow) return { dispatched, failures };
  const executor = createNeonExecutor(pool);
  const accounts = await pool.query<{ account_id: string }>(
    "SELECT account_id FROM public.videoforge_admitted_hosted_account_ids()",
  );
  for (const account of accounts.rows) {
    try {
      const rows = await executor.transaction(async (tx) => {
        await tx.query("SELECT set_config($1,$2,true)", [
          "videoforge.account_id",
          account.account_id,
        ]);
        const result = await tx.query<{ value: unknown }>(
          "SELECT public.videoforge_read_pending_hosted_api_image_regenerations() AS value",
        );
        const value = result.rows[0]?.value;
        if (!Array.isArray(value)) throw new Error("HOSTED_IMAGE_REGENERATION_PENDING_INVALID");
        return value as Array<{ id: string; accountId: string; workspaceId: string }>;
      });
      for (const row of rows) {
        if (
          row.accountId !== account.account_id ||
          ![row.id, row.accountId, row.workspaceId].every(
            (id) => typeof id === "string" && /^[0-9a-f-]{36}$/u.test(id),
          )
        ) {
          throw new Error("HOSTED_IMAGE_REGENERATION_PENDING_SCOPE_INVALID");
        }
        try {
          const existing = await workflow.get(`image-regen-${row.id}`);
          const status = await existing.status();
          const state =
            status && typeof status === "object" && !Array.isArray(status)
              ? (status as Record<string, unknown>).status
              : null;
          if (["complete", "errored", "terminated"].includes(String(state))) {
            if (!existing.restart) throw new Error("HOSTED_IMAGE_REGENERATION_RESTART_UNAVAILABLE");
            await existing.restart();
            dispatched.push(`${row.id}:image-regeneration`);
          }
        } catch (error) {
          failures.push(
            `${row.id}:image-regeneration:${String((error as Error).message).slice(0, 120)}`,
          );
        }
      }
    } catch (error) {
      failures.push(
        `${account.account_id}:image-regeneration:${String((error as Error).message).slice(0, 120)}`,
      );
    }
  }
  return { dispatched, failures };
}
