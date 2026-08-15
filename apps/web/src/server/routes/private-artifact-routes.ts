import type {
  ArtifactControlPlanePort,
  SignArtifactAbortRequest,
  SignArtifactCompleteRequest,
  SignArtifactDownloadRequest,
  SignArtifactInitiateRequest,
  SignArtifactPartRequest,
  SignedArtifactOperation,
} from "@videoforge/pipeline";
import { Hono, type Context } from "hono";

import { apiProblem, problemResponse } from "../problem";

export const MAX_ARTIFACT_METADATA_BODY_BYTES = 64 * 1_024;

/** The server's own grant must name a bounded tenant; a blank or oversized value is a server bug. */
function isBoundedTenantIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
}

export type ArtifactRequestAuthorization =
  | { readonly ok: true; readonly accountId: string; readonly workspaceId: string }
  | { readonly ok: false; readonly response: Response };

export interface ArtifactAuthorizationRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Headers;
}

export interface PrivateArtifactControlPlaneAppOptions {
  /** Metadata-only storage facet. The byte-carrying direct-transfer facet is deliberately absent. */
  readonly controlPlane: ArtifactControlPlanePort;
  readonly authorize: (
    request: ArtifactAuthorizationRequest,
  ) => ArtifactRequestAuthorization | Promise<ArtifactRequestAuthorization>;
}

type JsonRecord = Readonly<Record<string, unknown>>;

type MetadataReadResult =
  | { readonly ok: true; readonly value: JsonRecord }
  | { readonly ok: false; readonly response: Response };

function metadataProblem(code: string, status: number, title: string, detail: string): Response {
  return problemResponse(apiProblem(code, status, title, detail, false));
}

function mediaType(contentType: string | undefined): string | null {
  if (contentType === undefined) return null;
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

function declaredLength(request: Request): number | null | "INVALID" {
  const raw = request.headers.get("content-length");
  if (raw === null) return null;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) return "INVALID";
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : "INVALID";
}

async function readBoundedJsonMetadata(request: Request): Promise<MetadataReadResult> {
  if (mediaType(request.headers.get("content-type") ?? undefined) !== "application/json") {
    return {
      ok: false,
      response: metadataProblem(
        "ARTIFACT_METADATA_CONTENT_TYPE_REQUIRED",
        415,
        "Artifact signing accepts JSON metadata only",
        "Send metadata as application/json. Upload and download media bytes directly through the signed storage URI.",
      ),
    };
  }
  const contentEncoding = request.headers.get("content-encoding")?.trim().toLowerCase();
  if (contentEncoding !== undefined && contentEncoding !== "identity") {
    return {
      ok: false,
      response: metadataProblem(
        "ARTIFACT_METADATA_ENCODING_UNSUPPORTED",
        415,
        "Compressed artifact metadata is not supported",
        "Send an uncompressed JSON metadata document within the bounded application request size.",
      ),
    };
  }
  if (request.headers.has("transfer-encoding")) {
    return {
      ok: false,
      response: metadataProblem(
        "ARTIFACT_METADATA_FRAMING_UNSUPPORTED",
        400,
        "Artifact metadata framing is unsupported",
        "Do not supply Transfer-Encoding to the artifact signing boundary.",
      ),
    };
  }
  const length = declaredLength(request);
  if (length === "INVALID") {
    return {
      ok: false,
      response: metadataProblem(
        "ARTIFACT_METADATA_LENGTH_INVALID",
        400,
        "Artifact metadata length is invalid",
        "Content-Length must be a non-negative safe integer when supplied.",
      ),
    };
  }
  if (length !== null && length > MAX_ARTIFACT_METADATA_BODY_BYTES) {
    return {
      ok: false,
      response: metadataProblem(
        "ARTIFACT_METADATA_TOO_LARGE",
        413,
        "Artifact metadata is too large",
        `Artifact signing metadata must not exceed ${MAX_ARTIFACT_METADATA_BODY_BYTES} bytes. Media bytes belong on the signed direct-transfer URI.`,
      ),
    };
  }

  const reader = request.body?.getReader();
  if (reader === undefined) {
    return {
      ok: false,
      response: metadataProblem(
        "ARTIFACT_METADATA_REQUIRED",
        400,
        "Artifact metadata is required",
        "Send one JSON metadata object.",
      ),
    };
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      received += next.value.byteLength;
      if (received > MAX_ARTIFACT_METADATA_BODY_BYTES) {
        await reader.cancel("artifact metadata limit exceeded");
        return {
          ok: false,
          response: metadataProblem(
            "ARTIFACT_METADATA_TOO_LARGE",
            413,
            "Artifact metadata is too large",
            `Artifact signing metadata must not exceed ${MAX_ARTIFACT_METADATA_BODY_BYTES} bytes. Media bytes belong on the signed direct-transfer URI.`,
          ),
        };
      }
      chunks.push(next.value);
    }
  } catch {
    return {
      ok: false,
      response: metadataProblem(
        "ARTIFACT_METADATA_READ_FAILED",
        400,
        "Artifact metadata could not be read",
        "Retry with one bounded, uncompressed JSON metadata object.",
      ),
    };
  } finally {
    reader.releaseLock();
  }

  if (length !== null && received !== length) {
    return {
      ok: false,
      response: metadataProblem(
        "ARTIFACT_METADATA_LENGTH_MISMATCH",
        400,
        "Artifact metadata length does not match",
        "Content-Length must exactly match the uncompressed JSON metadata bytes.",
      ),
    };
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return {
      ok: false,
      response: metadataProblem(
        "ARTIFACT_METADATA_UTF8_INVALID",
        400,
        "Artifact metadata is not valid UTF-8",
        "Encode the JSON metadata document as UTF-8.",
      ),
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      response: metadataProblem(
        "ARTIFACT_METADATA_JSON_INVALID",
        400,
        "Artifact metadata is not valid JSON",
        "Send one JSON metadata object.",
      ),
    };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ok: false,
      response: metadataProblem(
        "ARTIFACT_METADATA_OBJECT_REQUIRED",
        422,
        "Artifact metadata must be an object",
        "Send the exact signing request as one JSON object.",
      ),
    };
  }
  return { ok: true, value: value as JsonRecord };
}

function bodyWorkspaceId(body: JsonRecord, initiate: boolean): string | null {
  if (!initiate) return typeof body.workspaceId === "string" ? body.workspaceId : null;
  const scope = body.scope;
  if (typeof scope !== "object" || scope === null || Array.isArray(scope)) return null;
  const workspaceId = (scope as Readonly<Record<string, unknown>>).workspaceId;
  return typeof workspaceId === "string" ? workspaceId : null;
}

const SIGNED_OPERATION_KEYS = Object.freeze([
  "applicationBodyBytes",
  "expiresAtEpochMs",
  "objectKey",
  "operation",
  "partNumber",
  "schemaVersion",
  "token",
  "transferUri",
  "uploadId",
  "workspaceId",
]);

function isExactSignedOperation(
  value: unknown,
  expectedOperation: SignedArtifactOperation["operation"],
  workspaceId: string,
): value is SignedArtifactOperation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value) as Record<
      PropertyKey,
      PropertyDescriptor
    >;
  } catch {
    return false;
  }
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string")) return false;
  const keys = Object.keys(descriptors).sort();
  if (
    keys.length !== SIGNED_OPERATION_KEYS.length ||
    keys.some((key, index) => key !== SIGNED_OPERATION_KEYS[index])
  ) {
    return false;
  }
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      return false;
    }
  }
  const operation = value as Readonly<Record<string, unknown>>;
  const uploadIdIsConsistent =
    expectedOperation === "DOWNLOAD"
      ? operation.uploadId === null
      : typeof operation.uploadId === "string" &&
        operation.uploadId.length > 0 &&
        operation.uploadId.length <= 160;
  const partNumberIsConsistent =
    expectedOperation === "UPLOAD_PART"
      ? typeof operation.partNumber === "number" &&
        Number.isSafeInteger(operation.partNumber) &&
        operation.partNumber >= 1 &&
        operation.partNumber <= 256
      : operation.partNumber === null;
  let transferProtocol: string | null = null;
  if (typeof operation.transferUri === "string") {
    try {
      transferProtocol = new URL(operation.transferUri).protocol;
    } catch {
      transferProtocol = null;
    }
  }
  return (
    operation.schemaVersion === "signed-artifact-operation/v1" &&
    operation.operation === expectedOperation &&
    operation.workspaceId === workspaceId &&
    typeof operation.objectKey === "string" &&
    operation.objectKey.length > 0 &&
    operation.objectKey.length <= 600 &&
    operation.objectKey.startsWith(`workspace/${workspaceId}/`) &&
    uploadIdIsConsistent &&
    partNumberIsConsistent &&
    typeof operation.expiresAtEpochMs === "number" &&
    Number.isSafeInteger(operation.expiresAtEpochMs) &&
    typeof operation.transferUri === "string" &&
    operation.transferUri.length > 0 &&
    operation.transferUri.length <= 4_096 &&
    (transferProtocol === "https:" ||
      transferProtocol === "http:" ||
      transferProtocol === "vf-local-r2:") &&
    typeof operation.token === "string" &&
    operation.token.length > 0 &&
    operation.token.length <= 96 * 1_024 &&
    operation.applicationBodyBytes === 0
  );
}

function artifactPortProblem(error: unknown): Response {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : null;
  if (code === null) {
    return metadataProblem(
      "ARTIFACT_SIGNING_FAILED",
      500,
      "Artifact signing failed",
      "The metadata-only artifact boundary failed before issuing a transfer operation.",
    );
  }
  const status =
    code === "IDEMPOTENCY_CONFLICT" ||
    code === "IMMUTABLE_COLLISION" ||
    code === "UPLOAD_STATE_CONFLICT"
      ? 409
      : code === "NOT_FOUND" || code === "UPLOAD_NOT_FOUND"
        ? 404
        : code === "SCOPE_MISMATCH"
          ? 403
          : code === "ARTIFACT_LIMIT_EXCEEDED"
            ? 413
            : code === "SIGNING_NOT_CONFIGURED" || code === "SIGNING_CONFIGURATION_INVALID"
              ? 503
              : 422;
  return metadataProblem(
    code,
    status,
    "Artifact signing request was rejected",
    "The request did not satisfy the private artifact storage contract.",
  );
}

async function authorizeAndRead(
  c: Context,
  options: PrivateArtifactControlPlaneAppOptions,
  initiate: boolean,
): Promise<
  | {
      readonly ok: true;
      readonly body: JsonRecord;
      readonly accountId: string;
      readonly workspaceId: string;
    }
  | { readonly ok: false; readonly response: Response }
> {
  const authorization = await options.authorize({
    method: c.req.method,
    path: c.req.path,
    headers: new Headers(c.req.raw.headers),
  });
  if (!authorization.ok) return authorization;
  if (
    !isBoundedTenantIdentifier(authorization.workspaceId) ||
    !isBoundedTenantIdentifier(authorization.accountId)
  ) {
    return {
      ok: false,
      response: metadataProblem(
        "ARTIFACT_AUTHORIZATION_INVALID",
        500,
        "Artifact authorization is invalid",
        "The server did not produce a valid workspace-scoped authorization grant.",
      ),
    };
  }
  const metadata = await readBoundedJsonMetadata(c.req.raw);
  if (!metadata.ok) return metadata;
  if (bodyWorkspaceId(metadata.value, initiate) !== authorization.workspaceId) {
    return {
      ok: false,
      response: metadataProblem(
        "WORKSPACE_ACCESS_REQUIRED",
        403,
        "Workspace access is required",
        "The artifact request is not scoped to the authorized workspace.",
      ),
    };
  }
  return {
    ok: true,
    body: metadata.value,
    accountId: authorization.accountId,
    workspaceId: authorization.workspaceId,
  };
}

async function sign(
  c: Context,
  options: PrivateArtifactControlPlaneAppOptions,
  initiate: boolean,
  expectedOperation: SignedArtifactOperation["operation"],
  operation: (body: JsonRecord) => Promise<SignedArtifactOperation>,
): Promise<Response> {
  const request = await authorizeAndRead(c, options, initiate);
  if (!request.ok) return request.response;
  try {
    const signed = await operation(request.body);
    if (!isExactSignedOperation(signed, expectedOperation, request.workspaceId)) {
      return metadataProblem(
        "ARTIFACT_SIGNING_RESULT_INVALID",
        500,
        "Artifact signing result is invalid",
        "The storage adapter returned a result outside the metadata-only contract.",
      );
    }
    c.header("cache-control", "no-store");
    return c.json(signed);
  } catch (error) {
    return artifactPortProblem(error);
  }
}

/**
 * Isolated durable artifact router. It is intentionally not mounted by fixture/local composition;
 * VF-1-07 will mount it only after durable auth and repository bindings are composed together.
 */
export function createPrivateArtifactControlPlaneApp(
  options: PrivateArtifactControlPlaneAppOptions,
): Hono {
  const app = new Hono();
  app.post("/api/v1/artifacts/sign/initiate", (c) =>
    sign(c, options, true, "INITIATE", (body) =>
      options.controlPlane.signInitiate(body as unknown as SignArtifactInitiateRequest),
    ),
  );
  app.post("/api/v1/artifacts/sign/part", (c) =>
    sign(c, options, false, "UPLOAD_PART", (body) =>
      options.controlPlane.signPart(body as unknown as SignArtifactPartRequest),
    ),
  );
  app.post("/api/v1/artifacts/sign/complete", (c) =>
    sign(c, options, false, "COMPLETE", (body) =>
      options.controlPlane.signComplete(body as unknown as SignArtifactCompleteRequest),
    ),
  );
  app.post("/api/v1/artifacts/sign/abort", (c) =>
    sign(c, options, false, "ABORT", (body) =>
      options.controlPlane.signAbort(body as unknown as SignArtifactAbortRequest),
    ),
  );
  app.post("/api/v1/artifacts/sign/download", (c) =>
    sign(c, options, false, "DOWNLOAD", (body) =>
      options.controlPlane.signDownload(body as unknown as SignArtifactDownloadRequest),
    ),
  );
  return app;
}
