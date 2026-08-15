import executionProfileCatalogJson from "../profiles/execution-profile-catalog.v1.json" with { type: "json" };
import fixtureRuntimeProfileSetJson from "../profiles/fixture-runtime.v1.json" with { type: "json" };

export const PROVIDER_MODES = ["fixture", "local", "sandbox", "staging", "production"] as const;
export type ProviderMode = (typeof PROVIDER_MODES)[number];

export function isProviderMode(value: unknown): value is ProviderMode {
  return typeof value === "string" && PROVIDER_MODES.includes(value as ProviderMode);
}
export type GenerationMode = "LOWEST_COST" | "BALANCED" | "FASTER";
export type WorkerId = "image-media" | "avatar-primary";
export type WorkerLane = "image_media" | "avatar_primary";
export type PrimaryWorkerLane = "image_media" | "avatar_primary";

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

export interface ExecutionProfileSelectionPolicy {
  readonly mode: "IMMUTABLE_PROFILE_ONLY";
  readonly default_option_label: "Fixture";
  readonly raw_gpu_mutation_allowed: false;
  readonly production_gate_id: "GATE_SERVERLESS_CONTRACT_001";
}

export type ServerlessLaneGateId = "GATE_SERVERLESS_MAGE_001" | "GATE_SERVERLESS_SOULX_001";

export interface LaneModelMetadata {
  readonly display_name: string;
  readonly model_id: string;
  readonly role: "IMAGE_GENERATOR" | "AVATAR_PRIMARY";
  readonly qualification_state: "BENCHMARK_REQUIRED";
}

export interface LaneProcessMetadata {
  readonly display_name: string;
  readonly parallel_group: "PRIMARY_GENERATION";
  readonly parallel_with: PrimaryWorkerLane;
}

export interface FixtureLaneStatus {
  readonly code: "FIXTURE_IDLE";
  readonly label: "Fixture ready";
  readonly detail: "Synthetic output · no provider connected";
  readonly process_state: "IDLE";
  readonly model_state: "NOT_LOADED";
  readonly provider_state: "NOT_CONNECTED";
  readonly queued_jobs: 0;
  readonly active_jobs: 0;
  readonly external_spend_usd: 0;
}

export interface FixtureProfileSelectorOption {
  readonly profile_id: string;
  readonly profile_version: 1;
  readonly label: "Fixture";
  readonly detail: "Fixture · $0";
  readonly selectable: true;
  readonly selection_state: "FIXTURE_ONLY";
  readonly endpoint_id: null;
  readonly gpu_label: null;
  readonly external_spend_usd: 0;
}

export interface BenchmarkRequiredGpuCandidate {
  readonly candidate_id: string;
  readonly label: string;
  readonly planned_priority: number;
  readonly selectable: false;
  readonly status: "BENCHMARK_REQUIRED";
  readonly gate_id: ServerlessLaneGateId;
}

export interface PrimaryLaneCatalogEntry {
  readonly lane: PrimaryWorkerLane;
  readonly selector_label: string;
  readonly model: LaneModelMetadata;
  readonly process: LaneProcessMetadata;
  readonly status: FixtureLaneStatus;
  readonly selector_options: readonly [FixtureProfileSelectorOption];
  readonly planned_candidates: readonly BenchmarkRequiredGpuCandidate[];
}

export interface ExecutionProfileCatalog {
  readonly schema_version: "execution-profile-catalog/v1";
  readonly catalog_id: "fixture-primary-lanes-v1";
  readonly provider_mode: "fixture";
  readonly provider_calls_authorized: false;
  readonly maximum_external_spend_usd: 0;
  readonly selection_policy: ExecutionProfileSelectionPolicy;
  readonly lanes: readonly [PrimaryLaneCatalogEntry, PrimaryLaneCatalogEntry];
}

export interface ResolvedFixtureExecutionProfiles {
  readonly generation_mode: GenerationMode;
  readonly image_media: FixtureExecutionProfile;
  readonly avatar_primary: FixtureExecutionProfile;
}

export interface ResolvedFixturePrimaryExecutionProfiles {
  readonly generation_mode: GenerationMode;
  readonly image_media: FixtureExecutionProfile;
  readonly avatar_primary: FixtureExecutionProfile;
}

type JsonObject = Record<string, unknown>;
type JsonLiteral = string | number | boolean | null;

const GENERATION_MODES: readonly GenerationMode[] = ["LOWEST_COST", "BALANCED", "FASTER"];
const WORKER_LANES: readonly WorkerLane[] = ["image_media", "avatar_primary"];
const PRIMARY_WORKER_LANES: readonly PrimaryWorkerLane[] = ["image_media", "avatar_primary"];

const WORKER_ID_BY_LANE: Readonly<Record<WorkerLane, WorkerId>> = {
  image_media: "image-media",
  avatar_primary: "avatar-primary",
};

const PROFILE_ID_FIELD_BY_LANE: Readonly<Record<WorkerLane, keyof ExecutionProfileBindings>> = {
  image_media: "image_media_profile_id",
  avatar_primary: "avatar_primary_profile_id",
};

const LANE_EXPECTATIONS = {
  image_media: {
    selectorLabel: "Image generation",
    modelDisplayName: "Mage-Flow Turbo INT8 ConvRot",
    modelId: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
    modelRole: "IMAGE_GENERATOR",
    processDisplayName: "Generate images",
    parallelWith: "avatar_primary",
    candidateGateId: "GATE_SERVERLESS_MAGE_001",
    candidateIds: ["mage-rtx-4090"],
    candidateLabels: ["RTX 4090"],
  },
  avatar_primary: {
    selectorLabel: "Avatar generation",
    modelDisplayName: "SoulX-FlashHead Pro",
    modelId: "Soul-AILab/SoulX-FlashHead-1_3B@59119b6c681230c3eeee157e224ae1941746711e#Model_Pro",
    modelRole: "AVATAR_PRIMARY",
    processDisplayName: "Generate avatar clips",
    parallelWith: "image_media",
    candidateGateId: "GATE_SERVERLESS_SOULX_001",
    candidateIds: ["soulx-flashhead-pro-rtx-4090"],
    candidateLabels: ["RTX 4090"],
  },
} as const;

export class RuntimeConfigValidationError extends Error {
  constructor(path: string, detail: string) {
    super(`Invalid runtime config at ${path}: ${detail}`);
    this.name = "RuntimeConfigValidationError";
  }
}

function fail(path: string, detail: string): never {
  throw new RuntimeConfigValidationError(path, detail);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectAt(value: unknown, path: string): JsonObject {
  if (!isJsonObject(value)) {
    return fail(path, "expected an object");
  }
  return value;
}

function arrayAt(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) return fail(path, "expected an array");
  return value;
}

function exactKeys(value: JsonObject, expected: readonly string[], path: string): void {
  const actual = Object.keys(value);
  const missing = expected.filter((key) => !(key in value));
  const unexpected = actual.filter((key) => !expected.includes(key));
  if (missing.length > 0) fail(path, `missing keys: ${missing.join(", ")}`);
  if (unexpected.length > 0) fail(path, `unexpected keys: ${unexpected.join(", ")}`);
}

function literalAt<const T extends JsonLiteral>(value: unknown, expected: T, path: string): T {
  if (value !== expected) return fail(path, `expected ${JSON.stringify(expected)}`);
  return expected;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fail(path, "expected a non-empty string");
  }
  return value;
}

function positiveIntegerAt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return fail(path, "expected a positive integer");
  }
  return value;
}

function workerLaneAt(value: unknown, path: string): WorkerLane {
  switch (value) {
    case "image_media":
    case "avatar_primary":
      return value;
    default:
      return fail(path, `expected one of ${WORKER_LANES.join(", ")}`);
  }
}

function primaryWorkerLaneAt(value: unknown, path: string): PrimaryWorkerLane {
  switch (value) {
    case "image_media":
    case "avatar_primary":
      return value;
    default:
      return fail(path, `expected one of ${PRIMARY_WORKER_LANES.join(", ")}`);
  }
}

function parseFixtureExecutionProfile(value: unknown, path: string): FixtureExecutionProfile {
  const input = objectAt(value, path);
  exactKeys(
    input,
    [
      "profile_id",
      "profile_version",
      "lane",
      "worker_id",
      "adapter_version",
      "endpoint_id",
      "endpoint_configuration_revision",
      "provider_gpu_priorities",
      "container_digest",
      "model_ready",
      "benchmarked",
      "maximum_reservation_usd",
    ],
    path,
  );

  const lane = workerLaneAt(input.lane, `${path}.lane`);
  const expectedWorkerId = WORKER_ID_BY_LANE[lane];
  const priorities = arrayAt(input.provider_gpu_priorities, `${path}.provider_gpu_priorities`);
  if (priorities.length !== 0) {
    fail(`${path}.provider_gpu_priorities`, "fixture profiles cannot claim GPU priorities");
  }
  const noGpuPriorities: [] = [];

  return Object.freeze({
    profile_id: stringAt(input.profile_id, `${path}.profile_id`),
    profile_version: literalAt(input.profile_version, 1, `${path}.profile_version`),
    lane,
    worker_id: literalAt(input.worker_id, expectedWorkerId, `${path}.worker_id`),
    adapter_version: literalAt(
      input.adapter_version,
      "deterministic-fixture-v1",
      `${path}.adapter_version`,
    ),
    endpoint_id: literalAt(input.endpoint_id, null, `${path}.endpoint_id`),
    endpoint_configuration_revision: literalAt(
      input.endpoint_configuration_revision,
      null,
      `${path}.endpoint_configuration_revision`,
    ),
    provider_gpu_priorities: Object.freeze(noGpuPriorities),
    container_digest: literalAt(input.container_digest, null, `${path}.container_digest`),
    model_ready: literalAt(input.model_ready, false, `${path}.model_ready`),
    benchmarked: literalAt(input.benchmarked, false, `${path}.benchmarked`),
    maximum_reservation_usd: literalAt(
      input.maximum_reservation_usd,
      0,
      `${path}.maximum_reservation_usd`,
    ),
  });
}

function parseExecutionProfileBindings(value: unknown, path: string): ExecutionProfileBindings {
  const input = objectAt(value, path);
  exactKeys(input, ["image_media_profile_id", "avatar_primary_profile_id"], path);
  return Object.freeze({
    image_media_profile_id: stringAt(
      input.image_media_profile_id,
      `${path}.image_media_profile_id`,
    ),
    avatar_primary_profile_id: stringAt(
      input.avatar_primary_profile_id,
      `${path}.avatar_primary_profile_id`,
    ),
  });
}

export function parseFixtureRuntimeProfileSet(value: unknown): FixtureRuntimeProfileSet {
  const path = "fixtureRuntimeProfileSet";
  const input = objectAt(value, path);
  exactKeys(
    input,
    [
      "schema_version",
      "profile_set_id",
      "provider_mode",
      "provider_calls_authorized",
      "maximum_external_spend_usd",
      "synthetic",
      "health_contract_version",
      "generation_mode_bindings",
      "profiles",
    ],
    path,
  );

  const bindingsInput = objectAt(
    input.generation_mode_bindings,
    `${path}.generation_mode_bindings`,
  );
  exactKeys(bindingsInput, GENERATION_MODES, `${path}.generation_mode_bindings`);
  const generationModeBindings = Object.freeze({
    LOWEST_COST: parseExecutionProfileBindings(
      bindingsInput.LOWEST_COST,
      `${path}.generation_mode_bindings.LOWEST_COST`,
    ),
    BALANCED: parseExecutionProfileBindings(
      bindingsInput.BALANCED,
      `${path}.generation_mode_bindings.BALANCED`,
    ),
    FASTER: parseExecutionProfileBindings(
      bindingsInput.FASTER,
      `${path}.generation_mode_bindings.FASTER`,
    ),
  });

  const profiles = arrayAt(input.profiles, `${path}.profiles`).map((profile, index) =>
    parseFixtureExecutionProfile(profile, `${path}.profiles[${index}]`),
  );
  const profilesById = new Map<string, FixtureExecutionProfile>();
  const profileCountByLane = new Map<WorkerLane, number>();
  for (const profile of profiles) {
    if (profilesById.has(profile.profile_id)) {
      fail(`${path}.profiles`, `duplicate profile_id ${profile.profile_id}`);
    }
    profilesById.set(profile.profile_id, profile);
    profileCountByLane.set(profile.lane, (profileCountByLane.get(profile.lane) ?? 0) + 1);
  }

  for (const lane of WORKER_LANES) {
    if (profileCountByLane.get(lane) !== 1) {
      fail(`${path}.profiles`, `expected exactly one fixture profile for ${lane}`);
    }
  }

  for (const mode of GENERATION_MODES) {
    const bindings = generationModeBindings[mode];
    for (const lane of WORKER_LANES) {
      const profileId = bindings[PROFILE_ID_FIELD_BY_LANE[lane]];
      const profile = profilesById.get(profileId);
      if (!profile) {
        fail(`${path}.generation_mode_bindings.${mode}`, `references unknown profile ${profileId}`);
      }
      if (profile.lane !== lane) {
        fail(
          `${path}.generation_mode_bindings.${mode}`,
          `profile ${profileId} belongs to ${profile.lane}, not ${lane}`,
        );
      }
    }
  }

  return Object.freeze({
    schema_version: literalAt(
      input.schema_version,
      "runtime-profile-set/v1",
      `${path}.schema_version`,
    ),
    profile_set_id: literalAt(input.profile_set_id, "fixture-runtime-v1", `${path}.profile_set_id`),
    provider_mode: literalAt(input.provider_mode, "fixture", `${path}.provider_mode`),
    provider_calls_authorized: literalAt(
      input.provider_calls_authorized,
      false,
      `${path}.provider_calls_authorized`,
    ),
    maximum_external_spend_usd: literalAt(
      input.maximum_external_spend_usd,
      0,
      `${path}.maximum_external_spend_usd`,
    ),
    synthetic: literalAt(input.synthetic, true, `${path}.synthetic`),
    health_contract_version: literalAt(
      input.health_contract_version,
      "worker-health/v1",
      `${path}.health_contract_version`,
    ),
    generation_mode_bindings: generationModeBindings,
    profiles: Object.freeze(profiles),
  });
}

function parseSelectionPolicy(value: unknown, path: string): ExecutionProfileSelectionPolicy {
  const input = objectAt(value, path);
  exactKeys(
    input,
    ["mode", "default_option_label", "raw_gpu_mutation_allowed", "production_gate_id"],
    path,
  );
  return Object.freeze({
    mode: literalAt(input.mode, "IMMUTABLE_PROFILE_ONLY", `${path}.mode`),
    default_option_label: literalAt(
      input.default_option_label,
      "Fixture",
      `${path}.default_option_label`,
    ),
    raw_gpu_mutation_allowed: literalAt(
      input.raw_gpu_mutation_allowed,
      false,
      `${path}.raw_gpu_mutation_allowed`,
    ),
    production_gate_id: literalAt(
      input.production_gate_id,
      "GATE_SERVERLESS_CONTRACT_001",
      `${path}.production_gate_id`,
    ),
  });
}

function parseLaneModelMetadata(
  value: unknown,
  lane: PrimaryWorkerLane,
  path: string,
): LaneModelMetadata {
  const input = objectAt(value, path);
  exactKeys(input, ["display_name", "model_id", "role", "qualification_state"], path);
  const expected = LANE_EXPECTATIONS[lane];
  return Object.freeze({
    display_name: literalAt(input.display_name, expected.modelDisplayName, `${path}.display_name`),
    model_id: literalAt(input.model_id, expected.modelId, `${path}.model_id`),
    role: literalAt(input.role, expected.modelRole, `${path}.role`),
    qualification_state: literalAt(
      input.qualification_state,
      "BENCHMARK_REQUIRED",
      `${path}.qualification_state`,
    ),
  });
}

function parseLaneProcessMetadata(
  value: unknown,
  lane: PrimaryWorkerLane,
  path: string,
): LaneProcessMetadata {
  const input = objectAt(value, path);
  exactKeys(input, ["display_name", "parallel_group", "parallel_with"], path);
  const expected = LANE_EXPECTATIONS[lane];
  return Object.freeze({
    display_name: literalAt(
      input.display_name,
      expected.processDisplayName,
      `${path}.display_name`,
    ),
    parallel_group: literalAt(input.parallel_group, "PRIMARY_GENERATION", `${path}.parallel_group`),
    parallel_with: literalAt(input.parallel_with, expected.parallelWith, `${path}.parallel_with`),
  });
}

function parseFixtureLaneStatus(value: unknown, path: string): FixtureLaneStatus {
  const input = objectAt(value, path);
  exactKeys(
    input,
    [
      "code",
      "label",
      "detail",
      "process_state",
      "model_state",
      "provider_state",
      "queued_jobs",
      "active_jobs",
      "external_spend_usd",
    ],
    path,
  );
  return Object.freeze({
    code: literalAt(input.code, "FIXTURE_IDLE", `${path}.code`),
    label: literalAt(input.label, "Fixture ready", `${path}.label`),
    detail: literalAt(input.detail, "Synthetic output · no provider connected", `${path}.detail`),
    process_state: literalAt(input.process_state, "IDLE", `${path}.process_state`),
    model_state: literalAt(input.model_state, "NOT_LOADED", `${path}.model_state`),
    provider_state: literalAt(input.provider_state, "NOT_CONNECTED", `${path}.provider_state`),
    queued_jobs: literalAt(input.queued_jobs, 0, `${path}.queued_jobs`),
    active_jobs: literalAt(input.active_jobs, 0, `${path}.active_jobs`),
    external_spend_usd: literalAt(input.external_spend_usd, 0, `${path}.external_spend_usd`),
  });
}

function parseFixtureProfileSelectorOption(
  value: unknown,
  path: string,
): FixtureProfileSelectorOption {
  const input = objectAt(value, path);
  exactKeys(
    input,
    [
      "profile_id",
      "profile_version",
      "label",
      "detail",
      "selectable",
      "selection_state",
      "endpoint_id",
      "gpu_label",
      "external_spend_usd",
    ],
    path,
  );
  return Object.freeze({
    profile_id: stringAt(input.profile_id, `${path}.profile_id`),
    profile_version: literalAt(input.profile_version, 1, `${path}.profile_version`),
    label: literalAt(input.label, "Fixture", `${path}.label`),
    detail: literalAt(input.detail, "Fixture · $0", `${path}.detail`),
    selectable: literalAt(input.selectable, true, `${path}.selectable`),
    selection_state: literalAt(input.selection_state, "FIXTURE_ONLY", `${path}.selection_state`),
    endpoint_id: literalAt(input.endpoint_id, null, `${path}.endpoint_id`),
    gpu_label: literalAt(input.gpu_label, null, `${path}.gpu_label`),
    external_spend_usd: literalAt(input.external_spend_usd, 0, `${path}.external_spend_usd`),
  });
}

function parseBenchmarkRequiredGpuCandidate(
  value: unknown,
  gateId: ServerlessLaneGateId,
  path: string,
): BenchmarkRequiredGpuCandidate {
  const input = objectAt(value, path);
  exactKeys(
    input,
    ["candidate_id", "label", "planned_priority", "selectable", "status", "gate_id"],
    path,
  );
  return Object.freeze({
    candidate_id: stringAt(input.candidate_id, `${path}.candidate_id`),
    label: stringAt(input.label, `${path}.label`),
    planned_priority: positiveIntegerAt(input.planned_priority, `${path}.planned_priority`),
    selectable: literalAt(input.selectable, false, `${path}.selectable`),
    status: literalAt(input.status, "BENCHMARK_REQUIRED", `${path}.status`),
    gate_id: literalAt(input.gate_id, gateId, `${path}.gate_id`),
  });
}

function parsePrimaryLaneCatalogEntry(value: unknown, path: string): PrimaryLaneCatalogEntry {
  const input = objectAt(value, path);
  exactKeys(
    input,
    [
      "lane",
      "selector_label",
      "model",
      "process",
      "status",
      "selector_options",
      "planned_candidates",
    ],
    path,
  );
  const lane = primaryWorkerLaneAt(input.lane, `${path}.lane`);
  const expected = LANE_EXPECTATIONS[lane];

  const optionsInput = arrayAt(input.selector_options, `${path}.selector_options`);
  if (optionsInput.length !== 1) {
    fail(`${path}.selector_options`, "expected exactly one selectable fixture profile");
  }
  const option = parseFixtureProfileSelectorOption(optionsInput[0], `${path}.selector_options[0]`);

  const candidates = arrayAt(input.planned_candidates, `${path}.planned_candidates`).map(
    (candidate, index) =>
      parseBenchmarkRequiredGpuCandidate(
        candidate,
        expected.candidateGateId,
        `${path}.planned_candidates[${index}]`,
      ),
  );
  if (candidates.length !== expected.candidateLabels.length) {
    fail(
      `${path}.planned_candidates`,
      `expected ${expected.candidateLabels.length} benchmark candidates`,
    );
  }
  const candidateIds = new Set<string>();
  candidates.forEach((candidate, index) => {
    if (candidateIds.has(candidate.candidate_id)) {
      fail(`${path}.planned_candidates`, `duplicate candidate_id ${candidate.candidate_id}`);
    }
    candidateIds.add(candidate.candidate_id);
    if (candidate.candidate_id !== expected.candidateIds[index]) {
      fail(
        `${path}.planned_candidates[${index}].candidate_id`,
        `expected ${expected.candidateIds[index]}`,
      );
    }
    if (candidate.label !== expected.candidateLabels[index]) {
      fail(
        `${path}.planned_candidates[${index}].label`,
        `expected ${expected.candidateLabels[index]}`,
      );
    }
    if (candidate.planned_priority !== index + 1) {
      fail(`${path}.planned_candidates[${index}].planned_priority`, `expected ${index + 1}`);
    }
  });
  const selectorOptions: [FixtureProfileSelectorOption] = [option];

  return Object.freeze({
    lane,
    selector_label: literalAt(
      input.selector_label,
      expected.selectorLabel,
      `${path}.selector_label`,
    ),
    model: parseLaneModelMetadata(input.model, lane, `${path}.model`),
    process: parseLaneProcessMetadata(input.process, lane, `${path}.process`),
    status: parseFixtureLaneStatus(input.status, `${path}.status`),
    selector_options: Object.freeze(selectorOptions),
    planned_candidates: Object.freeze(candidates),
  });
}

export function parseExecutionProfileCatalog(
  value: unknown,
  runtimeProfileSet: FixtureRuntimeProfileSet,
): ExecutionProfileCatalog {
  const path = "executionProfileCatalog";
  const input = objectAt(value, path);
  exactKeys(
    input,
    [
      "schema_version",
      "catalog_id",
      "provider_mode",
      "provider_calls_authorized",
      "maximum_external_spend_usd",
      "selection_policy",
      "lanes",
    ],
    path,
  );

  const laneInputs = arrayAt(input.lanes, `${path}.lanes`);
  if (laneInputs.length !== PRIMARY_WORKER_LANES.length) {
    fail(`${path}.lanes`, "expected exactly the image_media and avatar_primary lanes");
  }
  const lanes = laneInputs.map((lane, index) =>
    parsePrimaryLaneCatalogEntry(lane, `${path}.lanes[${index}]`),
  );
  const lanesById = new Map(lanes.map((lane) => [lane.lane, lane]));
  for (const lane of PRIMARY_WORKER_LANES) {
    const laneEntry = lanesById.get(lane);
    if (!laneEntry || lanesById.size !== PRIMARY_WORKER_LANES.length) {
      fail(`${path}.lanes`, `expected one catalog entry for ${lane}`);
    }

    const option = laneEntry.selector_options[0];
    const runtimeProfile = runtimeProfileSet.profiles.find(
      (profile) => profile.profile_id === option.profile_id,
    );
    if (!runtimeProfile || runtimeProfile.lane !== lane) {
      fail(
        `${path}.lanes.${lane}.selector_options`,
        `profile ${option.profile_id} is not the fixture profile for ${lane}`,
      );
    }

    for (const mode of GENERATION_MODES) {
      const boundProfileId =
        runtimeProfileSet.generation_mode_bindings[mode][PROFILE_ID_FIELD_BY_LANE[lane]];
      if (boundProfileId !== option.profile_id) {
        fail(
          `${path}.lanes.${lane}.selector_options`,
          `${mode} resolves ${boundProfileId}, not the selectable fixture profile`,
        );
      }
    }
  }
  const firstLane = lanes[0];
  const secondLane = lanes[1];
  if (!firstLane || !secondLane) {
    return fail(`${path}.lanes`, "expected exactly two primary lane entries");
  }
  const laneTuple: [PrimaryLaneCatalogEntry, PrimaryLaneCatalogEntry] = [firstLane, secondLane];

  return Object.freeze({
    schema_version: literalAt(
      input.schema_version,
      "execution-profile-catalog/v1",
      `${path}.schema_version`,
    ),
    catalog_id: literalAt(input.catalog_id, "fixture-primary-lanes-v1", `${path}.catalog_id`),
    provider_mode: literalAt(input.provider_mode, "fixture", `${path}.provider_mode`),
    provider_calls_authorized: literalAt(
      input.provider_calls_authorized,
      false,
      `${path}.provider_calls_authorized`,
    ),
    maximum_external_spend_usd: literalAt(
      input.maximum_external_spend_usd,
      0,
      `${path}.maximum_external_spend_usd`,
    ),
    selection_policy: parseSelectionPolicy(input.selection_policy, `${path}.selection_policy`),
    lanes: Object.freeze(laneTuple),
  });
}

export const fixtureRuntimeProfileSet = parseFixtureRuntimeProfileSet(fixtureRuntimeProfileSetJson);

export const executionProfileCatalog = parseExecutionProfileCatalog(
  executionProfileCatalogJson,
  fixtureRuntimeProfileSet,
);

export function getFixtureExecutionProfile(profileId: string): FixtureExecutionProfile {
  const profile = fixtureRuntimeProfileSet.profiles.find(
    (candidate) => candidate.profile_id === profileId,
  );
  if (!profile) throw new Error(`Unknown fixture execution profile: ${profileId}`);
  return profile;
}

export function getPrimaryLaneCatalog(lane: PrimaryWorkerLane): PrimaryLaneCatalogEntry {
  const laneEntry = executionProfileCatalog.lanes.find((candidate) => candidate.lane === lane);
  if (!laneEntry) throw new Error(`Unknown primary worker lane: ${lane}`);
  return laneEntry;
}

export function resolveFixtureExecutionProfiles(
  generationMode: GenerationMode,
): ResolvedFixtureExecutionProfiles {
  const bindings = fixtureRuntimeProfileSet.generation_mode_bindings[generationMode];
  if (!bindings) throw new Error(`Unknown generation mode: ${generationMode}`);
  return Object.freeze({
    generation_mode: generationMode,
    image_media: getFixtureExecutionProfile(bindings.image_media_profile_id),
    avatar_primary: getFixtureExecutionProfile(bindings.avatar_primary_profile_id),
  });
}

export function resolveFixturePrimaryExecutionProfiles(
  generationMode: GenerationMode,
): ResolvedFixturePrimaryExecutionProfiles {
  const profiles = resolveFixtureExecutionProfiles(generationMode);
  return Object.freeze({
    generation_mode: profiles.generation_mode,
    image_media: profiles.image_media,
    avatar_primary: profiles.avatar_primary,
  });
}
