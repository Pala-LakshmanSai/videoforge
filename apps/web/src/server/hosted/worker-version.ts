const WORKER_VERSION_HEADER = "x-videoforge-worker-version";
const WORKER_VERSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function withWorkerVersionIdentity(
  response: Response,
  environment: { readonly CF_VERSION_METADATA?: { readonly id?: string } },
): Response {
  const versionId = environment.CF_VERSION_METADATA?.id;
  const headers = new Headers(response.headers);
  if (typeof versionId === "string" && WORKER_VERSION_ID.test(versionId)) {
    headers.set(WORKER_VERSION_HEADER, versionId);
  } else {
    headers.delete(WORKER_VERSION_HEADER);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
