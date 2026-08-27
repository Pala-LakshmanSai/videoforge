import { canonicalSha256, type Sha256 } from "@videoforge/control-plane";
import { validateContract } from "@videoforge/contracts";

import type {
  HostedR2BucketBinding,
  HostedRuntimeConfiguration,
  HostedRuntimeEnvironment,
} from "./configuration.js";
import { sha256, sha256Bytes } from "./crypto.js";
import { createNeonExecutor, createNeonPool } from "./neon.js";
import { exactHostedRenderSubmission } from "./submission.js";

export const V213_RESOLVED_RENDER_MANIFEST_PATH = "/api/operator/v2-13/resolved-render-manifest";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_REQUEST_AGE_MS = 5 * 60_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const SIGNATURE = /^[0-9a-f]{64}$/u;
const NONCE = /^[A-Za-z0-9_.:-]{16,190}$/u;
const OBJECT_URI = /^vf-local:\/\/objects\/sha256\/([0-9a-f]{2})\/([0-9a-f]{64})\.json$/u;

export const V213_RESOLVED_RENDER_MANIFEST_OPERATIONS = Object.freeze([
  "v2-09-short-hosted-project",
  "v2-10-operator-free-ranga-pilot",
  "v2-12-long-output",
] as const);

export type V213ResolvedRenderManifestOperation =
  (typeof V213_RESOLVED_RENDER_MANIFEST_OPERATIONS)[number];

export interface V213ResolvedRenderManifestReadRequest {
  readonly schemaVersion: "videoforge.v213-resolved-render-manifest-read/v1";
  readonly fullLiveAuthorityId: string;
  readonly operationId: V213ResolvedRenderManifestOperation;
  readonly outerStateSha256: Sha256;
  readonly materializationRequestSha256: Sha256;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly artifactUri: string;
  readonly sha256: Sha256;
  readonly issuedAt: string;
  readonly nonce: string;
  readonly requestSha256: Sha256;
}

export interface V213ResolvedRenderManifestProjection {
  readonly payload: unknown;
  readonly payloadSha256: string;
  readonly ownershipAccountId: string | null;
  readonly ownershipWorkspaceId: string | null;
  readonly ownershipProjectId: string | null;
  readonly ownershipProjectRevisionId: string | null;
  readonly ownershipRevisionStatus: string | null;
  readonly matchingObjectCount: number | string;
  readonly artifactReceiptId: string | null;
  readonly receiptId: string | null;
  readonly receiptAccountId: string | null;
  readonly receiptWorkspaceId: string | null;
  readonly receiptObjectKey: string | null;
  readonly receiptContentType: string | null;
  readonly receiptContentLength: number | string | null;
  readonly receiptChecksumSha256: string | null;
  readonly receiptDeletedAt: string | null;
  readonly reservationId: string | null;
  readonly reservationAccountId: string | null;
  readonly reservationWorkspaceId: string | null;
  readonly reservationProjectId: string | null;
  readonly reservationProjectRevisionId: string | null;
  readonly reservationObjectKey: string | null;
  readonly reservationMethod: string | null;
  readonly reservationLane: string | null;
  readonly reservationState: string | null;
  readonly reservationContentType: string | null;
  readonly reservationContentLength: number | string | null;
  readonly reservationChecksumSha256: string | null;
}

export interface V213ResolvedRenderManifestReadDependencies {
  readonly claimAndLoad: (input: {
    readonly tokenSha256: Sha256;
    readonly nonceSha256: Sha256;
    readonly request: V213ResolvedRenderManifestReadRequest;
  }) => Promise<V213ResolvedRenderManifestProjection | null>;
  readonly close: () => Promise<void>;
}

const REQUEST_KEYS = Object.freeze([
  "accountId",
  "artifactUri",
  "fullLiveAuthorityId",
  "issuedAt",
  "materializationRequestSha256",
  "nonce",
  "operationId",
  "outerStateSha256",
  "projectId",
  "projectRevisionId",
  "requestSha256",
  "schemaVersion",
  "sha256",
  "workspaceId",
]);

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

function notFound(): Response {
  return json({ error: { code: "NOT_FOUND" } }, 404);
}

function parseRequest(value: unknown, now: Date): V213ResolvedRenderManifestReadRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  const uri = typeof request.artifactUri === "string" ? OBJECT_URI.exec(request.artifactUri) : null;
  const issuedAt = typeof request.issuedAt === "string" ? Date.parse(request.issuedAt) : Number.NaN;
  if (
    !exactKeys(request, REQUEST_KEYS) ||
    request.schemaVersion !== "videoforge.v213-resolved-render-manifest-read/v1" ||
    !V213_RESOLVED_RENDER_MANIFEST_OPERATIONS.includes(
      request.operationId as V213ResolvedRenderManifestOperation,
    ) ||
    ![
      request.fullLiveAuthorityId,
      request.accountId,
      request.workspaceId,
      request.projectId,
      request.projectRevisionId,
    ].every((item) => typeof item === "string" && UUID.test(item)) ||
    ![request.outerStateSha256, request.materializationRequestSha256, request.sha256].every(
      (item) => typeof item === "string" && HASH.test(item),
    ) ||
    !uri ||
    request.sha256 !== `sha256:${uri[2]}` ||
    uri[1] !== uri[2]?.slice(0, 2) ||
    typeof request.nonce !== "string" ||
    !NONCE.test(request.nonce) ||
    typeof request.issuedAt !== "string" ||
    !Number.isFinite(issuedAt) ||
    new Date(issuedAt).toISOString() !== request.issuedAt ||
    issuedAt > now.getTime() + MAX_CLOCK_SKEW_MS ||
    now.getTime() - issuedAt > MAX_REQUEST_AGE_MS ||
    typeof request.requestSha256 !== "string" ||
    !HASH.test(request.requestSha256)
  )
    return null;
  const { requestSha256, ...unsigned } = request;
  if (canonicalSha256(unsigned) !== requestSha256) return null;
  return request as unknown as V213ResolvedRenderManifestReadRequest;
}

async function verifyHmac(token: string, body: string, signature: string | null): Promise<boolean> {
  if (!signature || !SIGNATURE.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    Uint8Array.from(signature.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16)),
    new TextEncoder().encode(body),
  );
}

function checksumFromR2(value?: ArrayBuffer): Sha256 | null {
  if (!value || value.byteLength !== 32) return null;
  return `sha256:${[...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}` as Sha256;
}

function exactProjection(
  row: V213ResolvedRenderManifestProjection | null,
  request: V213ResolvedRenderManifestReadRequest,
): { readonly objectKey: string; readonly contentLength: number } | null {
  if (
    !row ||
    Number(row.matchingObjectCount) !== 1 ||
    !exactHostedRenderSubmission(row.payload, request.projectId, request.projectRevisionId)
  )
    return null;
  const payload = row.payload as Record<string, unknown>;
  const input = payload.input_document as Record<string, unknown>;
  const manifest = input.resolved_render_manifest as Record<string, unknown>;
  const objects = payload.objects as readonly Record<string, unknown>[];
  const matching = objects.filter((object) => object.uri === request.artifactUri);
  const contentLength = Number(row.receiptContentLength);
  if (
    row.payloadSha256 !== canonicalSha256(row.payload as object) ||
    row.ownershipAccountId !== request.accountId ||
    row.ownershipWorkspaceId !== request.workspaceId ||
    row.ownershipProjectId !== request.projectId ||
    row.ownershipProjectRevisionId !== request.projectRevisionId ||
    row.ownershipRevisionStatus !== "LOCKED" ||
    manifest.artifact_uri !== request.artifactUri ||
    manifest.sha256 !== request.sha256 ||
    matching.length !== 1 ||
    matching[0]?.artifact_receipt_id !== row.artifactReceiptId ||
    row.artifactReceiptId !== row.receiptId ||
    row.reservationId === null ||
    row.receiptAccountId !== request.accountId ||
    row.receiptWorkspaceId !== request.workspaceId ||
    row.reservationAccountId !== request.accountId ||
    row.reservationWorkspaceId !== request.workspaceId ||
    row.reservationProjectId !== request.projectId ||
    row.reservationProjectRevisionId !== request.projectRevisionId ||
    row.receiptObjectKey === null ||
    row.receiptObjectKey !== row.reservationObjectKey ||
    row.receiptContentType !== "application/json" ||
    row.receiptContentType !== row.reservationContentType ||
    !Number.isSafeInteger(contentLength) ||
    contentLength < 1 ||
    contentLength > MAX_MANIFEST_BYTES ||
    contentLength !== Number(row.reservationContentLength) ||
    row.receiptChecksumSha256 !== request.sha256 ||
    row.receiptChecksumSha256 !== row.reservationChecksumSha256 ||
    row.receiptDeletedAt !== null ||
    row.reservationMethod !== "PUT" ||
    row.reservationLane !== "RENDER" ||
    row.reservationState !== "COMMITTED"
  )
    return null;
  return Object.freeze({ objectKey: row.receiptObjectKey, contentLength });
}

async function readExactDocument(
  bucket: HostedR2BucketBinding,
  objectKey: string,
  contentLength: number,
  checksumSha256: Sha256,
): Promise<Readonly<Record<string, unknown>> | null> {
  const head = await bucket.head(objectKey);
  if (
    !head ||
    head.size !== contentLength ||
    head.size > MAX_MANIFEST_BYTES ||
    head.httpMetadata?.contentType !== "application/json" ||
    checksumFromR2(head.checksums?.sha256) !== checksumSha256
  )
    return null;
  const object = await bucket.get(objectKey);
  if (
    !object ||
    object.size !== contentLength ||
    object.size > MAX_MANIFEST_BYTES ||
    object.httpMetadata?.contentType !== "application/json"
  )
    return null;
  const bytes = await object.arrayBuffer();
  if (bytes.byteLength !== contentLength || (await sha256Bytes(bytes)) !== checksumSha256)
    return null;
  let document: unknown;
  try {
    document = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
  } catch {
    return null;
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) return null;
  const validated = validateContract("resolvedRenderManifest", document);
  if (!validated.success || canonicalSha256(validated.data) !== checksumSha256) return null;
  return document as Readonly<Record<string, unknown>>;
}

function productionDependencies(
  config: HostedRuntimeConfiguration,
): V213ResolvedRenderManifestReadDependencies {
  const pool = createNeonPool(config.neon.databaseUrl);
  const database = createNeonExecutor(pool);
  return {
    claimAndLoad: async ({ tokenSha256, nonceSha256, request }) =>
      database.transaction(async (transaction) => {
        await transaction.query("SELECT set_config($1,$2,true)", [
          "videoforge.account_id",
          request.accountId,
        ]);
        const claim = await transaction.query<{ claim: unknown }>(
          "SELECT public.videoforge_claim_v213_resolved_render_manifest_read($1::jsonb) AS claim",
          [
            JSON.stringify({
              tokenSha256,
              fullLiveAuthorityId: request.fullLiveAuthorityId,
              operationId: request.operationId,
              outerStateSha256: request.outerStateSha256,
              materializationRequestSha256: request.materializationRequestSha256,
              accountId: request.accountId,
              workspaceId: request.workspaceId,
              projectId: request.projectId,
              projectRevisionId: request.projectRevisionId,
              artifactUri: request.artifactUri,
              sha256: request.sha256,
              issuedAt: request.issuedAt,
              nonceSha256,
              requestSha256: request.requestSha256,
            }),
          ],
        );
        const claimed = claim.rows[0]?.claim;
        if (
          claim.rows.length !== 1 ||
          !claimed ||
          typeof claimed !== "object" ||
          Array.isArray(claimed) ||
          !exactKeys(claimed as Record<string, unknown>, ["claimed"]) ||
          (claimed as Record<string, unknown>).claimed !== true
        )
          throw new Error("V213_RESOLVED_RENDER_MANIFEST_CLAIM_REJECTED");
        const result = await transaction.query<Record<string, unknown>>(
          `SELECT plan.payload,
                  plan.payload_sha256 AS "payloadSha256",
                  owned_workspace.account_id::text AS "ownershipAccountId",
                  owned_workspace.id::text AS "ownershipWorkspaceId",
                  owned_project.id::text AS "ownershipProjectId",
                  owned_revision.id::text AS "ownershipProjectRevisionId",
                  owned_revision.status AS "ownershipRevisionStatus",
                  matched.matching_object_count AS "matchingObjectCount",
                  matched.artifact_receipt_id AS "artifactReceiptId",
                  receipt.id::text AS "receiptId",
                  receipt.account_id::text AS "receiptAccountId",
                  receipt.workspace_id::text AS "receiptWorkspaceId",
                  receipt.object_key AS "receiptObjectKey",
                  receipt.content_type AS "receiptContentType",
                  receipt.content_length AS "receiptContentLength",
                  receipt.checksum_sha256 AS "receiptChecksumSha256",
                  receipt.deleted_at AS "receiptDeletedAt",
                  reservation.id::text AS "reservationId",
                  reservation.account_id::text AS "reservationAccountId",
                  reservation.workspace_id::text AS "reservationWorkspaceId",
                  reservation.project_id::text AS "reservationProjectId",
                  reservation.project_revision_id::text AS "reservationProjectRevisionId",
                  reservation.object_key AS "reservationObjectKey",
                  reservation.method AS "reservationMethod",
                  reservation.lane AS "reservationLane",
                  reservation.state AS "reservationState",
                  reservation.content_type AS "reservationContentType",
                  reservation.content_length AS "reservationContentLength",
                  reservation.checksum_sha256 AS "reservationChecksumSha256"
             FROM hosted_render_plans AS plan
             JOIN workspaces AS owned_workspace
               ON owned_workspace.account_id=plan.account_id
              AND owned_workspace.id=plan.workspace_id
             JOIN projects AS owned_project
               ON owned_project.account_id=owned_workspace.account_id
              AND owned_project.workspace_id=owned_workspace.id
              AND owned_project.id=plan.project_id
             JOIN project_revisions AS owned_revision
               ON owned_revision.account_id=owned_project.account_id
              AND owned_revision.workspace_id=owned_project.workspace_id
              AND owned_revision.project_id=owned_project.id
              AND owned_revision.id=plan.project_revision_id
             CROSS JOIN LATERAL (
               SELECT count(*)::integer AS matching_object_count,
                      min(candidate->>'artifact_receipt_id') AS artifact_receipt_id
                 FROM jsonb_array_elements(
                   CASE WHEN jsonb_typeof(plan.payload->'objects')='array'
                        THEN plan.payload->'objects' ELSE '[]'::jsonb END
                 ) AS candidate
                WHERE candidate->>'uri'=$5
             ) AS matched
             LEFT JOIN artifact_receipts AS receipt
               ON receipt.account_id=plan.account_id
              AND receipt.workspace_id=plan.workspace_id
              AND receipt.id=CASE WHEN matched.artifact_receipt_id ~
                '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                THEN matched.artifact_receipt_id::uuid ELSE NULL END
             LEFT JOIN artifact_reservations AS reservation
               ON reservation.account_id=receipt.account_id
              AND reservation.workspace_id=receipt.workspace_id
              AND reservation.id=receipt.reservation_id
              AND reservation.project_id=plan.project_id
              AND reservation.project_revision_id=plan.project_revision_id
            WHERE plan.account_id=$1::uuid AND plan.workspace_id=$2::uuid
              AND plan.project_id=$3::uuid AND plan.project_revision_id=$4::uuid`,
          [
            request.accountId,
            request.workspaceId,
            request.projectId,
            request.projectRevisionId,
            request.artifactUri,
          ],
        );
        if (result.rows.length !== 1) return null;
        return result.rows[0] as unknown as V213ResolvedRenderManifestProjection;
      }),
    close: () => pool.end(),
  };
}

export async function handleV213ResolvedRenderManifestRequest(
  request: Request,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  injected?: V213ResolvedRenderManifestReadDependencies,
  now: () => Date = () => new Date(),
): Promise<Response | null> {
  if (new URL(request.url).pathname !== V213_RESOLVED_RENDER_MANIFEST_PATH) return null;
  if (request.method !== "POST") return notFound();
  if (config.environment !== "production" || config.gpuTransport !== "QUALIFIED_EXACT")
    return json({ error: { code: "V213_RESOLVED_RENDER_MANIFEST_DISABLED" } }, 503);
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/u)?.[1];
  const expectedToken = environment.VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN;
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !token ||
    !expectedToken ||
    token !== expectedToken ||
    !Number.isSafeInteger(declaredLength) ||
    declaredLength < 1 ||
    declaredLength > MAX_REQUEST_BYTES ||
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  )
    return notFound();
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength !== declaredLength) return notFound();
  let parsed: V213ResolvedRenderManifestReadRequest | null = null;
  try {
    parsed = parseRequest(JSON.parse(raw), now());
  } catch {
    parsed = null;
  }
  if (!parsed || !(await verifyHmac(token, raw, request.headers.get("x-videoforge-signature"))))
    return notFound();
  const bucket = environment.PRIVATE_ARTIFACTS;
  if (!bucket) return json({ error: { code: "V213_RESOLVED_RENDER_MANIFEST_UNAVAILABLE" } }, 503);
  const dependencies = injected ?? productionDependencies(config);
  try {
    const row = await dependencies.claimAndLoad({
      tokenSha256: await sha256(token),
      nonceSha256: await sha256(parsed.nonce),
      request: parsed,
    });
    const projection = exactProjection(row, parsed);
    if (!projection)
      return json({ error: { code: "V213_RESOLVED_RENDER_MANIFEST_REJECTED" } }, 409);
    const document = await readExactDocument(
      bucket,
      projection.objectKey,
      projection.contentLength,
      parsed.sha256,
    );
    if (!document) return json({ error: { code: "V213_RESOLVED_RENDER_MANIFEST_REJECTED" } }, 409);
    return json(
      {
        schemaVersion: "videoforge.v213-resolved-render-manifest-read-result/v1",
        fullLiveAuthorityId: parsed.fullLiveAuthorityId,
        operationId: parsed.operationId,
        outerStateSha256: parsed.outerStateSha256,
        materializationRequestSha256: parsed.materializationRequestSha256,
        accountId: parsed.accountId,
        workspaceId: parsed.workspaceId,
        projectId: parsed.projectId,
        projectRevisionId: parsed.projectRevisionId,
        sha256: parsed.sha256,
        requestSha256: parsed.requestSha256,
        document,
      },
      200,
    );
  } catch {
    return json({ error: { code: "V213_RESOLVED_RENDER_MANIFEST_REJECTED" } }, 409);
  } finally {
    try {
      await dependencies.close();
    } catch {
      // The request nonce is already durably claimed. Pool shutdown is best-effort and must not
      // replace the exact read result or rejection already computed from that claimed request.
    }
  }
}
