import { handleHostedRequest } from "../src/server/hosted/app";
import {
  hostedRuntimeConfiguration,
  type HostedRuntimeEnvironment,
} from "../src/server/hosted/configuration";
import { runHostedRetention } from "../src/server/hosted/retention";
import { handleV207GeneratedOutputPort } from "../src/server/hosted/v207-output-ports";

export { HostedVideoWorkflow } from "./hosted-workflow";
export { HostedPairWorkflow } from "./hosted-pair-workflow";

const V207_OUTPUT_PORT_ROUTE = "/api/v2/v207/generated-output-port";
const V207_WORKER_VERSION_HEADER = "x-videoforge-worker-version";
const WORKER_VERSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function withWorkerVersionIdentity(
  response: Response,
  environment: HostedRuntimeEnvironment,
): Response {
  const versionId = environment.CF_VERSION_METADATA?.id;
  const headers = new Headers(response.headers);
  // Never emit a guessed/static identity.  A missing or malformed binding must remain visible
  // to the activation probe, which fails closed before any qualification job is submitted.
  if (typeof versionId === "string" && WORKER_VERSION_ID.test(versionId)) {
    headers.set(V207_WORKER_VERSION_HEADER, versionId);
  } else {
    headers.delete(V207_WORKER_VERSION_HEADER);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function unavailable(environment: HostedRuntimeEnvironment): Response {
  return withWorkerVersionIdentity(
    Response.json(
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
    ),
    environment,
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
        if (response) return withWorkerVersionIdentity(response, environment);
      } catch {
        return unavailable(environment);
      }
    }
    return handleHostedRequest(request, environment, executionContext);
  },
  scheduled(_controller, environment, executionContext) {
    executionContext.waitUntil(runHostedRetention(environment));
  },
} satisfies ExportedHandler<HostedRuntimeEnvironment>;
