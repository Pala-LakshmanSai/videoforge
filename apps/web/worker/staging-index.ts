import { handleHostedRequest } from "../src/server/hosted/app";
import {
  hostedRuntimeConfiguration,
  type HostedRuntimeEnvironment,
} from "../src/server/hosted/configuration";
import { runHostedRetention } from "../src/server/hosted/retention";
import { handleV207GeneratedOutputPort } from "../src/server/hosted/v207-output-ports";

export { HostedVideoWorkflow } from "./hosted-workflow";

const V207_OUTPUT_PORT_ROUTE = "/api/v2/v207/generated-output-port";

function unavailable(): Response {
  return Response.json(
    { error: { code: "HOSTED_CONFIGURATION_INVALID", retryable: false } },
    {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
        "x-content-type-options": "nosniff",
        "x-videoforge-runtime": "hosted-v2-07-output-port",
      },
    },
  );
}

export default {
  async fetch(request, environment, executionContext) {
    if (request.method === "POST" && new URL(request.url).pathname === V207_OUTPUT_PORT_ROUTE) {
      try {
        const response = await handleV207GeneratedOutputPort(
          request,
          hostedRuntimeConfiguration(environment),
          environment,
        );
        if (response) return response;
      } catch {
        return unavailable();
      }
    }
    return handleHostedRequest(request, environment, executionContext);
  },
  scheduled(_controller, environment, executionContext) {
    executionContext.waitUntil(runHostedRetention(environment));
  },
} satisfies ExportedHandler<HostedRuntimeEnvironment>;
