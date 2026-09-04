import type { HostedRuntimeEnvironment } from "../src/server/hosted/configuration";
import { handleV207DisposableOutputPort } from "../src/server/hosted/v207-disposable-output-ports";

const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function withVersion(response: Response, environment: HostedRuntimeEnvironment): Response {
  const headers = new Headers(response.headers);
  const versionId = environment.CF_VERSION_METADATA?.id;
  if (typeof versionId === "string" && VERSION_ID.test(versionId)) {
    headers.set("x-videoforge-worker-version", versionId);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, environment) {
    const response = await handleV207DisposableOutputPort(request, environment);
    if (response !== null) return withVersion(response, environment);
    return withVersion(
      Response.json(
        { error: { code: "V207_ROUTE_DISABLED" } },
        { status: 404, headers: { "cache-control": "no-store" } },
      ),
      environment,
    );
  },
} satisfies ExportedHandler<HostedRuntimeEnvironment>;
