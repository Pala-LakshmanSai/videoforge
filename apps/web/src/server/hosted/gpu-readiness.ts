export const HOSTED_GPU_TRANSPORT = "DISABLED_UNQUALIFIED" as const;

export interface HostedGpuLaneReadiness {
  readonly lane: "MAGE_IMAGE" | "SOULX_AVATAR";
  readonly checkpoint: "V2-07" | "V2-08";
  readonly qualification: "NOT_QUALIFIED";
  readonly visual_approval: "NOT_APPLICABLE" | "PENDING_USER_VISUAL_APPROVAL";
  readonly provider_free_groundwork_commits: readonly string[];
  readonly missing_gates: readonly string[];
}

export interface HostedGpuReadiness {
  readonly schema_version: "videoforge-hosted-gpu-readiness/v1";
  readonly gpu_transport: typeof HOSTED_GPU_TRANSPORT;
  readonly provider_calls_authorized: false;
  readonly dispatch_available: false;
  readonly lanes: readonly HostedGpuLaneReadiness[];
}

const READINESS: HostedGpuReadiness = Object.freeze({
  schema_version: "videoforge-hosted-gpu-readiness/v1",
  gpu_transport: HOSTED_GPU_TRANSPORT,
  provider_calls_authorized: false,
  dispatch_available: false,
  lanes: Object.freeze([
    Object.freeze({
      lane: "MAGE_IMAGE",
      checkpoint: "V2-07",
      qualification: "NOT_QUALIFIED",
      visual_approval: "NOT_APPLICABLE",
      provider_free_groundwork_commits: Object.freeze(["1283a23248c9b79832b6fb331b00474e1df70f81"]),
      missing_gates: Object.freeze(["identity_output", "cancellation_timeout", "max2_concurrency"]),
    }),
    Object.freeze({
      lane: "SOULX_AVATAR",
      checkpoint: "V2-08",
      qualification: "NOT_QUALIFIED",
      visual_approval: "PENDING_USER_VISUAL_APPROVAL",
      provider_free_groundwork_commits: Object.freeze([
        "7039092707103ab35e8010c009e14409a6e52f63",
        "84e00881d98e3e77dd8aad121453ed6e7287bc74",
        "e49b93854d58c4faeb8bdd10b9b9df07321026db",
        "f3557059d7d5f0637ea223b3e758389fbd80a52b",
      ]),
      missing_gates: Object.freeze([
        "V2_07_MAGE_QUALIFICATION",
        "V2_08_USER_VISUAL_CROP_APPROVAL",
        "V2_08_IMAGE_PUBLICATION_AND_ENDPOINT_CONFIGURATION",
        "V2_08_MAX1_LIVE_QUALIFICATION",
      ]),
    }),
  ]),
});

/** Read-only product projection. It deliberately contains no transport or dispatch capability. */
export function hostedGpuReadiness(): HostedGpuReadiness {
  return READINESS;
}
