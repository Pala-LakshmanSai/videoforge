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
import {
  HostedSqlPairRuntimeStore,
  type HostedPairInspection,
} from "../src/server/hosted/hosted-pair-runtime-executor";
import type { V213AcceptanceWorkflowParameters } from "../src/server/hosted/v213-acceptance-workflow-runner";

type Environment = HostedRuntimeEnvironment & HostedPairLiveEnvironment;
type WorkflowParameters = HostedPairWorkflowParameters | V213AcceptanceWorkflowParameters;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DATABASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAX_OBSERVATIONS = 120;
const POOL_CLOSE_GRACE_MS = 1_000;

type ExactPairInspection = readonly [HostedPairInspection, HostedPairInspection];

function exactPairInspection(
  rows: readonly HostedPairInspection[],
): rows is ExactPairInspection {
  return (
    rows.length === 2 &&
    rows[0]?.lane === "mage_image" &&
    rows[1]?.lane === "soulx_avatar"
  );
}

/** A freshly committed ordinary pair has both attempt/outbox rows, but the runtime-state row is
 * intentionally created only by beginSend. Treat that single zero-row projection as uninitialized
 * so the first resume can run its provider preflight; every non-zero malformed projection remains
 * fail-closed. */
async function inspectInitializedHostedPair(
  store: HostedSqlPairRuntimeStore,
  params: HostedPairWorkflowParameters,
): Promise<readonly HostedPairInspection[] | null> {
  const inspection = await store.inspect(params);
  return inspection.length === 0 ? null : inspection;
}

/** A definite REQUEST_REJECTED is cleanup-only, even while the paired lane remains unsent. */
export function isHostedV209CleanupOnlyRecovery(
  rows: readonly HostedPairInspection[],
): boolean {
  if (!exactPairInspection(rows) || !rows.every((row) => row.pairPhase === "CLEANUP_ONLY"))
    return false;
  const [mage, soulx] = rows;
  const terminalFailed = (row: HostedPairInspection) =>
    row.providerJobId === null &&
    row.attemptState === "PERMANENT_FAILED" &&
    row.outboxState === "DEAD_LETTER";
  const unsent = (row: HostedPairInspection) =>
    row.providerJobId === null &&
    row.attemptState === "OUTBOXED" &&
    row.outboxState === "READY_TO_DISPATCH";
  return (
    (terminalFailed(mage) && unsent(soulx)) ||
    (terminalFailed(soulx) && unsent(mage))
  );
}

/** A failed preflight before beginSend leaves both exact lanes safely unsent and retryable. */
export function isHostedV209SafelyUnsent(
  rows: readonly HostedPairInspection[],
): boolean {
  return (
    exactPairInspection(rows) &&
    rows.every(
      (row) =>
        row.providerJobId === null &&
        row.attemptState === "OUTBOXED" &&
        row.outboxState === "READY_TO_DISPATCH" &&
        row.pairPhase !== "CLEANUP_ONLY",
    )
  );
}

async function closePoolsWithoutBlockingWorkflow(
  runtimePool: ReturnType<typeof createNeonPool>,
  reconcilerPool: ReturnType<typeof createNeonPool>,
): Promise<void> {
  const closed = Promise.allSettled([runtimePool.end(), reconcilerPool.end()]);
  await Promise.race([
    closed,
    new Promise<void>((resolve) => setTimeout(resolve, POOL_CLOSE_GRACE_MS)),
  ]);
}

function scope(value: WorkflowParameters): HostedPairWorkflowParameters {
  const ordinary = value as HostedPairWorkflowParameters;
  if (
    Object.keys(value).sort().join(",") !==
      "accountId,cancelAt,generationRequestId,stopAt,workspaceId" ||
    ![ordinary.accountId, ordinary.workspaceId].every((item) => DATABASE_UUID.test(item)) ||
    !UUID.test(ordinary.generationRequestId) ||
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
      console.info("hosted_pair_workflow", { event: "OBSERVATION_STEP_SCHEDULING", observation });
      const result = await step.do(`hosted pair observation ${observation}`, async () => {
        console.info("hosted_pair_workflow", {
          event: "OBSERVATION_STEP_STARTED",
          observation,
        });
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
          console.info("hosted_pair_workflow", { event: "COMPOSITION_STARTING", observation });
          const live = await createHostedPairLiveComposition(
            this.env,
            runtimeDatabase,
            reconcilerDatabase,
            (workflowScope) => renderHandoff.ensure(workflowScope),
          );
          console.info("hosted_pair_workflow", { event: "COMPOSITION_READY", observation });
          if (observation === 0) {
            const ordinary = await hasHostedV209OrdinaryDispatchCandidate(runtimeDatabase, {
              accountId: params.accountId,
              workspaceId: params.workspaceId,
              generationRequestId: params.generationRequestId,
            });
            if (ordinary) {
              const runtimeStore = new HostedSqlPairRuntimeStore(runtimeDatabase);
              const inspection = await inspectInitializedHostedPair(runtimeStore, params);
              if (inspection && isHostedV209CleanupOnlyRecovery(inspection)) {
                // A definite provider rejection is already terminal. The paired unsent lane is
                // intentionally not eligible for ordinary resume; let the reconciler prove
                // absence, settle both lanes, and release the lease without any provider call.
                console.info("hosted_pair_workflow", {
                  event: "CLEANUP_ONLY_RECONCILIATION_STARTING",
                });
              } else {
                const gate = await live.composition.gate({
                  environment: this.env,
                  ...params,
                  dispatchTokenKey: this.env.VIDEOFORGE_DISPATCH_TOKEN_KEY!,
                });
                if (gate.state !== "READY") return gate;
                try {
                  console.info("hosted_pair_workflow", { event: "ORDINARY_RESUME_STARTING" });
                  await resumeHostedV209OrdinaryPair(this.env, runtimeDatabase, params);
                  console.info("hosted_pair_workflow", { event: "ORDINARY_RESUME_COMPLETE" });
                } catch (error) {
                  const afterFailure = await inspectInitializedHostedPair(runtimeStore, params);
                  if (afterFailure === null || isHostedV209SafelyUnsent(afterFailure)) throw error;
                  // SENT/unknown acknowledgement is deliberately not sendable. Stop this
                  // Workflow step durably so an operator can reconcile before any provider action.
                  return Object.freeze({ state: "MANUAL_RECONCILIATION_REQUIRED" as const });
                }
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
          const pastStopDeadline = Date.parse(clock) >= Date.parse(params.stopAt);
          // Give the durable reconciler one final read-only observation at the stop boundary.
          // This is required for an already-assigned provider job that has become definitively
          // absent: it can be settled as failed without redispatch, while unresolved/active work
          // still fails closed to operator reconciliation.
          const observationResult = await live.reconciler.observe(
            params,
            Date.parse(clock) >= Date.parse(params.cancelAt),
          );
          if (pastStopDeadline && observationResult.state !== "SETTLED")
            return Object.freeze({ state: "MANUAL_RECONCILIATION_REQUIRED" as const });
          return observationResult;
        } finally {
          await closePoolsWithoutBlockingWorkflow(runtimePool, reconcilerPool);
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
