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
 * neighbours. One instance covers ~24 hours. CPU submission starts it for either backend; desktop claim polling
 * remains a recovery trigger. Cloud reservations are independently swept on every driver tick.
 */
export interface HostedContinuationWorkflowParameters {
  /** Diagnostic only, supplied by the starting caller; the driver never depends on it. */
  readonly reason?: string;
  readonly scriptProject?: { accountId: string; workspaceId: string; projectId: string };
  readonly voiceover?: { accountId: string; workspaceId: string; jobId: string };
  readonly target?: HostedContinuationTarget;
}

/** 1,440 one-minute iterations: one instance covers roughly 24 hours of cadence. */
export const HOSTED_CONTINUATION_ITERATIONS = 1_440;
export const HOSTED_CONTINUATION_CADENCE = "60 seconds" as const;
/** Bounds one prompt handoff while the minute driver remains its fallback. */
export const HOSTED_PROMPT_HANDOFF_STEPS = 512;

const MAXIMUM_REASON_LENGTH = 120;
// Postgres accepts UUID values without RFC version/variant bits; admitted account IDs include them.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Defensive payload validation: any caller that can create an instance controls this value and a
 * replay must never fail because a field is missing, so an unknown payload degrades to "no reason"
 * rather than throwing.
 */
function continuationParameters(value: unknown): HostedContinuationWorkflowParameters {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return Object.freeze({});
  const reason = (value as { readonly reason?: unknown }).reason;
  if (reason === "script-project") {
    const target = (value as { scriptProject?: Record<string, unknown> }).scriptProject;
    if (
      target &&
      UUID.test(String(target.accountId)) &&
      UUID.test(String(target.workspaceId)) &&
      UUID.test(String(target.projectId))
    )
      return {
        reason,
        scriptProject: target as { accountId: string; workspaceId: string; projectId: string },
      };
    return { reason: "invalid-stage-handoff" };
  }
  const voiceover = (value as { voiceover?: unknown }).voiceover;
  if (reason === "voiceover-observer") {
    const v = voiceover as Record<string, unknown> | undefined;
    if (
      v &&
      UUID.test(String(v.accountId)) &&
      UUID.test(String(v.workspaceId)) &&
      UUID.test(String(v.jobId))
    )
      return { reason, voiceover: v as { accountId: string; workspaceId: string; jobId: string } };
    return { reason: "invalid-stage-handoff" };
  }
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
    const qualificationOnly = (
      await import("../src/server/hosted/cloud-media-qualification")
    ).cloudMediaQualificationOnly(this.env);
    if (params.reason === "invalid-stage-handoff") return { state: "INVALID_TARGET" };
    if (params.scriptProject) {
      if (qualificationOnly) return { state: "QUALIFICATION_PROVIDER_INERT" };
      const { advanceScriptProject, recordScriptProjectRetry } = await import(
        "../src/server/hosted/script-projects"
      );
      for (let tick = 0; tick < 1440; tick++) {
        const state = await step.do(
          `script project ${tick}`,
          { retries: { limit: 0, delay: "1 second", backoff: "constant" } },
          async () => {
            const { context, drain } = drainingExecutionContext();
            try {
              return await advanceScriptProject(this.env, params.scriptProject!, context);
            } catch {
              await recordScriptProjectRetry(this.env, params.scriptProject!);
              return "PENDING";
            } finally {
              await drain();
            }
          },
        );
        if (["COMPLETE", "FAILED", "CANCELLED", "UNKNOWN_NO_RETRY", "MISSING"].includes(state))
          return { state };
        await step.sleep(
          `script project wait ${tick}`,
          state === "GENERATING" ? "5 seconds" : "60 seconds",
        );
      }
      return { state: "DEFERRED_TO_DRIVER" };
    }
    if (params.voiceover) {
      if (qualificationOnly) return { state: "QUALIFICATION_PROVIDER_INERT" };
      const { observeJ1Voiceover } = await import("../src/server/hosted/j1tts");
      for (let tick = 0; tick < 240; tick++) {
        const state = await step.do(
          `voiceover observation ${tick}`,
          { retries: { limit: 0, delay: "1 second", backoff: "constant" } },
          async () => {
            try {
              return await observeJ1Voiceover(this.env, params.voiceover!);
            } catch {
              return "PROCESSING";
            }
          },
        );
        if (!["SUBMITTING", "PROCESSING"].includes(state)) return { state };
        await step.sleep(`voiceover wait ${tick}`, "15 seconds");
      }
      return { state: "OBSERVATION_DEADLINE" };
    }
    if (qualificationOnly && params.target) return { state: "QUALIFICATION_PROVIDER_INERT" };
    if (params.target) {
      if (params.target.step !== "prompts") {
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
      let previousAccepted = -1;
      let dispatched: string[] = [];
      for (let batch = 0; batch < HOSTED_PROMPT_HANDOFF_STEPS; batch += 1) {
        // A failed paid step must not be replayed by Workflow. The next iteration or minute driver
        // can inspect the durable claim through the route's retrieval-only path.
        const outcome = await step.do(
          `handoff prompts ${batch}`,
          { retries: { limit: 0, delay: "1 second", backoff: "constant" } },
          async () => {
            const { context, drain } = drainingExecutionContext();
            let running = false;
            let accepted = -1;
            try {
              const rows = await runHostedContinuation(
                this.env,
                context,
                params.target,
                async (response) => {
                  if (response.status !== 202) return;
                  const body = (await response.clone().json()) as {
                    state?: unknown;
                    accepted_batch_count?: unknown;
                  };
                  running = body.state === "RUNNING";
                  if (typeof body.accepted_batch_count === "number")
                    accepted = body.accepted_batch_count;
                },
              );
              return { rows, running, accepted };
            } finally {
              await drain();
            }
          },
        );
        dispatched = outcome.rows;
        if (!outcome.running) break;
        if (outcome.accepted <= previousAccepted)
          await step.sleep(`prompt claim wait ${batch}`, "20 seconds");
        previousAccepted = outcome.accepted;
      }
      return { schema_version: "videoforge-hosted-continuation-handoff/v1", dispatched };
    }
    let iterations = 0;
    let dispatches = 0;
    let pairObservers = 0;
    let failures = 0;
    let cloudPending = 0;
    let cloudObservationUncertain = false;
    console.info("hosted_continuation_workflow", {
      event: "STARTED",
      reason: params.reason ?? "unscheduled",
      iterations: HOSTED_CONTINUATION_ITERATIONS,
    });

    for (let iteration = 0; iteration < HOSTED_CONTINUATION_ITERATIONS; iteration += 1) {
      // The iteration index is the replay key. `continuation 7` is a different durable step than
      // `continuation 6`, so a replayed instance resumes where it stopped instead of reusing the
      // first iteration's recorded result for every tick.
      const outcome = await step.do(
        `continuation ${iteration}`,
        { retries: { limit: 0, delay: "1 second", backoff: "constant" } },
        async () => {
          const { context, drain } = drainingExecutionContext();
          try {
            if (!qualificationOnly) {
              const { reconcilePendingVoiceovers } = await import("../src/server/hosted/j1tts");
              await reconcilePendingVoiceovers(this.env);
              const { reconcileScriptProjects } = await import(
                "../src/server/hosted/script-projects"
              );
              await reconcileScriptProjects(this.env, context);
            }
            const { reconcileCloudMediaReservations } = await import(
              "../src/server/hosted/runpod-media"
            );
            const cloud = await reconcileCloudMediaReservations(this.env);
            if (qualificationOnly)
              return { dispatched: 0, observers: 0, cloud: cloud ?? 0, error: null };
            const dispatched = await runHostedContinuation(this.env, context);
            const observers = await ensureHostedPairObservers(this.env, context);
            return { dispatched: dispatched.length, observers, cloud: cloud ?? 0, error: null };
          } catch (error) {
            // One bad tick (a transient database failure, a missing binding) must not kill a
            // 24-hour driver: record it and let the next iteration try again in 60 seconds.
            return { dispatched: 0, observers: 0, cloud: null, error: errorMessage(error) };
          } finally {
            await drain();
          }
        },
      );
      iterations += 1;
      dispatches += outcome.dispatched;
      pairObservers += outcome.observers;
      cloudObservationUncertain = outcome.cloud === null;
      if (outcome.cloud !== null) cloudPending = outcome.cloud;
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

    // Cron delivery is unqualified here. Uncertain cleanup must retain an independent observer
    // beyond this bounded instance, even when new allocations have been disabled for rollback.
    if (
      cloudPending > 0 ||
      (cloudObservationUncertain &&
        (this.env.VIDEOFORGE_CLOUD_MEDIA_ENABLED === "true" ||
          this.env.VIDEOFORGE_CLOUD_MEDIA_IMAGE))
    ) {
      await step.do("continue cloud cleanup observation", async () => {
        const binding = this.env.HOSTED_CONTINUATION_WORKFLOW;
        if (!binding) throw new Error("CLOUD_MEDIA_CLEANUP_OBSERVER_UNAVAILABLE");
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(event.instanceId),
        );
        const id = `cloud-safety-${Array.from(new Uint8Array(digest))
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("")
          .slice(0, 40)}`;
        try {
          await binding.create({ id, params: { reason: "cloud-cleanup-recovery" } });
        } catch (error) {
          // A lost creation acknowledgement adopts the same deterministic observer instance.
          const existing = await binding.get(id);
          const status = (await existing.status()) as { status?: unknown };
          if (
            !["queued", "running", "waiting", "sleeping", "waitingForPause", "paused"].includes(
              String(status?.status),
            )
          )
            throw error;
        }
      });
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
