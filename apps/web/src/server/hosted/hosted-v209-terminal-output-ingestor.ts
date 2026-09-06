import {
  ProvenanceReceiptSigner,
  canonicalSha256,
  type ProvenanceReceipt,
  type Sha256,
  type TransactionalSqlExecutor,
} from "@videoforge/control-plane";

import { verifyV213WorkerReceipt } from "../providers/v213-provenance-receipt";
import {
  createHostedServerlessOutputBarrier,
  hostedOutputBindingSha256,
  type HostedInternalCompletedOutput,
  type HostedOutputBarrierOutcome,
  type HostedServerlessAttemptBinding,
} from "../runtime/hosted-serverless-output-barrier";
import {
  HostedR2OutputArtifactBarrier,
  HostedSqlOutputBarrierRepository,
} from "../runtime/hosted-serverless-output-adapters";
import type { HostedR2BucketBinding } from "./configuration";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LANES = new Set(["mage_image", "soulx_avatar"]);
const MAX_BYTES = Object.freeze({ mage_image: 16 * 1024 * 1024, soulx_avatar: 128 * 1024 * 1024 });

type Lane = "mage_image" | "soulx_avatar";
type JsonRecord = Record<string, unknown>;

export class HostedV209TerminalOutputError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "HostedV209TerminalOutputError";
  }
}

export interface HostedV209TerminalLineage {
  readonly binding: Omit<HostedServerlessAttemptBinding, "expectedObjects">;
  readonly deadlineAt: string;
  readonly requestBody: JsonRecord;
  readonly candidateWork: readonly JsonRecord[];
  readonly accepted?: {
    readonly completedAt: string;
    readonly bindingSha256: Sha256;
    readonly terminalSha256: Sha256;
    readonly provenanceReceiptSha256: Sha256;
    readonly artifactCommitReceiptSha256s: readonly Sha256[];
  };
}

export interface HostedV209TerminalOutputStore {
  readonly atomicBarrier?: true;
  load(input: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly attemptId: string;
    readonly lane: Lane;
    readonly providerJobId: string;
  }): Promise<HostedV209TerminalLineage | null>;
  commitArtifacts(input: {
    readonly lineage: HostedV209TerminalLineage;
    readonly artifacts: readonly VerifiedArtifact[];
    readonly committedAt: string;
    readonly receipt: ProvenanceReceipt;
  }): Promise<{
    readonly state: HostedOutputBarrierOutcome;
    readonly receiptSha256s: readonly Sha256[];
  }>;
}

interface VerifiedArtifact {
  readonly reservationId: string;
  readonly itemId: string;
  readonly objectKey: string;
  readonly contentType: "image/png" | "video/mp4";
  readonly contentLength: number;
  readonly checksumSha256: Sha256;
  readonly probe: Readonly<Record<string, boolean | number | string | null>>;
}

interface ParsedTerminalOutput {
  readonly receipt: ProvenanceReceipt;
  readonly receiptBodyBase64: string;
  readonly items: readonly JsonRecord[];
}

function fail(): never {
  throw new HostedV209TerminalOutputError("HOSTED_V209_TERMINAL_OUTPUT_INVALID");
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function parseOutput(lane: Lane, value: unknown): ParsedTerminalOutput {
  const output = record(value);
  const keys = ["items", "provenance_receipt", "provenance_receipt_body_base64", "status"];
  if (lane === "soulx_avatar") keys.push("carried_forward_item_ids");
  if (
    !exactKeys(output, keys) ||
    output.status !== "SUCCEEDED" ||
    !Array.isArray(output.items) ||
    output.items.length < 1 ||
    output.items.length > 4096 ||
    typeof output.provenance_receipt_body_base64 !== "string"
  )
    fail();
  if (
    lane === "soulx_avatar" &&
    (!Array.isArray(output.carried_forward_item_ids) ||
      output.carried_forward_item_ids.length !== 0)
  )
    fail();
  return {
    receipt: record(output.provenance_receipt) as unknown as ProvenanceReceipt,
    receiptBodyBase64: output.provenance_receipt_body_base64,
    items: output.items.map(record),
  };
}

function sha256Bytes(bytes: ArrayBuffer): Promise<Sha256> {
  return crypto.subtle
    .digest("SHA-256", bytes)
    .then(
      (digest) =>
        `sha256:${[...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("")}` as Sha256,
    );
}

function checksumFromHead(value: ArrayBuffer | undefined): Sha256 | null {
  if (!value || value.byteLength !== 32) return null;
  return `sha256:${[...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function uuidFrom(value: string): string {
  const hex = canonicalSha256({ namespace: "hosted-v209-terminal-output", value }).slice(7, 39);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function string(value: unknown): string {
  if (typeof value !== "string" || value.length < 1) fail();
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail();
  return Number(value);
}

function outputFacts(
  lane: Lane,
  parsed: ParsedTerminalOutput,
  lineage: HostedV209TerminalLineage,
): readonly VerifiedArtifact[] {
  if (
    parsed.receipt.lane !== lane ||
    parsed.items.length !== lineage.candidateWork.length ||
    parsed.receipt.items.length !== lineage.candidateWork.length
  )
    fail();
  const body = record(lineage.requestBody);
  const authorities = body.generated_output_authorities;
  const batch = record(body.batch);
  const batchItems = lane === "mage_image" ? batch.items : batch.spans;
  if (!Array.isArray(authorities) || !Array.isArray(batchItems)) fail();
  if (
    authorities.length !== lineage.candidateWork.length ||
    batchItems.length !== authorities.length
  )
    fail();

  return lineage.candidateWork.map((work, index) => {
    const result = parsed.items[index] ?? fail();
    const receipt = parsed.receipt.items[index] ?? fail();
    const authority = record(authorities[index]);
    const batchItem = record(batchItems[index]);
    const itemId = string(work.taskId);
    const reservationId = string(work.outputReservationId);
    const outputPrefix = string(work.outputPrefix);
    const objectKey = `${outputPrefix}/artifact/${itemId}`;
    const checksumSha256 = string(result.output_sha256) as Sha256;
    const contentLength = positiveInteger(result.output_bytes);
    const contentType = lane === "mage_image" ? "image/png" : "video/mp4";
    const probe = record(result.probe) as VerifiedArtifact["probe"];
    if (
      !UUID.test(itemId) ||
      !UUID.test(reservationId) ||
      !SHA256.test(checksumSha256) ||
      contentLength > MAX_BYTES[lane] ||
      result.item_id !== itemId ||
      result.output_port_reservation_id !== reservationId ||
      result.output_object_key !== objectKey ||
      authority.reservation_id !== reservationId ||
      authority.path !== `/${objectKey}` ||
      authority.content_type !== contentType ||
      authority.max_uses !== 1 ||
      (lane === "mage_image" ? batchItem.scene_id : batchItem.item_id) !== itemId ||
      (lane === "soulx_avatar" && batchItem.output_reservation_id !== reservationId) ||
      receipt.item_id !== itemId ||
      receipt.state !== "SUCCEEDED" ||
      receipt.output_object_key !== objectKey ||
      receipt.output_sha256 !== checksumSha256 ||
      receipt.output_bytes !== contentLength ||
      canonicalSha256(receipt.probe) !== canonicalSha256(probe)
    )
      fail();
    return Object.freeze({
      reservationId,
      itemId,
      objectKey,
      contentType,
      contentLength,
      checksumSha256,
      probe,
    });
  });
}

/** SQL adapter for the post-status boundary. It has no provider transport or redispatch method. */
export class HostedSqlV209TerminalOutputStore implements HostedV209TerminalOutputStore {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  async load(input: Parameters<HostedV209TerminalOutputStore["load"]>[0]) {
    return this.database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        input.accountId,
      ]);
      const result = await transaction.query<JsonRecord>(
        `SELECT attempt.account_id::text, attempt.workspace_id::text,
                attempt.project_id::text, attempt.project_revision_id::text,
                attempt.id::text AS attempt_id, attempt.lane, attempt.state,
                attempt.item_count, attempt.output_prefix, attempt.dispatch_token_sha256,
                attempt.deadline_at, assignment.provider_job_id,
                deployment.id::text AS deployment_id, deployment.endpoint_id_sha256,
                deployment.endpoint_config_sha256, deployment.worker_image_digest,
                deployment.model_manifest_sha256, deployment.volume_id_sha256,
                deployment.volume_manifest_sha256, materialized.envelope_sha256,
                materialized.full_request_sha256, materialized.request_body,
                candidate.candidate_document->'work'->attempt.lane AS candidate_work
           FROM serverless_attempts AS attempt
           JOIN serverless_provider_assignments AS assignment
             ON assignment.account_id=attempt.account_id AND assignment.workspace_id=attempt.workspace_id
            AND assignment.attempt_id=attempt.id AND assignment.is_current
           JOIN serverless_endpoint_deployments AS deployment
             ON deployment.id=attempt.deployment_id AND deployment.lane=attempt.lane
           JOIN hosted_v209_ordinary_lane_materializations AS materialized
             ON materialized.account_id=attempt.account_id
            AND materialized.workspace_id=attempt.workspace_id AND materialized.attempt_id=attempt.id
           JOIN hosted_v209_ordinary_dispatch_candidates AS candidate
             ON candidate.account_id=attempt.account_id AND candidate.workspace_id=attempt.workspace_id
            AND candidate.generation_request_id=attempt.generation_request_id
          WHERE attempt.account_id=$1 AND attempt.workspace_id=$2 AND attempt.id=$3
            AND attempt.lane=$4 AND assignment.provider_job_id=$5`,
        [input.accountId, input.workspaceId, input.attemptId, input.lane, input.providerJobId],
      );
      if (result.rows.length !== 1) return null;
      const row = result.rows[0]!;
      const deadlineAt = new Date(String(row.deadline_at)).toISOString();
      const requestBody = record(row.request_body);
      const requestBodyWithoutEnvelope = Object.fromEntries(
        Object.entries(requestBody).filter(([key]) => key !== "envelope"),
      );
      if (
        row.account_id !== input.accountId ||
        row.workspace_id !== input.workspaceId ||
        row.attempt_id !== input.attemptId ||
        row.lane !== input.lane ||
        row.provider_job_id !== input.providerJobId ||
        !["ASSIGNED", "IN_QUEUE", "IN_PROGRESS", "UPLOADING", "RECONCILING"].includes(
          String(row.state),
        ) ||
        !Array.isArray(row.candidate_work) ||
        !Number.isSafeInteger(Number(row.item_count)) ||
        row.candidate_work.length !== Number(row.item_count) ||
        canonicalSha256(requestBody) !== row.full_request_sha256
      )
        fail();
      return Object.freeze({
        binding: Object.freeze({
          accountId: string(row.account_id),
          workspaceId: string(row.workspace_id),
          projectId: string(row.project_id),
          projectRevisionId: string(row.project_revision_id),
          lane: input.lane,
          attemptId: input.attemptId,
          providerJobId: input.providerJobId,
          dispatchTokenSha256: string(row.dispatch_token_sha256) as Sha256,
          envelopeSha256: string(row.envelope_sha256) as Sha256,
          requestSha256: canonicalSha256(requestBodyWithoutEnvelope),
          deploymentId: string(row.deployment_id),
          endpointIdSha256: string(row.endpoint_id_sha256) as Sha256,
          endpointConfigSha256: string(row.endpoint_config_sha256) as Sha256,
          workerImageDigest: string(row.worker_image_digest) as Sha256,
          modelManifestSha256: string(row.model_manifest_sha256) as Sha256,
          volumeIdSha256: string(row.volume_id_sha256) as Sha256,
          volumeManifestSha256: string(row.volume_manifest_sha256) as Sha256,
        }),
        deadlineAt,
        requestBody,
        candidateWork: row.candidate_work.map(record),
      });
    });
  }

  async commitArtifacts(input: Parameters<HostedV209TerminalOutputStore["commitArtifacts"]>[0]) {
    const binding = input.lineage.binding;
    if (Date.parse(input.committedAt) >= Date.parse(input.lineage.deadlineAt)) fail();
    const receipts = input.artifacts.map((artifact) => {
      const receiptId = uuidFrom(`${binding.attemptId}:${artifact.itemId}:artifact-receipt`);
      const callbackId = `status-finalize-${receiptId}`;
      const facts = {
        schema_version: "artifact-commit-receipt/v3",
        receipt_id: receiptId,
        reservation_id: artifact.reservationId,
        account_id: binding.accountId,
        workspace_id: binding.workspaceId,
        object_key: artifact.objectKey,
        callback_id: callbackId,
        content_type: artifact.contentType,
        content_length: artifact.contentLength,
        checksum_sha256: artifact.checksumSha256,
        probe: artifact.probe,
        retention_class: "PROJECT",
        retain_until: null,
        committed_at: input.committedAt,
      };
      return Object.freeze({
        artifact,
        receiptId,
        callbackId,
        receiptSha256: canonicalSha256(facts),
      });
    });
    await this.database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        binding.accountId,
      ]);
      const locked = await transaction.query<JsonRecord>(
        `SELECT attempt.state, assignment.provider_job_id
           FROM serverless_attempts AS attempt
           JOIN serverless_provider_assignments AS assignment
             ON assignment.attempt_id=attempt.id AND assignment.is_current
          WHERE attempt.account_id=$1 AND attempt.workspace_id=$2 AND attempt.id=$3
          FOR UPDATE OF attempt, assignment`,
        [binding.accountId, binding.workspaceId, binding.attemptId],
      );
      if (
        locked.rows.length !== 1 ||
        locked.rows[0]!.provider_job_id !== binding.providerJobId ||
        !["ASSIGNED", "IN_QUEUE", "IN_PROGRESS", "UPLOADING", "RECONCILING"].includes(
          String(locked.rows[0]!.state),
        )
      )
        fail();
      for (const receipt of receipts) {
        const artifact = receipt.artifact;
        await transaction.query(
          `INSERT INTO artifact_reservations (
             id,account_id,workspace_id,project_id,project_revision_id,asset_id,lane,job_id,
             artifact_id,object_key,method,content_type,content_length,checksum_sha256,expires_at,
             max_uses,used_count,state,retention_class,retain_until,deletion_owner_account_id
           ) VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,'PUT',$10,$11,$12,$13,1,1,'COMMITTED',
                     'PROJECT',NULL,$2)
           ON CONFLICT (id) DO NOTHING`,
          [
            artifact.reservationId,
            binding.accountId,
            binding.workspaceId,
            binding.projectId,
            binding.projectRevisionId,
            binding.lane === "mage_image" ? "MAGE_IMAGE" : "SOULX_AVATAR",
            binding.attemptId,
            artifact.itemId,
            artifact.objectKey,
            artifact.contentType,
            artifact.contentLength,
            artifact.checksumSha256,
            input.lineage.deadlineAt,
          ],
        );
        await transaction.query(
          `INSERT INTO artifact_receipts (
             id,account_id,workspace_id,reservation_id,callback_id,object_key,content_type,
             content_length,checksum_sha256,probe,receipt_sha256,committed_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
           ON CONFLICT (account_id,workspace_id,reservation_id) DO NOTHING`,
          [
            receipt.receiptId,
            binding.accountId,
            binding.workspaceId,
            artifact.reservationId,
            receipt.callbackId,
            artifact.objectKey,
            artifact.contentType,
            artifact.contentLength,
            artifact.checksumSha256,
            JSON.stringify(artifact.probe),
            receipt.receiptSha256,
            input.committedAt,
          ],
        );
      }
      const exact = await transaction.query<JsonRecord>(
        `SELECT reservation.id::text AS reservation_id, reservation.artifact_id,
                reservation.object_key, reservation.content_type, reservation.content_length,
                reservation.checksum_sha256, reservation.state, receipt.receipt_sha256
           FROM artifact_reservations AS reservation
           JOIN artifact_receipts AS receipt ON receipt.account_id=reservation.account_id
            AND receipt.workspace_id=reservation.workspace_id AND receipt.reservation_id=reservation.id
          WHERE reservation.account_id=$1 AND reservation.workspace_id=$2
            AND reservation.job_id=$3 AND reservation.id=ANY($4::uuid[])
          ORDER BY reservation.artifact_id COLLATE "C"`,
        [
          binding.accountId,
          binding.workspaceId,
          binding.attemptId,
          `{${input.artifacts.map((artifact) => artifact.reservationId).join(",")}}`,
        ],
      );
      const expected = new Map(
        receipts.map((receipt) => [receipt.artifact.reservationId, receipt]),
      );
      if (
        exact.rows.length !== receipts.length ||
        exact.rows.some((row) => {
          const wanted = expected.get(String(row.reservation_id));
          return (
            !wanted ||
            row.artifact_id !== wanted.artifact.itemId ||
            row.object_key !== wanted.artifact.objectKey ||
            row.content_type !== wanted.artifact.contentType ||
            Number(row.content_length) !== wanted.artifact.contentLength ||
            row.checksum_sha256 !== wanted.artifact.checksumSha256 ||
            row.state !== "COMMITTED" ||
            row.receipt_sha256 !== wanted.receiptSha256
          );
        })
      )
        fail();
    });
    return Object.freeze({
      state: "LANE_COMPLETED" as const,
      receiptSha256s: Object.freeze(receipts.map((receipt) => receipt.receiptSha256).sort()),
    });
  }
}

/** Reconciler-role adapter: uses only the narrow 0075 SECURITY DEFINER projections. */
export class HostedSqlFunctionV209TerminalOutputStore implements HostedV209TerminalOutputStore {
  readonly atomicBarrier = true as const;
  constructor(private readonly database: TransactionalSqlExecutor) {}

  async load(input: Parameters<HostedV209TerminalOutputStore["load"]>[0]) {
    return this.database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        input.accountId,
      ]);
      const result = await transaction.query<{ lineage: unknown }>(
        `SELECT public.videoforge_read_hosted_v209_terminal_lineage(
           $1::uuid,$2::uuid,$3::uuid,$4,$5) AS lineage`,
        [input.accountId, input.workspaceId, input.attemptId, input.lane, input.providerJobId],
      );
      const value = result.rows[0]?.lineage;
      const projection = record(value);
      const expectedKeys = [
        "schemaVersion",
        "binding",
        "deadlineAt",
        "requestBody",
        "candidateWork",
      ];
      if (Object.hasOwn(projection, "accepted")) expectedKeys.push("accepted");
      if (
        !exactKeys(projection, expectedKeys) ||
        projection.schemaVersion !== "videoforge.hosted-v209-terminal-lineage/v1" ||
        !Array.isArray(projection.candidateWork)
      )
        return null;
      const binding = record(projection.binding);
      const requestBody = record(projection.requestBody);
      const requestWithoutEnvelope = Object.fromEntries(
        Object.entries(requestBody).filter(([key]) => key !== "envelope"),
      );
      if (
        binding.accountId !== input.accountId ||
        binding.workspaceId !== input.workspaceId ||
        binding.attemptId !== input.attemptId ||
        binding.lane !== input.lane ||
        binding.providerJobId !== input.providerJobId ||
        binding.requestSha256 !== canonicalSha256(requestWithoutEnvelope) ||
        typeof projection.deadlineAt !== "string" ||
        !Number.isFinite(Date.parse(projection.deadlineAt))
      )
        fail();
      const acceptedValue = Object.hasOwn(projection, "accepted")
        ? record(projection.accepted)
        : null;
      const accepted =
        acceptedValue === null
          ? undefined
          : {
              completedAt: string(acceptedValue.completedAt),
              bindingSha256: string(acceptedValue.bindingSha256) as Sha256,
              terminalSha256: string(acceptedValue.terminalSha256) as Sha256,
              provenanceReceiptSha256: string(acceptedValue.provenanceReceiptSha256) as Sha256,
              artifactCommitReceiptSha256s: Object.freeze(
                Array.isArray(acceptedValue.artifactCommitReceiptSha256s)
                  ? acceptedValue.artifactCommitReceiptSha256s.map(
                      (value) => string(value) as Sha256,
                    )
                  : fail(),
              ),
            };
      return Object.freeze({
        binding: binding as unknown as HostedV209TerminalLineage["binding"],
        deadlineAt: projection.deadlineAt,
        requestBody,
        candidateWork: Object.freeze(projection.candidateWork.map(record)),
        ...(accepted === undefined ? {} : { accepted: Object.freeze(accepted) }),
      });
    });
  }

  async commitArtifacts(input: Parameters<HostedV209TerminalOutputStore["commitArtifacts"]>[0]) {
    const binding = input.lineage.binding;
    const receipts = input.artifacts.map((artifact) => {
      const receiptId = uuidFrom(`${binding.attemptId}:${artifact.itemId}:artifact-receipt`);
      const callbackId = `status-finalize-${receiptId}`;
      const facts = {
        schema_version: "artifact-commit-receipt/v3",
        receipt_id: receiptId,
        reservation_id: artifact.reservationId,
        account_id: binding.accountId,
        workspace_id: binding.workspaceId,
        object_key: artifact.objectKey,
        callback_id: callbackId,
        content_type: artifact.contentType,
        content_length: artifact.contentLength,
        checksum_sha256: artifact.checksumSha256,
        probe: artifact.probe,
        retention_class: "PROJECT",
        retain_until: null,
        committed_at: input.committedAt,
      };
      return Object.freeze({
        ...artifact,
        receipt_id: receiptId,
        callback_id: callbackId,
        receipt_sha256: canonicalSha256(facts),
        expires_at: input.lineage.deadlineAt,
        reservation_id: artifact.reservationId,
        item_id: artifact.itemId,
        object_key: artifact.objectKey,
        content_type: artifact.contentType,
        content_length: artifact.contentLength,
        checksum_sha256: artifact.checksumSha256,
      });
    });
    const expectedObjects = Object.freeze(
      input.artifacts.map((artifact) => ({
        itemId: artifact.itemId,
        objectKey: artifact.objectKey,
        contentType: artifact.contentType,
        contentLength: artifact.contentLength,
        checksumSha256: artifact.checksumSha256,
      })),
    );
    const finalBinding: HostedServerlessAttemptBinding = Object.freeze({
      ...binding,
      expectedObjects,
    });
    if (input.lineage.accepted) {
      const accepted = input.lineage.accepted;
      const storedTerminalSha256 = canonicalSha256({
        schema_version: "videoforge-hosted-serverless-terminal-output/v1",
        transport_status: "COMPLETED",
        provenance_receipt_sha256: input.receipt.receipt_sha256,
        artifact_commit_receipt_sha256s: [...accepted.artifactCommitReceiptSha256s].sort(),
      });
      if (
        input.receipt.receipt_sha256 !== accepted.provenanceReceiptSha256 ||
        hostedOutputBindingSha256(finalBinding) !== accepted.bindingSha256 ||
        storedTerminalSha256 !== accepted.terminalSha256
      )
        fail();
      return Object.freeze({
        state: "DUPLICATE_IDEMPOTENT" as const,
        receiptSha256s: accepted.artifactCommitReceiptSha256s,
      });
    }
    const receiptHashes = receipts.map((receipt) => receipt.receipt_sha256).sort();
    const terminalSha256 = canonicalSha256({
      schema_version: "videoforge-hosted-serverless-terminal-output/v1",
      transport_status: "COMPLETED",
      provenance_receipt_sha256: input.receipt.receipt_sha256,
      artifact_commit_receipt_sha256s: receiptHashes,
    });
    const result = await this.database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        binding.accountId,
      ]);
      return transaction.query<{ accepted: unknown }>(
        `SELECT public.videoforge_accept_hosted_v209_terminal_output(
           $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::jsonb,$8::jsonb,$9::timestamptz) AS accepted`,
        [
          binding.accountId,
          binding.workspaceId,
          binding.attemptId,
          binding.providerJobId,
          hostedOutputBindingSha256(finalBinding),
          terminalSha256,
          JSON.stringify(input.receipt),
          JSON.stringify(
            receipts.map((receipt) => ({
              receipt_id: receipt.receipt_id,
              callback_id: receipt.callback_id,
              receipt_sha256: receipt.receipt_sha256,
              expires_at: receipt.expires_at,
              reservation_id: receipt.reservation_id,
              item_id: receipt.item_id,
              object_key: receipt.object_key,
              content_type: receipt.content_type,
              content_length: receipt.content_length,
              checksum_sha256: receipt.checksum_sha256,
              probe: receipt.probe,
            })),
          ),
          input.committedAt,
        ],
      );
    });
    const accepted = record(result.rows[0]?.accepted);
    if (
      !["LANE_COMPLETED", "DUPLICATE_IDEMPOTENT"].includes(String(accepted.state)) ||
      !Array.isArray(accepted.artifactCommitReceiptSha256s) ||
      canonicalSha256([...accepted.artifactCommitReceiptSha256s].sort()) !==
        canonicalSha256(receiptHashes)
    )
      fail();
    return Object.freeze({
      state: accepted.state as HostedOutputBarrierOutcome,
      receiptSha256s: Object.freeze(receiptHashes as Sha256[]),
    });
  }
}

export interface HostedV209TerminalOutputIngestorInput {
  readonly database: TransactionalSqlExecutor;
  readonly bucket: HostedR2BucketBinding;
  readonly receiptKeyId: string;
  readonly receiptKey: Uint8Array;
  readonly store?: HostedV209TerminalOutputStore;
  readonly acceptBarrier?: (
    binding: HostedServerlessAttemptBinding,
    completed: HostedInternalCompletedOutput,
  ) => Promise<HostedOutputBarrierOutcome>;
}

/** Consumes one already-observed COMPLETED result. There is intentionally no dispatch method. */
export function createHostedV209TerminalOutputIngestor(
  input: HostedV209TerminalOutputIngestorInput,
) {
  const signer = new ProvenanceReceiptSigner(input.receiptKeyId, input.receiptKey);
  const store = input.store ?? new HostedSqlV209TerminalOutputStore(input.database);
  return Object.freeze({
    async acceptCompleted(request: {
      readonly accountId: string;
      readonly workspaceId: string;
      readonly attemptId: string;
      readonly lane: Lane;
      readonly providerJobId: string;
      readonly output: unknown;
      readonly observedAt: string;
    }) {
      if (
        !UUID.test(request.accountId) ||
        !UUID.test(request.workspaceId) ||
        !UUID.test(request.attemptId) ||
        !LANES.has(request.lane) ||
        typeof request.providerJobId !== "string" ||
        request.providerJobId.length < 1 ||
        !Number.isFinite(Date.parse(request.observedAt))
      )
        fail();
      const lineage = await store.load(request);
      if (!lineage) fail();
      const parsed = parseOutput(request.lane, request.output);
      verifyV213WorkerReceipt(
        signer,
        { receipt: parsed.receipt, receiptBodyBase64: parsed.receiptBodyBase64 },
        {
          dispatchTokenSha256: lineage.binding.dispatchTokenSha256,
          envelopeSha256: lineage.binding.envelopeSha256,
          requestSha256: lineage.binding.requestSha256,
          attemptId: request.attemptId,
          providerJobId: request.providerJobId,
          accountId: request.accountId,
          workspaceId: request.workspaceId,
          deploymentId: lineage.binding.deploymentId,
          endpointIdSha256: lineage.binding.endpointIdSha256,
          containerDigest: lineage.binding.workerImageDigest,
          volumeIdSha256: lineage.binding.volumeIdSha256,
          volumeManifestSha256: lineage.binding.volumeManifestSha256,
          modelManifestSha256: lineage.binding.modelManifestSha256,
          gpuAllowlist: ["NVIDIA GeForce RTX 4090"],
          seenNonces: new Set(),
        },
      );
      const declared = outputFacts(request.lane, parsed, lineage);
      const verified: VerifiedArtifact[] = [];
      for (const artifact of declared) {
        const head = await input.bucket.head(artifact.objectKey);
        const headChecksum = checksumFromHead(head?.checksums?.sha256);
        if (
          !head ||
          head.size !== artifact.contentLength ||
          head.httpMetadata?.contentType !== artifact.contentType ||
          (headChecksum !== null && headChecksum !== artifact.checksumSha256)
        )
          fail();
        const object = await input.bucket.get(artifact.objectKey);
        if (
          !object ||
          object.size !== artifact.contentLength ||
          object.httpMetadata?.contentType !== artifact.contentType
        )
          fail();
        const bytes = await object.arrayBuffer();
        if (
          bytes.byteLength !== artifact.contentLength ||
          (await sha256Bytes(bytes)) !== artifact.checksumSha256
        )
          fail();
        verified.push(artifact);
      }
      const committed = await store.commitArtifacts({
        lineage,
        artifacts: verified,
        committedAt: request.observedAt,
        receipt: parsed.receipt,
      });
      const commitHashes = committed.receiptSha256s;
      const binding: HostedServerlessAttemptBinding = Object.freeze({
        ...lineage.binding,
        expectedObjects: Object.freeze(
          verified.map((artifact) => ({
            itemId: artifact.itemId,
            objectKey: artifact.objectKey,
            contentType: artifact.contentType,
            contentLength: artifact.contentLength,
            checksumSha256: artifact.checksumSha256,
          })),
        ),
      });
      let outcome = committed.state;
      let acceptBarrier = input.acceptBarrier;
      const atomicBarrier = "atomicBarrier" in store && store.atomicBarrier === true;
      if (atomicBarrier) acceptBarrier = undefined;
      if (!atomicBarrier && !acceptBarrier) {
        const scopedRepository = new HostedSqlOutputBarrierRepository(input.database, {
          accountId: request.accountId,
          workspaceId: request.workspaceId,
        });
        if (!(await scopedRepository.schemaReady())) fail();
        acceptBarrier = createHostedServerlessOutputBarrier({
          signer,
          artifacts: new HostedR2OutputArtifactBarrier(input.database, input.bucket),
          repository: scopedRepository,
        }).acceptCompleted;
      }
      if (acceptBarrier) {
        outcome = await acceptBarrier(binding, {
          transportStatus: "COMPLETED",
          receipt: parsed.receipt,
          artifactCommitReceiptSha256s: commitHashes,
          observedAt: request.observedAt,
        });
      }
      return Object.freeze({
        state: outcome,
        attemptId: request.attemptId,
        lane: request.lane,
        acceptedItemCount: verified.length,
        artifactCommitReceiptSha256s: commitHashes,
      });
    },
  });
}
