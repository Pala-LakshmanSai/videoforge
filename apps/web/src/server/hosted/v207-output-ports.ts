import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import { HostedR2Signer } from "./r2";

const ROUTE = "/api/v2/v207/generated-output-port";
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const TOKEN = /^[A-Fa-f0-9]{64}$/u;
const CONTENT_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u;
const CHECKSUM = /^sha256:[0-9a-f]{64}$/u;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 10_737_418_240;

type Operation = "PUT" | "GET" | "DELETE";

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-videoforge-runtime": "hosted-v2-07-output-port",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeySet(value: Record<string, unknown>, operation: Operation): boolean {
  const expected =
    operation === "PUT"
      ? [
          "account_id",
          "content_type",
          "lifetime_seconds",
          "max_content_length",
          "object_key",
          "operation",
          "schema_version",
          "workspace_id",
        ]
      : operation === "GET"
        ? [
          "account_id",
          "checksum_sha256",
          "content_length",
          "content_type",
          "lifetime_seconds",
          "max_content_length",
          "object_key",
          "operation",
          "schema_version",
          "workspace_id",
          ]
        : ["account_id", "object_key", "operation", "schema_version", "workspace_id"];
  return Object.keys(value).sort().join(",") === expected.sort().join(",");
}

function objectKeyMatchesScope(objectKey: string, accountId: string, workspaceId: string): boolean {
  const prefix = `tenant/${accountId}/workspace/${workspaceId}/`;
  return (
    objectKey.startsWith(prefix) &&
    objectKey.includes("/project/") &&
    objectKey.includes("/revision/") &&
    objectKey.includes("/lane/mage-image/job/") &&
    objectKey.includes("/artifact/") &&
    !objectKey.includes("?") &&
    !objectKey.includes("#") &&
    !objectKey.includes("../") &&
    !objectKey.endsWith("/")
  );
}

async function readJson(request: Request): Promise<unknown | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    return null;
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function invalid(code: string): Response {
  return json({ error: { code } }, 400);
}

/**
 * Short-lived activation seam for the approved V2-07 qualification.  The route is inert unless
 * an operator supplies the exact ephemeral nonce in the Worker environment.  It signs direct R2
 * PUT URLs for generated outputs, checksum-bound GET URLs for post-upload durability checks, and
 * one exact-key DELETE rollback operation; it never lists or broadens the tenant-owned namespace.
 */
export async function handleV207GeneratedOutputPort(
  request: Request,
  config: HostedRuntimeConfiguration,
  environment: HostedRuntimeEnvironment,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== ROUTE || request.method !== "POST") return null;
  const nonce = environment.VIDEOFORGE_V207_AUTHORITY_NONCE;
  if (!nonce || !TOKEN.test(nonce)) return json({ error: { code: "V207_ROUTE_DISABLED" } }, 404);
  if (request.headers.get("x-videoforge-v207-authority") !== nonce) {
    return json({ error: { code: "V207_AUTHORITY_REJECTED" } }, 403);
  }
  const value = await readJson(request);
  if (!isRecord(value)) return invalid("V207_REQUEST_INVALID");
  const operation = value.operation;
  if (operation !== "PUT" && operation !== "GET" && operation !== "DELETE") {
    return invalid("V207_REQUEST_INVALID");
  }
  if (!exactKeySet(value, operation)) return invalid("V207_REQUEST_INVALID");
  if (
    value.schema_version !== "videoforge-v207-generated-output-port-request/v1" ||
    typeof value.account_id !== "string" ||
    !ID.test(value.account_id) ||
    typeof value.workspace_id !== "string" ||
    !ID.test(value.workspace_id) ||
    typeof value.object_key !== "string" ||
    !objectKeyMatchesScope(value.object_key, value.account_id, value.workspace_id)
  ) {
    return invalid("V207_REQUEST_INVALID");
  }
  try {
    if (operation === "DELETE") {
      if (!environment.PRIVATE_ARTIFACTS) return json({ error: { code: "V207_DELETE_UNAVAILABLE" } }, 503);
      await environment.PRIVATE_ARTIFACTS.delete(value.object_key);
      return json({
        schema_version: "videoforge-v207-generated-output-delete/v1",
        deleted: true,
      });
    }
    if (
      typeof value.content_type !== "string" ||
      !CONTENT_TYPE.test(value.content_type) ||
      typeof value.max_content_length !== "number" ||
      !Number.isSafeInteger(value.max_content_length) ||
      value.max_content_length < 1 ||
      value.max_content_length > MAX_OUTPUT_BYTES ||
      typeof value.lifetime_seconds !== "number" ||
      !Number.isSafeInteger(value.lifetime_seconds) ||
      value.lifetime_seconds < 1 ||
      value.lifetime_seconds > 900
    ) {
      return invalid("V207_REQUEST_INVALID");
    }
    const signer = new HostedR2Signer(config.r2);
    if (operation === "PUT") {
      const port = await signer.signGenerated({
        objectKey: value.object_key,
        contentType: value.content_type,
        maxContentLength: value.max_content_length,
        lifetimeSeconds: value.lifetime_seconds,
      });
      return json({ schema_version: "videoforge-v207-generated-output-port/v1", ...port });
    }
    if (
      typeof value.content_length !== "number" ||
      !Number.isSafeInteger(value.content_length) ||
      value.content_length < 1 ||
      value.content_length > value.max_content_length ||
      typeof value.checksum_sha256 !== "string" ||
      !CHECKSUM.test(value.checksum_sha256)
    ) {
      return invalid("V207_REQUEST_INVALID");
    }
    const port = await signer.sign({
      method: "GET",
      objectKey: value.object_key,
      contentType: value.content_type,
      contentLength: value.content_length,
      checksumSha256: value.checksum_sha256,
      lifetimeSeconds: value.lifetime_seconds,
    });
    return json({ schema_version: "videoforge-v207-generated-output-read-port/v1", ...port });
  } catch {
    return json({ error: { code: "V207_PORT_SIGNING_FAILED" } }, 503);
  }
}
