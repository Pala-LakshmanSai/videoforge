import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import type { HostedRuntimeEnvironment } from "../src/server/hosted/configuration";
import { hostedPairProductionBindingState } from "../src/server/hosted/hosted-pair-production-composition";
import {
  createHostedPairLiveComposition,
  type HostedPairLiveEnvironment,
  type HostedPairWorkflowParameters,
} from "../src/server/hosted/hosted-pair-live-wiring";
import { createNeonExecutor, createNeonPool } from "../src/server/hosted/neon";
import { V213SqlAcceptanceWorkflowPort } from "../src/server/hosted/v213-acceptance-workflow-production";
import {
  parseV213AcceptanceWorkflowParameters,
  runV213DatabaseAcceptanceWorkflow,
  type V213AcceptanceWorkflowParameters,
} from "../src/server/hosted/v213-acceptance-workflow-runner";

type Environment = HostedRuntimeEnvironment & HostedPairLiveEnvironment;
type WorkflowParameters = HostedPairWorkflowParameters | V213AcceptanceWorkflowParameters;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_OBSERVATIONS = 120;

function scope(value: WorkflowParameters): HostedPairWorkflowParameters {
  const ordinary = value as HostedPairWorkflowParameters;
  if (
    Object.keys(value).sort().join(",") !==
      "accountId,cancelAt,generationRequestId,stopAt,workspaceId" ||
    ![ordinary.accountId, ordinary.workspaceId, ordinary.generationRequestId].every((item) =>
      UUID.test(item),
    ) ||
    !Number.isFinite(Date.parse(ordinary.cancelAt)) ||
    !Number.isFinite(Date.parse(ordinary.stopAt)) ||
    Date.parse(ordinary.stopAt) - Date.parse(ordinary.cancelAt) !== 10 * 60 * 1_000
  )
    throw new TypeError("Hosted pair Workflow requires exact UUID lineage.");
  return Object.freeze({ ...ordinary });
}

/** Durable paid-pair coordinator. The checked-in binding is disabled, so its first branch makes
 * no database or provider call. Once separately activated, the first idempotent step resumes the
 * 0043 Mage-then-SoulX boundary; later steps only observe, cancel exact known jobs, and settle. */
export class HostedPairWorkflow extends WorkflowEntrypoint<Environment, WorkflowParameters> {
  async run(event: Readonly<WorkflowEvent<WorkflowParameters>>, step: WorkflowStep) {
    const acceptance =
      event.payload &&
      typeof event.payload === "object" &&
      "kind" in event.payload &&
      event.payload.kind === "V213_DATABASE_ACCEPTANCE"
        ? parseV213AcceptanceWorkflowParameters(event.payload)
        : null;
    const pair = acceptance ? null : scope(event.payload);
    if (hostedPairProductionBindingState(this.env).state === "DISABLED_UNQUALIFIED")
      return Object.freeze({ state: "DISABLED_UNQUALIFIED" as const });

    if (acceptance) {
      const runtimePool = createNeonPool(this.env.DATABASE_URL!);
      const reconcilerPool = createNeonPool(this.env.VIDEOFORGE_RECONCILER_DATABASE_URL!);
      try {
        return await runV213DatabaseAcceptanceWorkflow(
          acceptance,
          step,
          new V213SqlAcceptanceWorkflowPort(
            this.env,
            createNeonExecutor(runtimePool),
            createNeonExecutor(reconcilerPool),
          ),
        );
      } finally {
        await Promise.allSettled([runtimePool.end(), reconcilerPool.end()]);
      }
    }

    const params = pair!;

    for (let observation = 0; observation < MAX_OBSERVATIONS; observation += 1) {
      const result = await step.do(`hosted pair observation ${observation}`, async () => {
        const runtimePool = createNeonPool(this.env.DATABASE_URL!);
        const reconcilerPool = createNeonPool(this.env.VIDEOFORGE_RECONCILER_DATABASE_URL!);
        try {
          const live = await createHostedPairLiveComposition(
            this.env,
            createNeonExecutor(runtimePool),
            createNeonExecutor(reconcilerPool),
          );
          if (observation === 0) {
            const dispatch = await live.composition.resume({
              environment: this.env,
              ...params,
              dispatchTokenKey: this.env.VIDEOFORGE_DISPATCH_TOKEN_KEY!,
            });
            if (dispatch.state === "DISABLED_UNQUALIFIED") return dispatch;
          }
          const clock = await createNeonExecutor(runtimePool).transaction(async (transaction) => {
            const result = await transaction.query<{ database_now: string | Date }>(
              "SELECT transaction_timestamp() AS database_now",
            );
            const value = result.rows[0]?.database_now;
            if (result.rows.length !== 1 || value === undefined)
              throw new Error("Hosted pair database clock unavailable.");
            return new Date(value).toISOString();
          });
          if (Date.parse(clock) >= Date.parse(params.stopAt))
            return Object.freeze({ state: "MANUAL_RECONCILIATION_REQUIRED" as const });
          return live.reconciler.observe(params, Date.parse(clock) >= Date.parse(params.cancelAt));
        } finally {
          await Promise.allSettled([runtimePool.end(), reconcilerPool.end()]);
        }
      });
      if (
        result.state === "SETTLED" ||
        result.state === "DISABLED_UNQUALIFIED" ||
        result.state === "MANUAL_RECONCILIATION_REQUIRED"
      )
        return result;
      if (observation + 1 < MAX_OBSERVATIONS)
        await step.sleep(`wait for hosted pair ${observation}`, "30 seconds");
    }
    return Object.freeze({ state: "MANUAL_RECONCILIATION_REQUIRED" as const });
  }
}
