import { handleHostedRequest } from "../src/server/hosted/app";
import type { HostedRuntimeEnvironment } from "../src/server/hosted/configuration";
import { runHostedRetention } from "../src/server/hosted/retention";

export { HostedVideoWorkflow } from "./hosted-workflow";

export default {
  fetch(request, environment, executionContext) {
    return handleHostedRequest(request, environment, executionContext);
  },
  scheduled(_controller, environment, executionContext) {
    executionContext.waitUntil(runHostedRetention(environment));
  },
} satisfies ExportedHandler<HostedRuntimeEnvironment>;
