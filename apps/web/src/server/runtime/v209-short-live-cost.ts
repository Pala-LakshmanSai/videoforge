import {
  sha256CanonicalJson,
  validateAndHashContractDocument,
  type ResolvedRenderManifestDocument,
} from "@videoforge/contracts";

const PLAN_SHA = "sha256:f975e2be15db227e96c6ea06f025c3f7ead025a5f80b80e9e2b0ac1f9fd6a4ea" as const;
const RATE = 1_100_000;
const STARTUP_MS = 672_035;
const EXECUTION_UPLOAD_MS = 107_965;
const CANCEL_TAIL_MS = 420_000;
const WALL_MS = STARTUP_MS + EXECUTION_UPLOAD_MS + CANCEL_TAIL_MS;
const PRIMARY = Math.ceil((WALL_MS * RATE * 2) / 3_600_000);
const DUPLICATE = PRIMARY;
const RESERVE = 2_000_000 - PRIMARY - DUPLICATE;
const FRESH_MS = 5 * 60_000;

export const V209_SHORT_LIVE_COST_PROFILE = Object.freeze({
  schemaVersion: "videoforge-v2-09-short-live-cost-profile/v3" as const,
  canonicalPlanSha256: PLAN_SHA,
  providerEvidenceClaimed: false as const,
  output: Object.freeze({
    durationSeconds: 40 as const,
    fps: 30 as const,
    totalFrames: 1_200 as const,
  }),
  exactWorkCounts: Object.freeze({ mageImage: 1 as const, soulxAvatar: 2 as const }),
  serverless: Object.freeze({
    gpu: "NVIDIA GeForce RTX 4090" as const,
    region: "EU-RO-1" as const,
    maximumFlexRateMicroUsdPerGpuHour: RATE,
    historicalSoulxStartToReadyMs: STARTUP_MS,
    executionAndUploadAllowanceMs: EXECUTION_UPLOAD_MS,
    cancellationAndTerminalTailMs: CANCEL_TAIL_MS,
    maximumBilledWallTimeMsPerLane: WALL_MS,
  }),
  retainedVolumes: Object.freeze({
    excluded: true as const,
    existingCount: 2 as const,
    combinedMonthlyMicroUsd: 7_000_000 as const,
    newRetainedResources: 0 as const,
  }),
  primaryExecutionForecastMicroUsd: PRIMARY,
  possibleDuplicateLiabilityMicroUsd: DUPLICATE,
  settlementBillingLagAndCancellationReserveMicroUsd: RESERVE,
  hardVariableCostCeilingMicroUsd: 2_000_000 as const,
  combinedCompletionCapMicroUsd: 17_500_000 as const,
  noRedispatch: true as const,
});

export interface V209ShortAdmissionObservation {
  readonly databaseNow: string;
  readonly providerObservedAt: string;
  readonly rate: {
    readonly gpu: "NVIDIA GeForce RTX 4090";
    readonly region: "EU-RO-1";
    readonly availability: "LOW" | "MEDIUM" | "HIGH";
    readonly secureReferenceRateMicroUsdPerGpuHour: number;
    readonly flexRateMicroUsdPerGpuHour: number;
    readonly checkedAt: string;
  };
  readonly billing: {
    readonly cumulativeEndpointBillingMicroUsd: number;
    readonly checkedAt: string;
  };
  readonly phaseCapMicroUsd: 2_000_000;
  readonly combinedCompletionCapMicroUsd: 17_500_000;
  readonly redispatchAuthorized: false;
}

type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Read-only provider facts used by the production mutation boundary. The POD catalog proves the
 * exact GPU/region is presently offered; the separately pinned Serverless Flex ceiling remains the
 * conservative billing rate. */
export async function readV209ShortProviderObservation(
  apiKey: string,
  databaseNow: () => Promise<string>,
  fetchPort: FetchPort = fetch,
): Promise<V209ShortAdmissionObservation> {
  if (apiKey.trim() !== apiKey || apiKey.length < 20)
    throw new RangeError("V209_SHORT_PROVIDER_BINDING_INVALID");
  const providerObservedAt = new Date().toISOString();
  const [catalogResponse, billingResponse] = await Promise.all([
    fetchPort(
      "https://api.runpod.io/v2/catalog/gpus?include=AVAILABILITY&product=POD&count=1&cloud=SECURE",
      { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30_000) },
    ),
    fetchPort(
      `https://rest.runpod.io/v1/billing/endpoints?${new URLSearchParams({
        bucketSize: "hour",
        grouping: "endpointId",
        startTime: "2026-08-20T00:00:00.000Z",
        endTime: providerObservedAt,
      })}`,
      { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) },
    ),
  ]);
  if (!catalogResponse.ok || !billingResponse.ok)
    throw new RangeError("V209_SHORT_PROVIDER_OBSERVATION_FAILED");
  const catalog = record(await catalogResponse.json());
  const gpus = Array.isArray(catalog?.gpus) ? catalog.gpus : [];
  const selected = gpus.map(record).find((gpu) => {
    const centers = Array.isArray(gpu?.dataCenters) ? gpu.dataCenters.map(record) : [];
    const center = centers.find((candidate) => candidate?.id === "EU-RO-1");
    const availability = center?.availability ?? gpu?.availability;
    return (
      gpu?.id === "NVIDIA GeForce RTX 4090" &&
      gpu?.manufacturer === "NVIDIA" &&
      gpu?.secure === true &&
      Number(record(gpu?.price)?.secure) === 0.74 &&
      (availability === "LOW" || availability === "MEDIUM" || availability === "HIGH")
    );
  });
  if (!selected) throw new RangeError("V209_SHORT_PROVIDER_OFFERING_UNAVAILABLE");
  const center = (selected.dataCenters as unknown[])
    .map(record)
    .find((candidate) => candidate?.id === "EU-RO-1")!;
  const billing = await billingResponse.json();
  if (!Array.isArray(billing)) throw new RangeError("V209_SHORT_PROVIDER_BILLING_INVALID");
  let cumulativeUsd = 0;
  for (const item of billing) {
    const amount = Number(record(item)?.amount);
    if (!Number.isFinite(amount) || amount < 0)
      throw new RangeError("V209_SHORT_PROVIDER_BILLING_INVALID");
    cumulativeUsd += amount;
  }
  const cumulativeEndpointBillingMicroUsd = Math.round(cumulativeUsd * 1_000_000);
  if (!Number.isSafeInteger(cumulativeEndpointBillingMicroUsd))
    throw new RangeError("V209_SHORT_PROVIDER_BILLING_INVALID");
  const checkedAt = new Date().toISOString();
  const dbNow = await databaseNow();
  const dbEpoch = epoch(dbNow, "V209_SHORT_DATABASE_TIME_INVALID");
  const providerEpoch = epoch(providerObservedAt, "V209_SHORT_PROVIDER_TIME_INVALID");
  const checkedEpoch = epoch(checkedAt, "V209_SHORT_PROVIDER_TIME_INVALID");
  if (
    providerEpoch > dbEpoch ||
    checkedEpoch > dbEpoch ||
    dbEpoch - providerEpoch > FRESH_MS ||
    dbEpoch - checkedEpoch > FRESH_MS
  )
    throw new RangeError("V209_SHORT_PROVIDER_TIME_INVALID");
  return Object.freeze({
    databaseNow: dbNow,
    providerObservedAt,
    rate: Object.freeze({
      gpu: "NVIDIA GeForce RTX 4090" as const,
      region: "EU-RO-1" as const,
      availability: (center.availability ?? selected.availability) as "LOW" | "MEDIUM" | "HIGH",
      secureReferenceRateMicroUsdPerGpuHour: 740_000,
      flexRateMicroUsdPerGpuHour: RATE,
      checkedAt,
    }),
    billing: Object.freeze({ cumulativeEndpointBillingMicroUsd, checkedAt }),
    phaseCapMicroUsd: 2_000_000 as const,
    combinedCompletionCapMicroUsd: 17_500_000 as const,
    redispatchAuthorized: false as const,
  });
}

type Work = {
  readonly mage_image: readonly {
    readonly segmentId: string;
    readonly role: "image" | "right_image";
    readonly assetId: string;
    readonly sha256: string;
  }[];
  readonly soulx_avatar: readonly {
    readonly segmentId: string;
    readonly role: "avatar";
    readonly assetId: string;
    readonly sha256: string;
  }[];
};
export interface V209ShortLiveAdmission {
  readonly schemaVersion: "videoforge-v2-09-short-live-admission/v1";
  readonly planSha256: typeof PLAN_SHA;
  readonly workManifestSha256: `sha256:${string}`;
  readonly work: Work;
  readonly cost: typeof V209_SHORT_LIVE_COST_PROFILE;
  readonly billingBaselineMicroUsd: number;
  readonly billingBaselineCheckedAt: string;
  readonly databaseNow: string;
  readonly providerObservedAt: string;
  readonly cancelAt: string;
  readonly stopAt: string;
  readonly admissionSha256: `sha256:${string}`;
}
const epoch = (value: string, code: string) => {
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString() !== value)
    throw new RangeError(code);
  return result;
};

function exactWork(plan: ResolvedRenderManifestDocument): Work {
  const mage: Work["mage_image"][number][] = [];
  const soulx: Work["soulx_avatar"][number][] = [];
  let cursor = 0;
  for (const segment of plan.segments) {
    if (segment.start_frame !== cursor || segment.end_frame_exclusive <= segment.start_frame)
      throw new RangeError("V209_SHORT_PLAN_TIMELINE_INVALID");
    cursor = segment.end_frame_exclusive;
    if (segment.timeline_composition === "IMAGE_FULL")
      mage.push({
        segmentId: segment.segment_id,
        role: "image",
        assetId: segment.accepted_assets.image.asset_id,
        sha256: segment.accepted_assets.image.sha256,
      });
    else if (segment.timeline_composition === "AVATAR_FULL")
      soulx.push({
        segmentId: segment.segment_id,
        role: "avatar",
        assetId: segment.accepted_assets.avatar.asset_id,
        sha256: segment.accepted_assets.avatar.sha256,
      });
    else {
      soulx.push({
        segmentId: segment.segment_id,
        role: "avatar",
        assetId: segment.accepted_assets.avatar.asset_id,
        sha256: segment.accepted_assets.avatar.sha256,
      });
      mage.push({
        segmentId: segment.segment_id,
        role: "right_image",
        assetId: segment.accepted_assets.right_image.asset_id,
        sha256: segment.accepted_assets.right_image.sha256,
      });
    }
  }
  if (cursor !== plan.total_frames || mage.length !== 1 || soulx.length !== 2)
    throw new RangeError("V209_SHORT_PLAN_WORK_COUNTS_INVALID");
  return Object.freeze({
    mage_image: Object.freeze(mage.map((item) => Object.freeze(item))),
    soulx_avatar: Object.freeze(soulx.map((item) => Object.freeze(item))),
  });
}

export async function freezeV209ShortLiveAdmission(
  rawPlan: unknown,
  observation: V209ShortAdmissionObservation,
): Promise<V209ShortLiveAdmission> {
  let validated: Awaited<
    ReturnType<typeof validateAndHashContractDocument<"resolvedRenderManifest">>
  >;
  try {
    validated = await validateAndHashContractDocument("resolvedRenderManifest", rawPlan);
  } catch {
    throw new RangeError("V209_SHORT_PLAN_SCHEMA_INVALID");
  }
  const plan = validated.value;
  if (
    validated.sha256 !== PLAN_SHA ||
    plan.output.fps_num !== 30 ||
    plan.output.fps_den !== 1 ||
    plan.total_frames !== 1_200 ||
    plan.soulx_crop_profile_approval?.approval_sha256 !==
      "sha256:c3aae03da3f0134e12c2f432951189bd205dcbb7ab26a65d44061cec82984c45"
  )
    throw new RangeError("V209_SHORT_PLAN_IDENTITY_INVALID");
  const work = exactWork(plan);
  const now = epoch(observation.databaseNow, "V209_SHORT_DATABASE_TIME_INVALID");
  const providerAt = epoch(observation.providerObservedAt, "V209_SHORT_PROVIDER_TIME_INVALID");
  const rateAt = epoch(observation.rate.checkedAt, "V209_SHORT_RATE_TIME_INVALID");
  const billingAt = epoch(observation.billing.checkedAt, "V209_SHORT_BILLING_TIME_INVALID");
  if (
    observation.rate.gpu !== "NVIDIA GeForce RTX 4090" ||
    observation.rate.region !== "EU-RO-1" ||
    observation.rate.secureReferenceRateMicroUsdPerGpuHour !== 740_000 ||
    !Number.isInteger(observation.rate.flexRateMicroUsdPerGpuHour) ||
    observation.rate.flexRateMicroUsdPerGpuHour < 1 ||
    observation.rate.flexRateMicroUsdPerGpuHour > RATE ||
    rateAt > now ||
    providerAt > now ||
    now - rateAt > FRESH_MS ||
    now - providerAt > FRESH_MS
  )
    throw new RangeError("V209_SHORT_RATE_ADMISSION_INVALID");
  if (
    !Number.isSafeInteger(observation.billing.cumulativeEndpointBillingMicroUsd) ||
    observation.billing.cumulativeEndpointBillingMicroUsd < 0 ||
    observation.billing.cumulativeEndpointBillingMicroUsd + 2_000_000 > 17_500_000 ||
    billingAt > now ||
    now - billingAt > FRESH_MS
  )
    throw new RangeError("V209_SHORT_BILLING_BASELINE_INVALID");
  if (
    observation.phaseCapMicroUsd !== 2_000_000 ||
    observation.combinedCompletionCapMicroUsd !== 17_500_000 ||
    observation.redispatchAuthorized !== false
  )
    throw new RangeError("V209_SHORT_AUTHORITY_SCOPE_INVALID");
  const workManifestSha256 = await sha256CanonicalJson(work);
  const base = Object.freeze({
    schemaVersion: "videoforge-v2-09-short-live-admission/v1" as const,
    planSha256: PLAN_SHA,
    workManifestSha256,
    work,
    cost: V209_SHORT_LIVE_COST_PROFILE,
    billingBaselineMicroUsd: observation.billing.cumulativeEndpointBillingMicroUsd,
    billingBaselineCheckedAt: observation.billing.checkedAt,
    databaseNow: observation.databaseNow,
    providerObservedAt: observation.providerObservedAt,
    cancelAt: new Date(now + WALL_MS).toISOString(),
    stopAt: new Date(now + WALL_MS + 10 * 60_000).toISOString(),
  });
  return Object.freeze({ ...base, admissionSha256: await sha256CanonicalJson(base) });
}

export function assertV209ShortSettlement(input: {
  readonly admission: V209ShortLiveAdmission;
  readonly finalCumulativeEndpointBillingMicroUsd: number;
  readonly settledVariableCostMicroUsd: number;
  readonly possibleDuplicateCostMicroUsd: number;
  readonly terminalJobCount: 2;
  readonly activeWorkers: 0;
  readonly runningPods: 0;
  readonly redispatchCount: 0;
}): void {
  const increment =
    input.finalCumulativeEndpointBillingMicroUsd - input.admission.billingBaselineMicroUsd;
  if (
    ![
      input.finalCumulativeEndpointBillingMicroUsd,
      input.settledVariableCostMicroUsd,
      input.possibleDuplicateCostMicroUsd,
    ].every(Number.isSafeInteger) ||
    increment < 0 ||
    input.settledVariableCostMicroUsd < 0 ||
    input.possibleDuplicateCostMicroUsd < 0 ||
    Math.max(increment, input.settledVariableCostMicroUsd + input.possibleDuplicateCostMicroUsd) >
      2_000_000 ||
    input.terminalJobCount !== 2 ||
    input.activeWorkers !== 0 ||
    input.runningPods !== 0 ||
    input.redispatchCount !== 0
  )
    throw new RangeError("V209_SHORT_SETTLEMENT_INVALID");
}
