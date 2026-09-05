import { createHash } from "node:crypto";

import { canonicalizeJson, type JsonValue } from "@videoforge/contracts";

import {
  V213_GPU,
  V213_MAX_RATE_USD_PER_GPU_HOUR,
  V213_QUALIFICATION_CASE_DESCRIPTORS,
  V213_REGION,
  V213_SOULX_COLD_READY_LIMIT_MS,
  V213_VOLUME_MOUNT,
  type V213QualificationCaseDescriptor,
} from "./v213-dual-lane-live.js";
import { V208_SOULX_WHOLE_SPAN_DESCRIPTORS } from "../hosted/v213-qualification-materializer.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const IMAGE = /^ghcr\.io\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/u;

/** Immutable successful Stage 6 predecessor. It is evidence, never reusable authority. */
export const V208_V207_ATTEMPT85_CLOSURE_SHA256 =
  "sha256:aeef45f237fd07e0937cdd51eaaf545ac0d8bb4c90eb105708f1681da787cc79" as const;
export const V208_V207_ATTEMPT85_CLOSURE_PATH =
  "project-context/evidence/acceptance/VF-10-07/2026-09-05-attempt85-live-qualification/success-attempt-85.json" as const;
export const V208_SOULX_VOLUME_ID_SHA256 =
  "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be" as const;
export const V208_SOULX_VOLUME_MANIFEST_SHA256 =
  "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626" as const;
export const V208_EXECUTION_ENTRYPOINT = "soulx-v208-qualification-v1" as const;
// These bindings deliberately remain empty until a separately audited proposal is approved.
// Provider execution cannot be reached while any one of them is null.
export const V208_PENDING_PROPOSAL_SHA256: string | null = null;
export const V208_APPROVED_AUTHORITY_SHA256: string | null = null;
export const V208_APPROVED_FINITE_CAP_USD: number | null = null;
export const V208_APPROVED_IMAGE: string | null = null;
export const V208_APPROVED_IMAGE_SOURCE_COMMIT: string | null = null;
export const V208_APPROVED_RUNPOD_ACCOUNT_ID_SHA256: string | null = null;
export const V208_APPROVED_REQUIRED_AVAILABILITY: "HIGH" | null = null;
export const V208_APPROVED_BILLING_BASELINE_USD: number | null = null;
export const V208_APPROVED_CUMULATIVE_BILLING_STOP_THRESHOLD_USD: number | null = null;

export interface V208CompiledAuthority {
  readonly proposalSha256: string | null;
  readonly authoritySha256: string | null;
  readonly finiteCapUsd: number | null;
  readonly image: string | null;
  readonly imageSourceCommit: string | null;
  readonly runpodAccountIdSha256: string | null;
  readonly requiredAvailability: "HIGH" | null;
  readonly billingBaselineUsd: number | null;
  readonly cumulativeBillingStopThresholdUsd: number | null;
}

export interface V208SoulXAuthority {
  readonly proposalSha256: string;
  readonly authoritySha256: string;
  readonly finiteCapUsd: number;
  readonly image: string;
  readonly imageSourceCommit: string;
  readonly runpodAccountIdSha256: string;
  readonly requiredAvailability: "HIGH";
  readonly billingBaselineUsd: number;
  readonly cumulativeBillingStopThresholdUsd: number;
  readonly predecessorClosureSha256: typeof V208_V207_ATTEMPT85_CLOSURE_SHA256;
}

export interface V208SoulXQualificationPlan {
  readonly schemaVersion: "videoforge.v208-soulx-qualification-plan/v1";
  readonly checkpoint: "V2-08";
  readonly stage: 7;
  readonly predecessor: Readonly<{
    readonly checkpoint: "V2-07";
    readonly result: "QUALIFIED_PASS_CLEAN";
    readonly closurePath: typeof V208_V207_ATTEMPT85_CLOSURE_PATH;
    readonly closureSha256: typeof V208_V207_ATTEMPT85_CLOSURE_SHA256;
  }>;
  readonly authority: V208SoulXAuthority;
  readonly deployment: Readonly<{
    readonly region: typeof V213_REGION;
    readonly gpu: typeof V213_GPU;
    readonly maxRateUsdPerGpuHour: number;
    readonly requiredAvailability: "HIGH";
    readonly workersMin: 0;
    readonly workersMax: 1;
    readonly handlerConcurrency: 1;
    readonly volumeMount: typeof V213_VOLUME_MOUNT;
    readonly volumeSizeGb: 50;
    readonly volumeIdSha256: typeof V208_SOULX_VOLUME_ID_SHA256;
    readonly volumeManifestSha256: typeof V208_SOULX_VOLUME_MANIFEST_SHA256;
    readonly volumeMode: "READ_ONLY";
    readonly disposableEndpointAndTemplate: true;
    readonly noGpuFallback: true;
  }>;
  readonly billing: Readonly<{
    readonly baselineUsd: number;
    readonly cumulativeStopThresholdUsd: number;
    readonly finiteCapUsd: number;
    readonly maxRateUsdPerGpuHour: number;
  }>;
  readonly qualification: Readonly<{
    readonly requiredWholeSpanBatch: true;
    readonly existingMaterializerWholeSpanBatch: true;
    readonly wholeSpanDescriptors: typeof V208_SOULX_WHOLE_SPAN_DESCRIPTORS;
    readonly caseDescriptors: readonly V213QualificationCaseDescriptor[];
    readonly completeSpanSeconds: readonly [2, 4, 6, 10];
    readonly coldSpanSeconds: 2;
    readonly warmSpanSeconds: readonly [4, 6, 10];
    readonly coldModelReadyLimitMs: number;
    readonly requiredFaults: readonly ["cancel", "invalid", "timeout"];
    readonly requireNativeFullSplitReadback: true;
    readonly requireExactAudioVideoProbe: true;
    readonly requireReceipts: true;
  }>;
  readonly cleanup: Readonly<{
    readonly deleteOutputs: true;
    readonly deleteEndpoint: true;
    readonly deleteTemplate: true;
    readonly finalZeroComputeReads: 3;
    readonly retainSoulXVolumeUnchanged: true;
  }>;
  readonly planSha256: string;
}

export interface V208SoulXQualificationResult {
  readonly schemaVersion: "videoforge.v208-soulx-qualification-result/v1";
  readonly planSha256: string;
  readonly qualified: true;
  readonly completeSpanSeconds: readonly [2, 4, 6, 10];
  readonly coldModelReadyMs: number;
  readonly nativeFullSplitReadbackVerified: true;
  readonly exactAudioVideoProbeVerified: true;
  readonly workerReceiptsVerified: 2;
  readonly outputItemsVerified: 8;
  readonly cancellationVerified: true;
  readonly invalidOutputVerified: true;
  readonly timeoutVerified: true;
  readonly endpointDeleted: true;
  readonly templateDeleted: true;
  readonly outputsDeleted: true;
  readonly finalZeroComputeReads: 3;
  readonly retainedSoulXVolumeUnchanged: true;
  readonly workersMin: 0;
  readonly workersMax: 1;
  readonly observedSpendUsd: number;
  readonly cumulativeBillingUsd: number;
}

export interface V208SoulXQualificationPort {
  /**
   * The concrete adapter is the existing V2-13 materializer plus RunPod lifecycle. This boundary
   * deliberately carries no credentials and offers only one complete, cleanup-owning execution.
   */
  readonly executeSoulXQualification: (
    plan: V208SoulXQualificationPlan,
  ) => Promise<V208SoulXQualificationResult>;
}

const currentCompiledAuthority = (): V208CompiledAuthority => ({
  proposalSha256: V208_PENDING_PROPOSAL_SHA256,
  authoritySha256: V208_APPROVED_AUTHORITY_SHA256,
  finiteCapUsd: V208_APPROVED_FINITE_CAP_USD,
  image: V208_APPROVED_IMAGE,
  imageSourceCommit: V208_APPROVED_IMAGE_SOURCE_COMMIT,
  runpodAccountIdSha256: V208_APPROVED_RUNPOD_ACCOUNT_ID_SHA256,
  requiredAvailability: V208_APPROVED_REQUIRED_AVAILABILITY,
  billingBaselineUsd: V208_APPROVED_BILLING_BASELINE_USD,
  cumulativeBillingStopThresholdUsd: V208_APPROVED_CUMULATIVE_BILLING_STOP_THRESHOLD_USD,
});

const hashCanonical = (value: unknown): string =>
  `sha256:${createHash("sha256")
    .update(canonicalizeJson(value as JsonValue), "utf8")
    .digest("hex")}`;

/** Pure validator used by the sealed activation parser and provider-free tests. */
export function validateV208SoulXAuthority(
  environment: Readonly<Record<string, string | undefined>>,
  compiled: V208CompiledAuthority,
): V208SoulXAuthority {
  if (
    compiled.proposalSha256 === null ||
    compiled.authoritySha256 === null ||
    compiled.finiteCapUsd === null ||
    compiled.image === null ||
    compiled.imageSourceCommit === null ||
    compiled.runpodAccountIdSha256 === null ||
    compiled.requiredAvailability === null ||
    compiled.billingBaselineUsd === null ||
    compiled.cumulativeBillingStopThresholdUsd === null
  )
    throw new Error("V208_FRESH_EXACT_AUTHORITY_REQUIRED");
  if (
    !SHA256.test(compiled.proposalSha256) ||
    !SHA256.test(compiled.authoritySha256) ||
    !Number.isFinite(compiled.finiteCapUsd) ||
    compiled.finiteCapUsd <= 0 ||
    !IMAGE.test(compiled.image) ||
    !COMMIT.test(compiled.imageSourceCommit) ||
    !SHA256.test(compiled.runpodAccountIdSha256) ||
    compiled.requiredAvailability !== "HIGH" ||
    !Number.isFinite(compiled.billingBaselineUsd) ||
    compiled.billingBaselineUsd < 0 ||
    !Number.isFinite(compiled.cumulativeBillingStopThresholdUsd) ||
    compiled.cumulativeBillingStopThresholdUsd < compiled.billingBaselineUsd
  )
    throw new Error("V208_COMPILED_AUTHORITY_INVALID");
  if (environment.V208_EXECUTION_ENTRYPOINT !== V208_EXECUTION_ENTRYPOINT)
    throw new Error("V208_EXECUTION_ENTRYPOINT_MISMATCH");
  if (environment.V208_PROPOSAL_SHA256 !== compiled.proposalSha256)
    throw new Error("V208_PROPOSAL_MISMATCH");
  if (environment.V208_AUTHORITY_SHA256 !== compiled.authoritySha256)
    throw new Error("V208_AUTHORITY_MISMATCH");
  if (environment.V208_IMAGE !== compiled.image) throw new Error("V208_IMAGE_MISMATCH");
  if (environment.V208_IMAGE_SOURCE_COMMIT !== compiled.imageSourceCommit)
    throw new Error("V208_IMAGE_SOURCE_COMMIT_MISMATCH");
  if (environment.V208_RUNPOD_ACCOUNT_ID_SHA256 !== compiled.runpodAccountIdSha256)
    throw new Error("V208_RUNPOD_ACCOUNT_MISMATCH");
  if (environment.V208_REQUIRED_AVAILABILITY !== compiled.requiredAvailability)
    throw new Error("V208_REQUIRED_AVAILABILITY_MISMATCH");
  if (environment.V208_PREDECESSOR_CLOSURE_SHA256 !== V208_V207_ATTEMPT85_CLOSURE_SHA256)
    throw new Error("V208_V207_PREDECESSOR_MISMATCH");
  const cap = Number(environment.V208_FINITE_CAP_USD ?? "");
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("V208_FINITE_CAP_REQUIRED");
  if (cap !== compiled.finiteCapUsd) throw new Error("V208_FINITE_CAP_MISMATCH");
  const billingBaselineUsd = Number(environment.V208_BILLING_BASELINE_USD ?? "");
  if (!Number.isFinite(billingBaselineUsd) || billingBaselineUsd < 0)
    throw new Error("V208_BILLING_BASELINE_REQUIRED");
  if (billingBaselineUsd !== compiled.billingBaselineUsd)
    throw new Error("V208_BILLING_BASELINE_MISMATCH");
  const cumulativeBillingStopThresholdUsd = Number(
    environment.V208_CUMULATIVE_BILLING_STOP_THRESHOLD_USD ?? "",
  );
  if (
    !Number.isFinite(cumulativeBillingStopThresholdUsd) ||
    cumulativeBillingStopThresholdUsd < billingBaselineUsd
  )
    throw new Error("V208_CUMULATIVE_BILLING_STOP_THRESHOLD_REQUIRED");
  if (cumulativeBillingStopThresholdUsd !== compiled.cumulativeBillingStopThresholdUsd)
    throw new Error("V208_CUMULATIVE_BILLING_STOP_THRESHOLD_MISMATCH");
  return Object.freeze({
    proposalSha256: compiled.proposalSha256,
    authoritySha256: compiled.authoritySha256,
    finiteCapUsd: cap,
    image: compiled.image,
    imageSourceCommit: compiled.imageSourceCommit,
    runpodAccountIdSha256: compiled.runpodAccountIdSha256,
    requiredAvailability: compiled.requiredAvailability,
    billingBaselineUsd,
    cumulativeBillingStopThresholdUsd,
    predecessorClosureSha256: V208_V207_ATTEMPT85_CLOSURE_SHA256,
  });
}

/** Runtime parser. There is intentionally no caller-provided authority override. */
export function parseV208SoulXAuthority(
  environment: Readonly<Record<string, string | undefined>>,
): V208SoulXAuthority {
  return validateV208SoulXAuthority(environment, currentCompiledAuthority());
}

export function buildV208SoulXQualificationPlan(
  authority: V208SoulXAuthority,
): V208SoulXQualificationPlan {
  const caseDescriptors = V213_QUALIFICATION_CASE_DESCRIPTORS.filter(
    (descriptor) => descriptor.lane === "soulx",
  );
  if (
    caseDescriptors.length !== 7 ||
    caseDescriptors.some((descriptor) => descriptor.lane !== "soulx")
  )
    throw new Error("V208_SOULX_CASE_PLAN_INVALID");
  const unsigned = {
    schemaVersion: "videoforge.v208-soulx-qualification-plan/v1" as const,
    checkpoint: "V2-08" as const,
    stage: 7 as const,
    predecessor: {
      checkpoint: "V2-07" as const,
      result: "QUALIFIED_PASS_CLEAN" as const,
      closurePath: V208_V207_ATTEMPT85_CLOSURE_PATH,
      closureSha256: V208_V207_ATTEMPT85_CLOSURE_SHA256,
    },
    authority,
    deployment: {
      region: V213_REGION,
      gpu: V213_GPU,
      maxRateUsdPerGpuHour: V213_MAX_RATE_USD_PER_GPU_HOUR,
      requiredAvailability: authority.requiredAvailability,
      workersMin: 0 as const,
      workersMax: 1 as const,
      handlerConcurrency: 1 as const,
      volumeMount: V213_VOLUME_MOUNT,
      volumeSizeGb: 50 as const,
      volumeIdSha256: V208_SOULX_VOLUME_ID_SHA256,
      volumeManifestSha256: V208_SOULX_VOLUME_MANIFEST_SHA256,
      volumeMode: "READ_ONLY" as const,
      disposableEndpointAndTemplate: true as const,
      noGpuFallback: true as const,
    },
    billing: {
      baselineUsd: authority.billingBaselineUsd,
      cumulativeStopThresholdUsd: authority.cumulativeBillingStopThresholdUsd,
      finiteCapUsd: authority.finiteCapUsd,
      maxRateUsdPerGpuHour: V213_MAX_RATE_USD_PER_GPU_HOUR,
    },
    qualification: {
      requiredWholeSpanBatch: true as const,
      existingMaterializerWholeSpanBatch: true as const,
      wholeSpanDescriptors: V208_SOULX_WHOLE_SPAN_DESCRIPTORS,
      caseDescriptors: Object.freeze([...caseDescriptors]),
      completeSpanSeconds: [2, 4, 6, 10] as const,
      coldSpanSeconds: 2 as const,
      warmSpanSeconds: [4, 6, 10] as const,
      coldModelReadyLimitMs: V213_SOULX_COLD_READY_LIMIT_MS,
      requiredFaults: ["cancel", "invalid", "timeout"] as const,
      requireNativeFullSplitReadback: true as const,
      requireExactAudioVideoProbe: true as const,
      requireReceipts: true as const,
    },
    cleanup: {
      deleteOutputs: true as const,
      deleteEndpoint: true as const,
      deleteTemplate: true as const,
      finalZeroComputeReads: 3 as const,
      retainSoulXVolumeUnchanged: true as const,
    },
  };
  return Object.freeze({ ...unsigned, planSha256: hashCanonical(unsigned) });
}

export function validateV208SoulXQualificationResult(
  plan: V208SoulXQualificationPlan,
  result: V208SoulXQualificationResult,
): V208SoulXQualificationResult {
  if (
    result.schemaVersion !== "videoforge.v208-soulx-qualification-result/v1" ||
    result.planSha256 !== plan.planSha256 ||
    result.qualified !== true ||
    canonicalizeJson(result.completeSpanSeconds as unknown as JsonValue) !== "[2,4,6,10]" ||
    !Number.isFinite(result.coldModelReadyMs) ||
    result.coldModelReadyMs < 0 ||
    result.coldModelReadyMs >= V213_SOULX_COLD_READY_LIMIT_MS ||
    result.nativeFullSplitReadbackVerified !== true ||
    result.exactAudioVideoProbeVerified !== true ||
    result.workerReceiptsVerified !== 2 ||
    result.outputItemsVerified !== 8 ||
    result.cancellationVerified !== true ||
    result.invalidOutputVerified !== true ||
    result.timeoutVerified !== true ||
    result.endpointDeleted !== true ||
    result.templateDeleted !== true ||
    result.outputsDeleted !== true ||
    result.finalZeroComputeReads !== 3 ||
    result.retainedSoulXVolumeUnchanged !== true ||
    result.workersMin !== 0 ||
    result.workersMax !== 1 ||
    !Number.isFinite(result.observedSpendUsd) ||
    result.observedSpendUsd < 0 ||
    result.observedSpendUsd > plan.authority.finiteCapUsd ||
    !Number.isFinite(result.cumulativeBillingUsd) ||
    result.cumulativeBillingUsd < plan.authority.billingBaselineUsd ||
    result.cumulativeBillingUsd > plan.authority.cumulativeBillingStopThresholdUsd ||
    Math.abs(
      result.cumulativeBillingUsd -
        (plan.authority.billingBaselineUsd + result.observedSpendUsd),
    ) > 0.000_000_001
  )
    throw new Error("V208_SOULX_QUALIFICATION_RESULT_REJECTED");
  return Object.freeze(result);
}

/** One-shot Stage 7 wrapper. Stage 6 is read only through its immutable closure hash. */
export async function runV208SoulXQualification(
  port: V208SoulXQualificationPort,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<V208SoulXQualificationResult> {
  const authority = parseV208SoulXAuthority(environment);
  const plan = buildV208SoulXQualificationPlan(authority);
  return validateV208SoulXQualificationResult(plan, await port.executeSoulXQualification(plan));
}
