import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import {
  hostedRuntimeConfiguration,
  type HostedRuntimeEnvironment,
} from "../src/server/hosted/configuration";
import { scheduleHostedRenderSubmission } from "../src/server/hosted/app";
import {
  createHostedPairLiveComposition,
  resumeHostedV209OrdinaryPair,
  type HostedPairLiveEnvironment,
  type HostedPairWorkflowParameters,
} from "../src/server/hosted/hosted-pair-live-wiring";
import { hostedPairProductionBindingState } from "../src/server/hosted/hosted-pair-production-composition";
import { createHostedV209RenderHandoff } from "../src/server/hosted/hosted-v209-render-handoff";
import { hasHostedV209OrdinaryDispatchCandidate } from "../src/server/hosted/hosted-v209-queue-admission";
import { createNeonExecutor, createNeonPool } from "../src/server/hosted/neon";
import type { V213AcceptanceWorkflowParameters } from "../src/server/hosted/v213-acceptance-workflow-runner";

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
    if (hostedPairProductionBindingState(this.env).state === "DISABLED_UNQUALIFIED")
      return Object.freeze({ state: "DISABLED_UNQUALIFIED" as const });
    const acceptanceCandidate =
      event.payload &&
      typeof event.payload === "object" &&
      "kind" in event.payload &&
      event.payload.kind === "V213_DATABASE_ACCEPTANCE";
    const acceptance = acceptanceCandidate
      ? (
          await import("../src/server/hosted/v213-acceptance-workflow-runner")
        ).parseV213AcceptanceWorkflowParameters(event.payload)
      : null;
    const pair = acceptanceCandidate ? null : scope(event.payload);
    const config = hostedRuntimeConfiguration(this.env);

    if (acceptance) {
      const [{ V213SqlAcceptanceWorkflowPort }, { runV213DatabaseAcceptanceWorkflow }] =
        await Promise.all([
          import("../src/server/hosted/v213-acceptance-workflow-production"),
          import("../src/server/hosted/v213-acceptance-workflow-runner"),
        ]);
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
          const runtimeDatabase = createNeonExecutor(runtimePool);
          const reconcilerDatabase = createNeonExecutor(reconcilerPool);
          if (!this.env.PRIVATE_ARTIFACTS)
            throw new Error("Hosted pair render artifact binding is missing.");
          const renderHandoff = createHostedV209RenderHandoff({
            database: reconcilerDatabase,
            runtimeDatabase,
            bucket: this.env.PRIVATE_ARTIFACTS,
            schedule: (submission) =>
              scheduleHostedRenderSubmission(this.env, config, {
                accountId: params.accountId,
                workspaceId: params.workspaceId,
                submission,
              }),
          });
          const live = await createHostedPairLiveComposition(
            this.env,
            runtimeDatabase,
            reconcilerDatabase,
            (workflowScope) => renderHandoff.ensure(workflowScope),
          );
          if (observation === 0) {
            const ordinary = await hasHostedV209OrdinaryDispatchCandidate(runtimeDatabase, {
              accountId: params.accountId,
              workspaceId: params.workspaceId,
              generationRequestId: params.generationRequestId,
            });
            if (ordinary) {
              const gate = await live.composition.gate({
                environment: this.env,
                ...params,
                dispatchTokenKey: this.env.VIDEOFORGE_DISPATCH_TOKEN_KEY!,
              });
              if (gate.state !== "READY") return gate;
              try {
                await resumeHostedV209OrdinaryPair(this.env, runtimeDatabase, params);
              } catch {
                // SENT/unknown acknowledgement is deliberately not sendable. Stop this Workflow
                // step durably so an operator can reconcile before any further provider action.
                return Object.freeze({ state: "MANUAL_RECONCILIATION_REQUIRED" as const });
              }
            } else {
              const dispatch = await live.composition.resume({
                environment: this.env,
                ...params,
                dispatchTokenKey: this.env.VIDEOFORGE_DISPATCH_TOKEN_KEY!,
              });
              if (dispatch.state === "DISABLED_UNQUALIFIED") return dispatch;
            }
          }
          const clock = await runtimeDatabase.transaction(async (transaction) => {
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
