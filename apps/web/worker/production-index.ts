import { handleHostedRequest } from "../src/server/hosted/app";
import type { HostedRuntimeEnvironment } from "../src/server/hosted/configuration";
import { runHostedRetention } from "../src/server/hosted/retention";
import { runHostedContinuation } from "../src/server/hosted/stage-continuation-sweep";
import { withWorkerVersionIdentity } from "../src/server/hosted/worker-version";

export { HostedVideoWorkflow } from "./hosted-workflow";
export { HostedPairWorkflow } from "./hosted-pair-workflow";

export default {
  async fetch(request, environment, executionContext) {
    return withWorkerVersionIdentity(
      await handleHostedRequest(request, environment, executionContext),
      environment,
    );
  },
  scheduled(controller, environment, executionContext) {
    // `17 2 * * *` is the daily retention pass; the per-minute cron drives stage continuation.
    // Continuation is awaited rather than deferred: work queued through `waitUntil` is cut before a
    // multi-minute provider stage finishes, which is exactly how a prompt run was left claimed with
    // zero batches recorded.
    if (controller.cron === "* * * * *") return runHostedContinuation(environment, executionContext);
    executionContext.waitUntil(runHostedRetention(environment));
    return Promise.resolve();
  },
} satisfies ExportedHandler<HostedRuntimeEnvironment>;
