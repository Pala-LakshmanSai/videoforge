import { createHash } from "node:crypto";

import { canonicalizeJson, type Sha256Digest } from "@videoforge/contracts";
import type { ProviderAcceptedAssetCandidate, ProviderAcceptanceProof } from "@videoforge/pipeline";

import type { SqlExecutor } from "../database/ports.js";

type Row = Record<string, unknown>;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;

export class ProviderRenderAssetError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProviderRenderAssetError";
  }
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new ProviderRenderAssetError(`${name} is missing.`);
  return value;
}

function integer(value: unknown, name: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new ProviderRenderAssetError(`${name} is invalid.`);
  return parsed;
}

function record(value: unknown, name: string): Record<string, unknown> {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new ProviderRenderAssetError(`${name} is invalid.`);
  return parsed as Record<string, unknown>;
}

function digest(value: unknown, name: string): Sha256Digest {
  const parsed = text(value, name);
  if (!SHA256.test(parsed)) throw new ProviderRenderAssetError(`${name} is invalid.`);
  return parsed as Sha256Digest;
}

function verifyAcceptancePayload(
  payloadValue: unknown,
  expectedFingerprint: Sha256Digest,
): Record<string, unknown> {
  const payload = record(payloadValue, "acceptance payload");
  if (payload.acceptanceFingerprintHash !== expectedFingerprint)
    throw new ProviderRenderAssetError("Acceptance payload fingerprint drifted.");
  const base = { ...payload };
  delete base.acceptanceFingerprintHash;
  const actual = `sha256:${createHash("sha256").update(canonicalizeJson(base)).digest("hex")}`;
  if (actual !== expectedFingerprint)
    throw new ProviderRenderAssetError("Acceptance payload is not canonical-fingerprint valid.");
  return payload;
}

function commonProof(
  row: Row,
): Omit<
  ProviderAcceptanceProof,
  "schemaVersion" | "modelLineage" | "promptLineage" | "runtimeEvidence" | "qualityReview"
> {
  const attemptId = text(row.attempt_id, "accepted attempt ID");
  const assetId = text(row.output_asset_id, "accepted asset ID");
  const binarySha256 = digest(row.binary_sha256, "accepted binary checksum");
  if (
    text(row.accepted_attempt_id, "task accepted attempt ID") !== attemptId ||
    text(row.task_state, "task state") !== "COMPLETE" ||
    text(row.attempt_state, "attempt state") !== "SUCCEEDED" ||
    text(row.result_disposition, "result disposition") !== "ACCEPTED" ||
    text(row.attempt_output_asset_id, "attempt output asset ID") !== assetId ||
    text(row.asset_state, "asset state") !== "ACCEPTED" ||
    text(row.asset_id, "asset ID") !== assetId ||
    digest(row.asset_binary_sha256, "asset checksum") !== binarySha256 ||
    text(row.qa_state, "QA state") !== "PASSED" ||
    text(row.qa_asset_id, "QA asset ID") !== assetId
  )
    throw new ProviderRenderAssetError("Durable task, attempt, asset, or QA identity drifted.");
  const reservedMicroUsd = integer(row.reserved_cost_micro_usd, "reserved cost");
  const reportedMicroUsd = integer(row.reported_cost_micro_usd, "reported cost");
  const settledMicroUsd = integer(row.settled_cost_micro_usd, "settled cost");
  if (reservedMicroUsd < reportedMicroUsd || reportedMicroUsd !== settledMicroUsd)
    throw new ProviderRenderAssetError("Durable provider cost lineage is not conserved.");
  return {
    acceptanceFingerprintHash: digest(row.acceptance_fingerprint_hash, "acceptance fingerprint"),
    acceptedAttemptId: attemptId,
    acceptedAssetId: assetId,
    acceptedBinarySha256: binarySha256,
    qaState: "PASSED",
    qaResultId: text(row.qa_result_id, "QA result ID"),
    resultDisposition: "ACCEPTED",
    providerOperation: text(
      record(row.provider_details, "provider details").operation,
      "operation",
    ),
    cost: Object.freeze({ reservedMicroUsd, reportedMicroUsd, settledMicroUsd }),
  };
}

function imageCandidate(row: Row): ProviderAcceptedAssetCandidate {
  const fingerprint = digest(row.acceptance_fingerprint_hash, "acceptance fingerprint");
  const payload = verifyAcceptancePayload(row.acceptance_payload, fingerprint);
  if (text(row.schema_version, "image acceptance schema") !== "videoforge.mage-image-acceptance/v1")
    throw new ProviderRenderAssetError(
      "Only durable Mage acceptance can bind an image render task.",
    );
  const result = record(payload.result, "Mage result");
  const media = record(result.media, "Mage media");
  const proof: ProviderAcceptanceProof = Object.freeze({
    ...commonProof(row),
    schemaVersion: "videoforge.mage-image-acceptance/v1",
    modelLineage: Object.freeze({ ...record(result.providerModel, "Mage model lineage") }),
    promptLineage: Object.freeze({
      inputHash: digest(row.input_hash, "Mage input hash"),
      resultHash: digest(row.result_hash, "Mage result hash"),
      positivePromptHash: digest(row.positive_prompt_hash, "positive prompt hash"),
      negativePromptHash: digest(row.negative_prompt_hash, "negative prompt hash"),
    }),
    runtimeEvidence: Object.freeze({
      ...record(result.runtimeEvidence, "Mage runtime evidence"),
      technicalValidation: record(row.technical_validation, "Mage technical validation"),
    }),
    qualityReview: Object.freeze({ ...record(result.qualityReview, "Mage quality review") }),
  });
  if (digest(media.binarySha256, "Mage payload checksum") !== proof.acceptedBinarySha256)
    throw new ProviderRenderAssetError("Mage payload checksum drifted from durable asset.");
  return Object.freeze({
    taskKey: text(row.task_key, "image task key"),
    assetId: proof.acceptedAssetId,
    sha256: proof.acceptedBinarySha256,
    kind: "IMAGE",
    acceptance: proof,
  });
}

function avatarCandidate(row: Row): ProviderAcceptedAssetCandidate {
  const fingerprint = digest(row.acceptance_fingerprint_hash, "acceptance fingerprint");
  const payload = verifyAcceptancePayload(row.acceptance_payload, fingerprint);
  if (
    text(row.schema_version, "avatar acceptance schema") !==
    "videoforge.avatar-fixture-acceptance/v1"
  )
    throw new ProviderRenderAssetError("Unsupported durable Avatar acceptance schema.");
  const result = record(payload.result, "Avatar result");
  const proof: ProviderAcceptanceProof = Object.freeze({
    ...commonProof(row),
    schemaVersion: "videoforge.avatar-fixture-acceptance/v1",
    modelLineage: Object.freeze({
      fixtureNonProduction: true,
      sourceProfile: text(row.source_profile, "Avatar source profile"),
      rateProfile: text(row.rate_profile, "Avatar rate profile"),
    }),
    promptLineage: Object.freeze({
      inputHash: digest(row.input_hash, "Avatar input hash"),
      resultHash: digest(row.result_hash, "Avatar result hash"),
      runtimeSourceSha256: digest(row.runtime_source_sha256, "Avatar runtime source checksum"),
      spanAudioSha256: digest(row.span_audio_sha256, "Avatar span audio checksum"),
    }),
    runtimeEvidence: Object.freeze({
      technicalValidation: record(row.technical_validation, "Avatar technical validation"),
      frameCount: integer(result.frameCount, "Avatar frame count"),
      durationMs: integer(result.durationMs, "Avatar duration"),
    }),
    qualityReview: Object.freeze({
      subjectiveClassification: text(
        row.subjective_classification,
        "Avatar subjective classification",
      ),
    }),
  });
  if (digest(result.binarySha256, "Avatar payload checksum") !== proof.acceptedBinarySha256)
    throw new ProviderRenderAssetError("Avatar payload checksum drifted from durable asset.");
  return Object.freeze({
    taskKey: text(row.task_key, "avatar task key"),
    assetId: proof.acceptedAssetId,
    sha256: proof.acceptedBinarySha256,
    kind: "AVATAR_CLIP",
    rendererSourceProfile: text(row.source_profile, "Avatar source profile"),
    acceptance: proof,
  });
}

const COST_JOIN = `LEFT JOIN LATERAL (
  SELECT COALESCE(sum(amount_micro_usd) FILTER (WHERE event_type = 'SETTLED'), -1)::int AS settled
  FROM public.cost_events cost
  WHERE cost.workspace_id = accepted.workspace_id
    AND cost.task_id = accepted.task_id
    AND cost.attempt_id = accepted.attempt_id
) cost ON true`;

export class PGliteProviderRenderAssetRepository {
  public constructor(private readonly database: SqlExecutor) {}

  public async resolve(
    workspaceId: string,
    projectRevisionId: string,
    requiredTaskKeys: readonly string[],
  ): Promise<readonly ProviderAcceptedAssetCandidate[]> {
    if (requiredTaskKeys.length === 0 || new Set(requiredTaskKeys).size !== requiredTaskKeys.length)
      throw new ProviderRenderAssetError("Required render task keys must be unique and non-empty.");
    const [images, avatars] = await Promise.all([
      this.database.query<Row>(
        `SELECT task.task_key, task.state AS task_state, task.accepted_attempt_id, attempt.id AS attempt_id,
                attempt.state AS attempt_state, attempt.result_disposition,
                attempt.output_asset_id AS attempt_output_asset_id, attempt.provider_details,
                accepted.output_asset_id, accepted.qa_result_id, accepted.schema_version,
                accepted.input_hash, accepted.result_hash, accepted.acceptance_fingerprint_hash,
                accepted.positive_prompt_hash, accepted.negative_prompt_hash,
                accepted.binary_sha256, accepted.reserved_cost_micro_usd,
                accepted.reported_cost_micro_usd, accepted.technical_validation,
                accepted.acceptance_payload, asset.id AS asset_id, asset.state AS asset_state,
                asset.binary_sha256 AS asset_binary_sha256, qa.state AS qa_state,
                qa.asset_id AS qa_asset_id, cost.settled AS settled_cost_micro_usd
           FROM public.image_generation_acceptances accepted
           JOIN public.generation_tasks task ON task.workspace_id=accepted.workspace_id AND task.id=accepted.task_id
           JOIN public.attempts attempt ON attempt.workspace_id=accepted.workspace_id AND attempt.id=accepted.attempt_id
           JOIN public.assets asset ON asset.workspace_id=accepted.workspace_id AND asset.id=accepted.output_asset_id
           JOIN public.qa_results qa ON qa.workspace_id=accepted.workspace_id AND qa.id=accepted.qa_result_id
           ${COST_JOIN}
          WHERE accepted.workspace_id=$1 AND accepted.project_revision_id=$2`,
        [workspaceId, projectRevisionId],
      ),
      this.database.query<Row>(
        `SELECT task.task_key, task.state AS task_state, task.accepted_attempt_id, attempt.id AS attempt_id,
                attempt.state AS attempt_state, attempt.result_disposition,
                attempt.output_asset_id AS attempt_output_asset_id, attempt.provider_details,
                accepted.output_asset_id, accepted.qa_result_id, accepted.schema_version,
                accepted.input_hash, accepted.result_hash, accepted.acceptance_fingerprint_hash,
                accepted.binary_sha256, accepted.source_profile, accepted.rate_profile,
                accepted.runtime_source_sha256, accepted.span_audio_sha256,
                accepted.subjective_classification, accepted.reserved_cost_micro_usd,
                accepted.reported_cost_micro_usd, accepted.technical_validation,
                accepted.acceptance_payload, asset.id AS asset_id, asset.state AS asset_state,
                asset.binary_sha256 AS asset_binary_sha256, qa.state AS qa_state,
                qa.asset_id AS qa_asset_id, cost.settled AS settled_cost_micro_usd
           FROM public.avatar_generation_acceptances accepted
           JOIN public.generation_tasks task ON task.workspace_id=accepted.workspace_id AND task.id=accepted.task_id
           JOIN public.attempts attempt ON attempt.workspace_id=accepted.workspace_id AND attempt.id=accepted.attempt_id
           JOIN public.assets asset ON asset.workspace_id=accepted.workspace_id AND asset.id=accepted.output_asset_id
           JOIN public.qa_results qa ON qa.workspace_id=accepted.workspace_id AND qa.id=accepted.qa_result_id
           ${COST_JOIN}
          WHERE accepted.workspace_id=$1 AND accepted.project_revision_id=$2`,
        [workspaceId, projectRevisionId],
      ),
    ]);
    const byTaskKey = new Map<string, ProviderAcceptedAssetCandidate>();
    for (const candidate of [
      ...images.rows.map(imageCandidate),
      ...avatars.rows.map(avatarCandidate),
    ]) {
      if (byTaskKey.has(candidate.taskKey))
        throw new ProviderRenderAssetError(
          `Multiple durable acceptances exist for ${candidate.taskKey}.`,
        );
      byTaskKey.set(candidate.taskKey, candidate);
    }
    return Object.freeze(
      requiredTaskKeys.map((taskKey) => {
        const candidate = byTaskKey.get(taskKey);
        if (!candidate)
          throw new ProviderRenderAssetError(
            `No durable accepted provider asset exists for ${taskKey}.`,
          );
        return candidate;
      }),
    );
  }
}
