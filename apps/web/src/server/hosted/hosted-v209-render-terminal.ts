import { validateAndHashContractDocument } from "@videoforge/contracts";
import type { Sha256, TransactionalSqlExecutor } from "@videoforge/control-plane";

import type { HostedR2BucketBinding } from "./configuration";
import { canonicalJson } from "./submission";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
type Row = Record<string, unknown>;

function record(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("HOSTED_V209_RENDER_TERMINAL_INVALID");
  return value as Row;
}

function text(value: unknown, pattern?: RegExp): string {
  if (typeof value !== "string" || (pattern && !pattern.test(value)))
    throw new Error("HOSTED_V209_RENDER_TERMINAL_INVALID");
  return value;
}

function positiveInteger(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error("HOSTED_V209_RENDER_TERMINAL_INVALID");
  return parsed;
}

async function sha256(bytes: ArrayBuffer): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function headSha256(value: ArrayBuffer | undefined): `sha256:${string}` | null {
  if (!value || value.byteLength !== 32) return null;
  return `sha256:${[...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function readCandidate(
  database: TransactionalSqlExecutor,
  scope: Readonly<{ accountId: string; workspaceId: string; attemptId: string }>,
): Promise<Row> {
  return database.transaction(async (transaction) => {
    const result = await transaction.query<{ candidate: unknown }>(
      "SELECT public.videoforge_read_v209_render_terminal_candidate($1::uuid,$2::uuid,$3::uuid) AS candidate",
      [scope.accountId, scope.workspaceId, scope.attemptId],
    );
    if (result.rows.length !== 1 || result.rows[0]?.candidate == null)
      throw new Error("HOSTED_V209_RENDER_TERMINAL_NOT_FOUND");
    return record(result.rows[0].candidate);
  });
}

function validateCandidate(
  candidate: Row,
  scope: Readonly<{ accountId: string; workspaceId: string; attemptId: string }>,
): void {
  if (
    candidate.schemaVersion !== "videoforge.v2-09-render-terminal-candidate/v1" ||
    candidate.accountId !== scope.accountId ||
    candidate.workspaceId !== scope.workspaceId ||
    candidate.attemptId !== scope.attemptId ||
    candidate.attemptState !== "SUCCEEDED" ||
    candidate.leaseState !== "RELEASED" ||
    candidate.leaseReleaseReason !== "HOSTED_PAIR_OUTPUTS_ACCEPTED" ||
    !UUID.test(text(candidate.runtimeId)) ||
    !UUID.test(text(candidate.generationRequestId)) ||
    !UUID.test(text(candidate.leaseId)) ||
    Number(candidate.renderAttemptCount) !== 1 ||
    Number(candidate.runtimeCount) !== 1 ||
    Number(candidate.leaseCount) !== 1 ||
    !SHA256.test(text(candidate.renderManifestSha256)) ||
    !SHA256.test(text(candidate.planPayloadSha256)) ||
    candidate.attemptRequestSha256 !== candidate.planPayloadSha256
  )
    throw new Error("HOSTED_V209_RENDER_TERMINAL_INVALID");
  const plan = record(candidate.planPayload);
  const input = record(plan.input_document);
  const manifest = record(input.resolved_render_manifest);
  if (
    plan.schema_version !== "videoforge-hosted-cpu-submission/v1" ||
    plan.kind !== "RENDER" ||
    plan.project_id !== candidate.projectId ||
    plan.project_revision_id !== candidate.projectRevisionId ||
    input.schema_version !== "render-job-input/v1" ||
    input.project_revision_id !== candidate.projectRevisionId ||
    manifest.sha256 !== candidate.renderManifestSha256
  )
    throw new Error("HOSTED_V209_RENDER_TERMINAL_INVALID");
}

async function loadFreshFinalOutput(
  bucket: HostedR2BucketBinding,
  candidate: Row,
): Promise<Readonly<Row>> {
  const resultKey = text(candidate.resultObjectKey);
  const resultLength = positiveInteger(candidate.resultContentLength);
  const resultSha256 = text(candidate.resultChecksumSha256, SHA256);
  if (
    resultLength > 1_048_576 ||
    candidate.resultReceiptSha256 == null ||
    !SHA256.test(text(candidate.resultReceiptSha256)) ||
    resultKey !== candidate.resultAuthorityObjectKey ||
    candidate.resultAuthorityContentType !== "application/json" ||
    resultLength !== Number(candidate.resultAuthorityContentLength) ||
    resultSha256 !== candidate.resultAuthorityChecksumSha256
  )
    throw new Error("HOSTED_V209_RENDER_TERMINAL_INVALID");
  const resultObject = await bucket.get(resultKey);
  if (
    !resultObject ||
    resultObject.size !== resultLength ||
    resultObject.httpMetadata?.contentType !== "application/json"
  )
    throw new Error("HOSTED_V209_RENDER_RESULT_DRIFT");
  const bytes = await resultObject.arrayBuffer();
  if (bytes.byteLength !== resultLength || (await sha256(bytes)) !== resultSha256)
    throw new Error("HOSTED_V209_RENDER_RESULT_DRIFT");
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw new Error("HOSTED_V209_RENDER_RESULT_DRIFT");
  }
  const result = await validateAndHashContractDocument("renderJobResult", decoded as never);
  const primaryLength = positiveInteger(candidate.primaryContentLength);
  if (
    result.value.status !== "SUCCEEDED" ||
    result.value.attempt_id !== candidate.attemptId ||
    result.value.output.asset_id !== result.value.probe.asset_id ||
    result.value.output.sha256 !== result.value.probe.sha256 ||
    result.value.output.bytes !== result.value.probe.bytes ||
    result.value.output.sha256 !== candidate.primaryChecksumSha256 ||
    result.value.output.bytes !== primaryLength ||
    candidate.primaryContentType !== "video/mp4"
  )
    throw new Error("HOSTED_V209_RENDER_RESULT_DRIFT");
  const primary = await bucket.head(text(candidate.primaryObjectKey));
  if (
    !primary ||
    primary.size !== primaryLength ||
    primary.httpMetadata?.contentType !== "video/mp4" ||
    headSha256(primary.checksums?.sha256) !== candidate.primaryChecksumSha256
  )
    throw new Error("HOSTED_V209_RENDER_OUTPUT_DRIFT");
  return Object.freeze({
    assetId: result.value.output.asset_id,
    checksumSha256: result.value.output.sha256,
    contentLength: result.value.output.bytes,
    contentType: "video/mp4",
    objectKey: candidate.primaryObjectKey,
    probe: result.value.probe,
    renderManifestSha256: candidate.renderManifestSha256,
    resultDocumentSha256: resultSha256,
  });
}

function loadReplayedFinalOutput(candidate: Row): Readonly<Row> {
  if (
    candidate.runtimeStage !== "COMPLETE" ||
    !["ACTIVE", "SUCCEEDED"].includes(text(candidate.generationRequestState)) ||
    !SHA256.test(text(candidate.finalOutputSha256)) ||
    Number(candidate.finalEventCount) !== 1 ||
    !SHA256.test(text(candidate.finalReceiptSha256))
  )
    throw new Error("HOSTED_V209_RENDER_TERMINAL_INVALID");
  const artifact = record(candidate.finalArtifact);
  if (
    artifact.checksumSha256 !== candidate.finalOutputSha256 ||
    artifact.contentType !== "video/mp4"
  )
    throw new Error("HOSTED_V209_RENDER_TERMINAL_INVALID");
  return Object.freeze({
    assetId: text(artifact.assetId),
    checksumSha256: text(artifact.checksumSha256, SHA256),
    contentLength: positiveInteger(artifact.contentLength),
    contentType: "video/mp4",
    objectKey: text(artifact.objectKey),
    probe: record(artifact.probe),
    renderManifestSha256: candidate.renderManifestSha256,
    resultDocumentSha256: text(artifact.resultDocumentSha256, SHA256),
  });
}

export function createHostedV209RenderTerminalHandoff(input: {
  readonly database: TransactionalSqlExecutor;
  readonly bucket: HostedR2BucketBinding;
}) {
  return Object.freeze({
    async acceptCompleted(scope: {
      readonly accountId: string;
      readonly workspaceId: string;
      readonly attemptId: string;
    }) {
      if (
        !UUID.test(scope.accountId) ||
        !UUID.test(scope.workspaceId) ||
        !UUID.test(scope.attemptId)
      )
        throw new Error("HOSTED_V209_RENDER_TERMINAL_INVALID");
      const candidate = await readCandidate(input.database, scope);
      validateCandidate(candidate, scope);
      if (
        (await sha256(
          new TextEncoder().encode(canonicalJson(candidate.planPayload)).buffer as ArrayBuffer,
        )) !== candidate.planPayloadSha256
      )
        throw new Error("HOSTED_V209_RENDER_TERMINAL_INVALID");
      const finalOutput =
        candidate.runtimeStage === "RENDERING" && candidate.generationRequestState === "ACTIVE"
          ? await loadFreshFinalOutput(input.bucket, candidate)
          : loadReplayedFinalOutput(candidate);
      const finalized = await input.database.transaction(async (transaction) => {
        const result = await transaction.query<{ result: unknown }>(
          "SELECT public.videoforge_finalize_v209_render_terminal($1::jsonb) AS result",
          [
            JSON.stringify({
              schemaVersion: "videoforge.v2-09-render-terminal-finalize/v1",
              accountId: scope.accountId,
              workspaceId: scope.workspaceId,
              attemptId: scope.attemptId,
              finalOutput,
            }),
          ],
        );
        if (result.rows.length !== 1) throw new Error("HOSTED_V209_RENDER_TERMINAL_INVALID");
        return record(result.rows[0]?.result);
      });
      if (
        finalized.schemaVersion !== "videoforge.v2-09-render-terminal-result/v1" ||
        finalized.state !== "SUCCEEDED" ||
        finalized.accountId !== scope.accountId ||
        finalized.workspaceId !== scope.workspaceId ||
        finalized.renderAttemptId !== scope.attemptId ||
        finalized.generationRequestId !== candidate.generationRequestId ||
        finalized.runtimeId !== candidate.runtimeId ||
        finalized.finalOutputSha256 !== finalOutput.checksumSha256 ||
        !SHA256.test(text(finalized.finalOutputReceiptSha256)) ||
        typeof finalized.replayed !== "boolean"
      )
        throw new Error("HOSTED_V209_RENDER_TERMINAL_INVALID");
      return Object.freeze({
        state: "SUCCEEDED" as const,
        finalOutputSha256: finalized.finalOutputSha256 as Sha256,
        finalOutputReceiptSha256: finalized.finalOutputReceiptSha256 as Sha256,
        replayed: finalized.replayed,
      });
    },
  });
}
