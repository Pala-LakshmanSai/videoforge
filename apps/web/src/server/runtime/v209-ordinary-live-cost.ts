import { sha256CanonicalJson } from "@videoforge/contracts";

import type { V209ShortAdmissionObservation } from "./v209-short-live-cost";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const FRESH_MS = 5 * 60_000;
const MAX_RATE = 1_116_000;

type JsonRecord = Record<string, unknown>;

export interface V209OrdinaryWork {
  readonly mage_image: readonly JsonRecord[];
  readonly soulx_avatar: readonly JsonRecord[];
}

export interface V209OrdinaryLiveAdmission {
  readonly schemaVersion: "videoforge-v2-09-ordinary-admission/v1";
  readonly candidateSha256: `sha256:${string}`;
  readonly generationPlanSha256: `sha256:${string}`;
  readonly workManifestSha256: `sha256:${string}`;
  readonly work: V209OrdinaryWork;
  readonly cost: Readonly<{
    maximumFlexRateMicroUsdPerGpuHour: 1_116_000;
    primaryExecutionForecastMicroUsd: 744_000;
    possibleDuplicateLiabilityMicroUsd: 744_000;
    settlementReserveMicroUsd: 512_000;
    hardVariableCostCeilingMicroUsd: 2_000_000;
    combinedCompletionCapMicroUsd: 17_500_000;
    noRedispatch: true;
  }>;
  readonly billingBaselineMicroUsd: number;
  readonly billingBaselineCheckedAt: string;
  readonly databaseNow: string;
  readonly providerObservedAt: string;
  readonly cancelAt: string;
  readonly stopAt: string;
  readonly admissionSha256: `sha256:${string}`;
}

export async function assertV209OrdinaryCandidate(rawCandidate: unknown): Promise<{
  readonly candidate: JsonRecord;
  readonly work: V209OrdinaryWork;
}> {
  const candidate = record(rawCandidate);
  if (
    !candidate ||
    candidate.schemaVersion !== "videoforge.hosted-v209-ordinary-dispatch/v1" ||
    typeof candidate.candidateSha256 !== "string" ||
    !SHA256.test(candidate.candidateSha256) ||
    typeof candidate.generationPlanSha256 !== "string" ||
    !SHA256.test(candidate.generationPlanSha256) ||
    typeof candidate.workManifestSha256 !== "string" ||
    !SHA256.test(candidate.workManifestSha256)
  )
    throw new RangeError("V209_ORDINARY_CANDIDATE_INVALID");
  const candidateBase = { ...candidate };
  delete candidateBase.candidateSha256;
  delete candidateBase.replayed;
  delete candidateBase.pairExists;
  delete candidateBase.existingWorkflowId;
  if ((await sha256CanonicalJson(candidateBase)) !== candidate.candidateSha256)
    throw new RangeError("V209_ORDINARY_CANDIDATE_HASH_INVALID");
  const work = exactWork(candidate.work, candidate);
  if ((await sha256CanonicalJson(work)) !== candidate.workManifestSha256)
    throw new RangeError("V209_ORDINARY_WORK_HASH_INVALID");
  return Object.freeze({ candidate, work });
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function exactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function epoch(value: string, code: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new RangeError(code);
  return time;
}

function exactWork(value: unknown, candidate: JsonRecord): V209OrdinaryWork {
  const work = record(value);
  if (!work || !exactKeys(work, ["mage_image", "soulx_avatar"]))
    throw new RangeError("V209_ORDINARY_WORK_INVALID");
  const mageKeys = [
    "compiledPrompt",
    "inputReservationId",
    "outputPrefix",
    "outputReservationId",
    "promptResultId",
    "promptSha256",
    "positivePromptSha256",
    "negativePromptSha256",
    "role",
    "segmentId",
    "styleProfileSha256",
    "styleVersionId",
    "taskId",
  ];
  const soulxKeys = [
    "avatarSourceContentLength",
    "avatarSourceContentType",
    "avatarSourceAssetId",
    "avatarSourceObjectKey",
    "avatarSourceSha256",
    "outputPrefix",
    "outputReservationId",
    "paddedEndMsExclusive",
    "paddedStartMs",
    "role",
    "segmentId",
    "sourceVoiceoverAssetId",
    "sourceVoiceoverContentLength",
    "sourceVoiceoverContentType",
    "sourceVoiceoverObjectKey",
    "sourceVoiceoverSha256",
    "spanAudioId",
    "spanAudioAssetId",
    "spanAudioChannels",
    "spanAudioContentLength",
    "spanAudioContentType",
    "spanAudioInputReservationId",
    "spanAudioObjectKey",
    "spanAudioSampleRateHz",
    "spanAudioSha256",
    "paddedSamples48k",
    "trimEndSampleExclusive48k",
    "trimStartSample48k",
    "taskId",
    "selectedEndMsExclusive",
    "selectedStartMs",
    "trimEndMsExclusive",
    "trimStartMs",
  ];
  const mage = Array.isArray(work.mage_image) ? work.mage_image.map(record) : [];
  const soulx = Array.isArray(work.soulx_avatar) ? work.soulx_avatar.map(record) : [];
  const batches = Array.isArray(candidate.batches) ? candidate.batches.map(record) : [];
  const batchPrefix = (lane: "mage_image" | "soulx_avatar") => {
    const batch = batches.find((item) => item?.lane === lane);
    return typeof batch?.output_prefix === "string" ? batch.output_prefix : null;
  };
  const expectedRoot = (lane: "mage-image" | "soulx-avatar") =>
    `tenant/${candidate.accountId}/workspace/${candidate.workspaceId}/project/${candidate.projectId}/revision/${candidate.projectRevisionId}/lane/${lane}/job/`;
  const magePrefix = batchPrefix("mage_image");
  const soulxPrefix = batchPrefix("soulx_avatar");
  if (mage.length < 1 || soulx.length < 1 || mage.includes(null) || soulx.includes(null))
    throw new RangeError("V209_ORDINARY_WORK_INVALID");
  if (
    batches.length !== 2 ||
    magePrefix === null ||
    soulxPrefix === null ||
    !magePrefix.startsWith(expectedRoot("mage-image")) ||
    !soulxPrefix.startsWith(expectedRoot("soulx-avatar")) ||
    !UUID.test(magePrefix.slice(expectedRoot("mage-image").length)) ||
    !UUID.test(soulxPrefix.slice(expectedRoot("soulx-avatar").length))
  )
    throw new RangeError("V209_ORDINARY_WORK_INVALID");
  for (const item of mage as JsonRecord[]) {
    if (
      !exactKeys(item, mageKeys) ||
      (item.role !== "image" && item.role !== "right_image") ||
      ![
        item.taskId,
        item.segmentId,
        item.promptResultId,
        item.styleVersionId,
        item.inputReservationId,
        item.outputReservationId,
      ].every((candidate) => typeof candidate === "string" && UUID.test(candidate)) ||
      ![
        item.promptSha256,
        item.positivePromptSha256,
        item.negativePromptSha256,
        item.styleProfileSha256,
      ].every((candidate) => typeof candidate === "string" && SHA256.test(candidate)) ||
      !record(item.compiledPrompt) ||
      item.outputPrefix !== magePrefix
    )
      throw new RangeError("V209_ORDINARY_WORK_INVALID");
  }
  for (const item of soulx as JsonRecord[]) {
    if (
      !exactKeys(item, soulxKeys) ||
      item.role !== "avatar" ||
      ![
        item.taskId,
        item.segmentId,
        item.spanAudioId,
        item.spanAudioAssetId,
        item.spanAudioInputReservationId,
        item.sourceVoiceoverAssetId,
        item.avatarSourceAssetId,
        item.outputReservationId,
      ].every((candidate) => typeof candidate === "string" && UUID.test(candidate)) ||
      ![item.spanAudioSha256, item.sourceVoiceoverSha256, item.avatarSourceSha256].every(
        (candidate) => typeof candidate === "string" && SHA256.test(candidate),
      ) ||
      typeof item.sourceVoiceoverObjectKey !== "string" ||
      typeof item.spanAudioObjectKey !== "string" ||
      typeof item.avatarSourceObjectKey !== "string" ||
      !item.sourceVoiceoverObjectKey.startsWith(
        `tenant/${candidate.accountId}/workspace/${candidate.workspaceId}/`,
      ) ||
      !item.spanAudioObjectKey.startsWith(
        `tenant/${candidate.accountId}/workspace/${candidate.workspaceId}/`,
      ) ||
      !item.avatarSourceObjectKey.startsWith(
        `tenant/${candidate.accountId}/workspace/${candidate.workspaceId}/`,
      ) ||
      typeof item.sourceVoiceoverContentType !== "string" ||
      item.spanAudioContentType !== "audio/wav" ||
      typeof item.avatarSourceContentType !== "string" ||
      !Number.isSafeInteger(item.sourceVoiceoverContentLength) ||
      Number(item.sourceVoiceoverContentLength) < 1 ||
      !Number.isSafeInteger(item.spanAudioContentLength) ||
      Number(item.spanAudioContentLength) < 45 ||
      item.spanAudioSampleRateHz !== 48_000 ||
      item.spanAudioChannels !== 1 ||
      !Number.isSafeInteger(item.avatarSourceContentLength) ||
      Number(item.avatarSourceContentLength) < 1 ||
      ![
        item.selectedStartMs,
        item.selectedEndMsExclusive,
        item.paddedStartMs,
        item.paddedEndMsExclusive,
        item.trimStartMs,
        item.trimEndMsExclusive,
      ].every((candidate) => Number.isSafeInteger(candidate) && Number(candidate) >= 0) ||
      Number(item.selectedStartMs) >= Number(item.selectedEndMsExclusive) ||
      Number(item.paddedStartMs) >= Number(item.paddedEndMsExclusive) ||
      Number(item.trimStartMs) >= Number(item.trimEndMsExclusive) ||
      !Number.isSafeInteger(item.paddedSamples48k) ||
      Number(item.paddedSamples48k) < 1 ||
      !Number.isSafeInteger(item.trimStartSample48k) ||
      Number(item.trimStartSample48k) < 0 ||
      !Number.isSafeInteger(item.trimEndSampleExclusive48k) ||
      Number(item.trimEndSampleExclusive48k) <= Number(item.trimStartSample48k) ||
      Number(item.trimEndSampleExclusive48k) > Number(item.paddedSamples48k) ||
      item.outputPrefix !== soulxPrefix
    )
      throw new RangeError("V209_ORDINARY_WORK_INVALID");
  }
  return work as unknown as V209OrdinaryWork;
}

/** Freezes fresh provider facts around a database-owned project candidate. No output artifact hash
 * is synthesized: work contains only durable inputs and deterministic output reservations. */
export async function freezeV209OrdinaryLiveAdmission(
  rawCandidate: unknown,
  observation: V209ShortAdmissionObservation,
): Promise<V209OrdinaryLiveAdmission> {
  const { candidate, work } = await assertV209OrdinaryCandidate(rawCandidate);

  const databaseNow = epoch(observation.databaseNow, "V209_ORDINARY_DATABASE_TIME_INVALID");
  const providerAt = epoch(observation.providerObservedAt, "V209_ORDINARY_PROVIDER_TIME_INVALID");
  const rateAt = epoch(observation.rate.checkedAt, "V209_ORDINARY_RATE_TIME_INVALID");
  const billingAt = epoch(observation.billing.checkedAt, "V209_ORDINARY_BILLING_TIME_INVALID");
  if (
    observation.rate.gpu !== "NVIDIA GeForce RTX 4090" ||
    observation.rate.region !== "EU-RO-1" ||
    observation.rate.secureReferenceRateMicroUsdPerGpuHour !== 740_000 ||
    !Number.isSafeInteger(observation.rate.flexRateMicroUsdPerGpuHour) ||
    observation.rate.flexRateMicroUsdPerGpuHour < 1 ||
    observation.rate.flexRateMicroUsdPerGpuHour > MAX_RATE ||
    rateAt > databaseNow ||
    providerAt > databaseNow ||
    databaseNow - rateAt > FRESH_MS ||
    databaseNow - providerAt > FRESH_MS
  )
    throw new RangeError("V209_ORDINARY_RATE_ADMISSION_INVALID");
  if (
    !Number.isSafeInteger(observation.billing.cumulativeEndpointBillingMicroUsd) ||
    observation.billing.cumulativeEndpointBillingMicroUsd < 0 ||
    observation.billing.cumulativeEndpointBillingMicroUsd + 2_000_000 > 17_500_000 ||
    billingAt > databaseNow ||
    databaseNow - billingAt > FRESH_MS ||
    observation.phaseCapMicroUsd !== 2_000_000 ||
    observation.combinedCompletionCapMicroUsd !== 17_500_000 ||
    observation.redispatchAuthorized !== false
  )
    throw new RangeError("V209_ORDINARY_COST_ADMISSION_INVALID");
  const base = Object.freeze({
    schemaVersion: "videoforge-v2-09-ordinary-admission/v1" as const,
    candidateSha256: candidate.candidateSha256 as `sha256:${string}`,
    generationPlanSha256: candidate.generationPlanSha256 as `sha256:${string}`,
    workManifestSha256: candidate.workManifestSha256 as `sha256:${string}`,
    work,
    cost: Object.freeze({
      maximumFlexRateMicroUsdPerGpuHour: 1_116_000 as const,
      primaryExecutionForecastMicroUsd: 744_000 as const,
      possibleDuplicateLiabilityMicroUsd: 744_000 as const,
      settlementReserveMicroUsd: 512_000 as const,
      hardVariableCostCeilingMicroUsd: 2_000_000 as const,
      combinedCompletionCapMicroUsd: 17_500_000 as const,
      noRedispatch: true as const,
    }),
    billingBaselineMicroUsd: observation.billing.cumulativeEndpointBillingMicroUsd,
    billingBaselineCheckedAt: observation.billing.checkedAt,
    databaseNow: observation.databaseNow,
    providerObservedAt: observation.providerObservedAt,
    cancelAt: new Date(databaseNow + 20 * 60_000).toISOString(),
    stopAt: new Date(databaseNow + 30 * 60_000).toISOString(),
  });
  return Object.freeze({
    ...base,
    admissionSha256: await sha256CanonicalJson(base),
  });
}
