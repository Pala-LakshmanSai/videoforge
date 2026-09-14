import { parseHostedJson, plainRecord, response } from "./hosted-product-route-common";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const PATH = /^\/api\/v2\/hosted\/projects\/([^/]+)\/images\/([^/]+)\/regenerate(?:\/([^/]+))?$/u;
const SCHEMA = "videoforge-hosted-image-regeneration/v1";

export interface HostedImageRegenerationRouteScope {
  readonly account_id: string;
  readonly workspace_id: string;
  readonly user_id: string;
}
export interface HostedImageRegenerationRouteService {
  create(input: {
    accountId: string;
    workspaceId: string;
    userId?: string;
    projectId: string;
    imageTaskId: string;
    revisionId: string;
    prompt: string;
    idempotencyKey: string;
  }): Promise<Record<string, unknown>>;
  get(input: {
    accountId: string;
    workspaceId: string;
    projectId: string;
    imageTaskId: string;
    requestId: string;
  }): Promise<Record<string, unknown> | null>;
}
export interface HostedImageRegenerationRouteDeps {
  readonly config: { publicOrigin: string };
  authenticate(request: Request): Promise<HostedImageRegenerationRouteScope | Response>;
  readonly service: HostedImageRegenerationRouteService;
}

function bad(code: string, status = 400): Response {
  return response({ error: { code } }, status);
}

export async function handleHostedImageRegenerationRoute(
  request: Request,
  deps: HostedImageRegenerationRouteDeps,
): Promise<Response | null> {
  const match = PATH.exec(new URL(request.url).pathname);
  if (!match) return null;
  const projectId = match[1];
  const imageTaskId = match[2];
  const requestId = match[3];
  if (
    !projectId ||
    !imageTaskId ||
    !UUID.test(projectId) ||
    !UUID.test(imageTaskId) ||
    (requestId !== undefined && !UUID.test(requestId))
  )
    return bad("HOSTED_IMAGE_REGENERATION_ID_INVALID", 404);
  if (new URL(request.url).origin !== new URL(deps.config.publicOrigin).origin)
    return bad("HOSTED_BROWSER_ORIGIN_REJECTED", 403);
  const scope = await deps.authenticate(request);
  if (scope instanceof Response) return scope;
  if (request.method === "GET") {
    if (!requestId) return bad("HOSTED_IMAGE_REGENERATION_REQUEST_ID_REQUIRED");
    const result = await deps.service.get({
      accountId: scope.account_id,
      workspaceId: scope.workspace_id,
      projectId,
      imageTaskId,
      requestId,
    });
    return result
      ? response({ schema_version: SCHEMA, ...result }, 200)
      : bad("HOSTED_IMAGE_REGENERATION_NOT_FOUND", 404);
  }
  if (request.method !== "POST" || requestId)
    return bad("HOSTED_IMAGE_REGENERATION_METHOD_NOT_ALLOWED", 405);
  const parsed = await parseHostedJson(
    request,
    "HOSTED_IMAGE_REGENERATION_BODY_INVALID",
    64 * 1024,
  );
  if (parsed instanceof Response) return parsed;
  const body = plainRecord(parsed);
  if (
    !body ||
    body.schema_version !== SCHEMA ||
    typeof body.prompt !== "string" ||
    body.prompt.trim().length < 1 ||
    body.prompt.length > 12000 ||
    typeof body.idempotency_key !== "string" ||
    body.idempotency_key.length < 1 ||
    body.idempotency_key.length > 200 ||
    typeof body.revision_id !== "string" ||
    !UUID.test(body.revision_id)
  )
    return bad("HOSTED_IMAGE_REGENERATION_BODY_INVALID");
  try {
    const result = await deps.service.create({
      accountId: scope.account_id,
      workspaceId: scope.workspace_id,
      userId: scope.user_id,
      projectId,
      imageTaskId,
      revisionId: body.revision_id,
      prompt: body.prompt,
      idempotencyKey: body.idempotency_key,
    });
    return response({ schema_version: SCHEMA, ...result }, 202);
  } catch (error) {
    const databaseCode = error && typeof error === "object" && "code" in error ? error.code : null;
    if (databaseCode === "23505") return bad("HOSTED_IMAGE_REGENERATION_CONFLICT", 409);
    if (databaseCode === "02000") return bad("HOSTED_IMAGE_REGENERATION_NOT_FOUND", 404);
    const code =
      error instanceof Error && error.message.includes("idempotency")
        ? "HOSTED_IMAGE_REGENERATION_IDEMPOTENCY_CONFLICT"
        : "HOSTED_IMAGE_REGENERATION_REJECTED";
    return bad(code, code.endsWith("CONFLICT") ? 409 : 503);
  }
}
