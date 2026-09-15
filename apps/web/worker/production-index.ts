import { handleHostedRequest } from "../src/server/hosted/app";
import type { HostedRuntimeEnvironment } from "../src/server/hosted/configuration";
import { runHostedRetention } from "../src/server/hosted/retention";
import { runHostedContinuation } from "../src/server/hosted/stage-continuation-sweep";
import { withWorkerVersionIdentity } from "../src/server/hosted/worker-version";

export { HostedVideoWorkflow } from "./hosted-workflow";
export { HostedPairWorkflow } from "./hosted-pair-workflow";
export { HostedContinuationWorkflow } from "./hosted-continuation-workflow";

export default {
  async fetch(request, environment, executionContext) {
    return withWorkerVersionIdentity(
      await handleHostedRequest(request, environment, executionContext),
      environment,
    );
  },
  async scheduled(controller, environment, executionContext) {
    // `17 2 * * *` is the daily retention pass; the per-minute cron was meant to drive stage
    // continuation, but its handler is never invoked in this deployment (the sweep's heartbeat table
    // stayed empty for 40+ minutes with the schedule registered). Continuation now runs as the
    // durable `HostedContinuationWorkflow`, started from the desktop worker's claim poll; this
    // branch is kept only as a best-effort fallback if cron delivery is ever repaired.
    if (controller.cron === "* * * * *") {
      // Await rather than defer: work queued through `waitUntil` is cut before a multi-minute
      // provider stage finishes, which is exactly how a prompt run was left claimed with zero
      // batches recorded. Awaited here so the scheduled invocation cannot end mid-stage.
      await runHostedContinuation(environment, executionContext);
      return;
    }
    executionContext.waitUntil(runHostedRetention(environment));
  },
} satisfies ExportedHandler<HostedRuntimeEnvironment>;
