import fixtureRuntimeProfileSetJson from "../profiles/fixture-runtime.v1.json" with { type: "json" };

export type ProviderMode = "fixture" | "local" | "sandbox" | "production";
export type GenerationMode = "LOWEST_COST" | "BALANCED" | "FASTER";
export type WorkerId = "image-media" | "avatar-primary" | "avatar-repair" | "avatar-quality";
export type WorkerLane = "image_media" | "avatar_primary" | "avatar_repair" | "avatar_quality";

export interface FixtureExecutionProfile {
  readonly profile_id: string;
  readonly profile_version: 1;
  readonly lane: WorkerLane;
  readonly worker_id: WorkerId;
  readonly adapter_version: "deterministic-fixture-v1";
  readonly endpoint_id: null;
  readonly endpoint_configuration_revision: null;
  readonly provider_gpu_priorities: readonly [];
  readonly container_digest: null;
  readonly model_ready: false;
  readonly benchmarked: false;
  readonly maximum_reservation_usd: 0;
}

export interface ExecutionProfileBindings {
  readonly image_media_profile_id: string;
  readonly avatar_primary_profile_id: string;
  readonly avatar_repair_profile_id: string;
  readonly avatar_quality_profile_id: string;
}

export interface FixtureRuntimeProfileSet {
  readonly schema_version: "runtime-profile-set/v1";
  readonly profile_set_id: "fixture-runtime-v1";
  readonly provider_mode: "fixture";
  readonly provider_calls_authorized: false;
  readonly maximum_external_spend_usd: 0;
  readonly synthetic: true;
  readonly health_contract_version: "worker-health/v1";
  readonly generation_mode_bindings: Readonly<Record<GenerationMode, ExecutionProfileBindings>>;
  readonly profiles: readonly FixtureExecutionProfile[];
}

export const fixtureRuntimeProfileSet =
  fixtureRuntimeProfileSetJson as unknown as FixtureRuntimeProfileSet;

export function getFixtureExecutionProfile(profileId: string): FixtureExecutionProfile {
  const profile = fixtureRuntimeProfileSet.profiles.find(
    (candidate) => candidate.profile_id === profileId,
  );
  if (!profile) throw new Error(`Unknown fixture execution profile: ${profileId}`);
  return profile;
}
