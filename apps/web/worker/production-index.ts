import { handleHostedRequest } from "../src/server/hosted/app";
import type { HostedRuntimeEnvironment } from "../src/server/hosted/configuration";
import { runHostedRetention } from "../src/server/hosted/retention";
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
  scheduled(_controller, environment, executionContext) {
    executionContext.waitUntil(runHostedRetention(environment));
  },
} satisfies ExportedHandler<HostedRuntimeEnvironment>;
