import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import type { HostedExecutionContext } from "../src/server/hosted/auth";
import type { HostedRuntimeEnvironment } from "../src/server/hosted/configuration";
import {
  ensureHostedPairObservers,
  runHostedContinuation,
  type HostedContinuationTarget,
} from "../src/server/hosted/stage-continuation-sweep";

/**
 * Durable stage-continuation driver (stages 3-8).
 *
 * The per-minute cron in `wrangler.production.jsonc` is registered with Cloudflare but its handler
 * never runs in this deployment: the sweep writes a `hosted_continuation_heartbeats` row on every
 * run and after 40+ minutes there were zero rows. Workflows are delivered in this account (the pair
 * and video workflows run and settle), and a Workflow step may sleep, so continuation is driven by
 * one bounded Workflow instance instead. Each iteration runs the existing sweep, self-heals any
 * running GPU pair that has no observing workflow, then sleeps 60 seconds.
 *
 * `step.do` is durable and its name is the replay key, so the iteration index is part of every step
 * name: a replayed iteration resumes that exact durable step instead of collapsing with its
 * neighbours. One instance covers ~24 hours; `ensureHostedContinuationDriver` restarts a completed
 * instance from the desktop worker's claim poll, which is the one trigger proven to be delivered.
 */
export interface HostedContinuationWorkflowParameters {
  /** Diagnostic only, supplied by the starting caller; the driver never depends on it. */
  readonly reason?: string;
  readonly target?: HostedContinuationTarget;
}

/** 1,440 one-minute iterations: one instance covers roughly 24 hours of cadence. */
export const HOSTED_CONTINUATION_ITERATIONS = 1_440;
export const HOSTED_CONTINUATION_CADENCE = "60 seconds" as const;

const MAXIMUM_REASON_LENGTH = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * Defensive payload validation: any caller that can create an instance controls this value and a
 * replay must never fail because a field is missing, so an unknown payload degrades to "no reason"
 * rather than throwing.
 */
function continuationParameters(value: unknown): HostedContinuationWorkflowParameters {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return Object.freeze({});
  const reason = (value as { readonly reason?: unknown }).reason;
  const target = (value as { readonly target?: unknown }).target;
  if (typeof target === "object" && target !== null && !Array.isArray(target)) {
    const candidate = target as Record<string, unknown>;
    if (
      UUID.test(String(candidate.accountId)) &&
      UUID.test(String(candidate.projectId)) &&
      UUID.test(String(candidate.revisionId)) &&
      (candidate.step === "context" || candidate.step === "prompts")
    ) {
      return Object.freeze({
        reason: "stage-handoff",
        target: {
          accountId: candidate.accountId as string,
          projectId: candidate.projectId as string,
          revisionId: candidate.revisionId as string,
          step: candidate.step as "context" | "prompts",
        },
      });
    }
  }
  if (reason === "stage-handoff" || target !== undefined)
    return Object.freeze({ reason: "invalid-stage-handoff" });
  if (
    typeof reason !== "string" ||
    reason.length < 1 ||
    reason.length > MAXIMUM_REASON_LENGTH ||
    reason.trim() !== reason
  )
    return Object.freeze({});
  return Object.freeze({ reason });
}

function errorMessage(error: unknown): string {
  return String((error as { readonly message?: unknown })?.message ?? error).slice(0, 180);
}

/**
 * A Workflow step has no execution context of its own, but the sweep's stage handlers defer the
 * follow-on stage through `waitUntil` (stage 3 hands stage 4 off that way). Collect those promises
 * and settle them before the durable step ends, otherwise the driver would cut off exactly the
 * handoff that per-request `waitUntil` used to lose.
 */
function drainingExecutionContext(): {
  readonly context: HostedExecutionContext;
  drain(): Promise<void>;
} {
  const deferred: Promise<unknown>[] = [];
  return Object.freeze({
    context: Object.freeze({
      waitUntil(promise: Promise<unknown>): void {
        deferred.push(promise);
      },
    }),
    async drain(): Promise<void> {
      // Drain until quiescent: a handoff may itself defer more work.
      while (deferred.length > 0) {
        const settled = await Promise.allSettled(deferred.splice(0, deferred.length));
        for (const outcome of settled) {
          if (outcome.status === "rejected")
            console.warn("hosted_continuation_workflow", {
              event: "DEFERRED_STAGE_FAILED",
              message: errorMessage(outcome.reason),
            });
        }
      }
    },
  });
}

export class HostedContinuationWorkflow extends WorkflowEntrypoint<
  HostedRuntimeEnvironment,
  HostedContinuationWorkflowParameters
> {
  async run(
    event: Readonly<WorkflowEvent<HostedContinuationWorkflowParameters>>,
    step: WorkflowStep,
  ): Promise<unknown> {
    const params = continuationParameters(event.payload);
    if (params.reason === "invalid-stage-handoff") return { state: "INVALID_TARGET" };
    if (params.target) {
      return step.do(`handoff ${params.target.step}`, async () => {
        const { context, drain } = drainingExecutionContext();
        try {
          return {
            schema_version: "videoforge-hosted-continuation-handoff/v1",
            dispatched: await runHostedContinuation(this.env, context, params.target),
          };
        } finally {
          await drain();
        }
      });
    }
    let iterations = 0;
    let dispatches = 0;
    let pairObservers = 0;
    let failures = 0;
    console.info("hosted_continuation_workflow", {
      event: "STARTED",
      reason: params.reason ?? "unscheduled",
      iterations: HOSTED_CONTINUATION_ITERATIONS,
    });

    for (let iteration = 0; iteration < HOSTED_CONTINUATION_ITERATIONS; iteration += 1) {
      // The iteration index is the replay key. `continuation 7` is a different durable step than
      // `continuation 6`, so a replayed instance resumes where it stopped instead of reusing the
      // first iteration's recorded result for every tick.
      const outcome = await step.do(`continuation ${iteration}`, async () => {
        const { context, drain } = drainingExecutionContext();
        try {
          const dispatched = await runHostedContinuation(this.env, context);
          const observers = await ensureHostedPairObservers(this.env, context);
          return { dispatched: dispatched.length, observers, error: null };
        } catch (error) {
          // One bad tick (a transient database failure, a missing binding) must not kill a
          // 24-hour driver: record it and let the next iteration try again in 60 seconds.
          return { dispatched: 0, observers: 0, error: errorMessage(error) };
        } finally {
          await drain();
        }
      });
      iterations += 1;
      dispatches += outcome.dispatched;
      pairObservers += outcome.observers;
      if (outcome.error !== null) {
        failures += 1;
        console.warn("hosted_continuation_workflow", {
          event: "ITERATION_FAILED",
          iteration,
          message: outcome.error,
        });
      }
      await step.sleep(`wait ${iteration}`, HOSTED_CONTINUATION_CADENCE);
    }

    const summary = Object.freeze({
      schema_version: "videoforge-hosted-continuation-driver/v1" as const,
      state: "BOUNDED_WINDOW_COMPLETE" as const,
      iterations,
      dispatches,
      pair_observers: pairObservers,
      failures,
      reason: params.reason ?? "unscheduled",
    });
    console.info("hosted_continuation_workflow", { event: "COMPLETED", ...summary });
    return summary;
  }
}
