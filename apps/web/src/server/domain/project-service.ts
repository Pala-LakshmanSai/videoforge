import type { CreateProjectRequest } from "@videoforge/contracts/create-project";
import { validateOutputRuleKeywords } from "@videoforge/contracts/output-rules";
import { getFixtureExecutionProfile, resolveFixtureExecutionProfiles } from "@videoforge/config";
import {
  toProjectDetailResponse,
  type AvatarProfileResponse,
  type FixtureProblem,
  type FixtureScenario,
  type FixtureScenarioId,
  type ImageStyleResponse,
  type ProjectSummaryResponse,
} from "@videoforge/test-fixtures";

import { apiProblem, problemResponse } from "../problem";
import {
  type RegisteredVoiceover,
  type RuntimeProjectDetail,
  type RuntimeProjectSummary,
  type RuntimeProjects,
} from "./models";
import { avatarCatalog, imageStyleCatalog } from "./preset-service";
import { VERIFIED_FIXTURE_VOICEOVER_HANDLE } from "./voiceover-service";

export const FIXTURE_ESTIMATED_COST_USD = 0.88;

const EXECUTION_PROFILE_GATE_BY_LANE = {
  image_media: "GATE_SERVERLESS_MAGE_001",
  avatar_primary: "GATE_SERVERLESS_SOULX_001",
} as const;

type FixtureMutationOperation = "PROJECT_CREATE" | "PROJECT_PREFLIGHT";

const PROJECT_INPUT_PROBLEM_CODES: ReadonlySet<string> = new Set([
  "AVATAR_PROFILE_REQUIRED",
  "AVATAR_PROFILE_NOT_READY",
  "AVATAR_SOURCE_INVALID",
  "AVATAR_PROFILE_ARCHIVED",
  "EXTRA_KEYWORDS_FORBIDDEN_OUTPUT",
  "BUDGET_CAP_EXCEEDED",
]);

type ProjectDetailResolution =
  | { ok: true; detail: RuntimeProjectDetail }
  | { ok: false; response: Response };

function projectVersionToken(projectId: string, revisionId: string, version: number): string {
  return `"vf-${projectId}-${revisionId}-v${version}"`;
}

function nextProjectVersionToken(current: string): string {
  const match = /-v([1-9][0-9]*)"$/u.exec(current);
  if (!match) throw new Error("Runtime project has an invalid version token.");
  return current.replace(/-v[1-9][0-9]*"$/u, `-v${Number(match[1]) + 1}"`);
}

export function rotateProjectVersion(detail: RuntimeProjectDetail): string {
  const next = nextProjectVersionToken(detail.project.versionToken);
  detail.project.versionToken = next;
  return next;
}

function enrichProjectSummary(
  scenario: FixtureScenario,
  project: ProjectSummaryResponse,
): RuntimeProjectSummary {
  const revisionId = scenario.snapshot.project?.revisionId ?? "revision_fixture_unknown";
  return {
    ...structuredClone(project),
    revisionId,
    versionToken: projectVersionToken(project.id, revisionId, 1),
    pins: {
      avatarProfileVersionId: scenario.snapshot.draft.avatarProfileVersionId,
      imageStyleVersionId: scenario.snapshot.draft.imageStyleVersionId,
    },
  };
}

export function baseProjectDetail(scenario: FixtureScenario): RuntimeProjectDetail | null {
  const detail = toProjectDetailResponse(scenario);
  if (!detail) return null;
  return {
    ...structuredClone(detail),
    project: enrichProjectSummary(scenario, detail.project),
  };
}

function getRuntimeProject(
  projects: RuntimeProjects,
  scenarioId: FixtureScenarioId,
  projectId: string,
): RuntimeProjectDetail | null {
  const project = projects.get(scenarioId)?.get(projectId);
  return project ? structuredClone(project) : null;
}

export function putRuntimeProject(
  projects: RuntimeProjects,
  scenarioId: FixtureScenarioId,
  detail: RuntimeProjectDetail,
): void {
  let scenarioProjects = projects.get(scenarioId);
  if (!scenarioProjects) {
    scenarioProjects = new Map();
    projects.set(scenarioId, scenarioProjects);
  }
  scenarioProjects.set(detail.project.id, structuredClone(detail));
}

export function projectDetailsForScenario(
  projects: RuntimeProjects,
  scenario: FixtureScenario,
): RuntimeProjectDetail[] {
  const base = baseProjectDetail(scenario);
  const merged = new Map<string, RuntimeProjectDetail>();
  if (base) merged.set(base.project.id, base);
  for (const [projectId, detail] of projects.get(scenario.id) ?? []) {
    merged.set(projectId, structuredClone(detail));
  }
  return [...merged.values()];
}

export function resolveProjectDetail(
  scenario: FixtureScenario,
  projectId: string,
  projects?: RuntimeProjects,
): ProjectDetailResolution {
  const detail = projects
    ? (getRuntimeProject(projects, scenario.id, projectId) ?? baseProjectDetail(scenario))
    : baseProjectDetail(scenario);
  if (detail === null || detail.project.id !== projectId) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "PROJECT_NOT_FOUND",
          404,
          "Project not found",
          `Project '${projectId}' is not present in fixture '${scenario.id}'.`,
          false,
        ),
      ),
    };
  }
  return { ok: true, detail };
}

type SemanticPreflightResolution =
  | {
      ok: true;
      estimatedCostUsd: number;
    }
  | { ok: false; response: Response };

export function semanticProjectPreflight(
  scenario: FixtureScenario,
  request: CreateProjectRequest,
  registeredVoiceovers: ReadonlyMap<string, RegisteredVoiceover>,
  addedAvatars: AvatarProfileResponse[],
  addedStyles: ImageStyleResponse[],
): SemanticPreflightResolution {
  const fixtureVoiceover = scenario.snapshot.draft.voiceover;
  const matchesScenarioVoiceover = fixtureVoiceover.assetId === request.voiceover_asset_id;
  const matchesVerifiedLocalHandle = registeredVoiceovers.has(request.voiceover_asset_id);
  if (!matchesScenarioVoiceover && !matchesVerifiedLocalHandle) {
    const looksLikeLocalHandle = VERIFIED_FIXTURE_VOICEOVER_HANDLE.test(request.voiceover_asset_id);
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          looksLikeLocalHandle ? "VOICEOVER_ASSET_NOT_REGISTERED" : "VOICEOVER_ASSET_NOT_FOUND",
          looksLikeLocalHandle ? 409 : 422,
          looksLikeLocalHandle
            ? "Browser-verified voiceover is not registered"
            : "Verified voiceover was not found",
          looksLikeLocalHandle
            ? "Register the browser-validated metadata before project preflight; audio bytes remain local."
            : "Select a fixture voiceover that completed local verification before preflight.",
          false,
        ),
      ),
    };
  }
  if (matchesScenarioVoiceover && fixtureVoiceover.uploadState !== "VERIFIED") {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "VOICEOVER_ASSET_NOT_VERIFIED",
          409,
          "Voiceover is not verified",
          "Wait for voiceover verification to finish or select another verified asset.",
          true,
        ),
      ),
    };
  }

  const avatar = avatarCatalog(scenario, addedAvatars).find(
    (profile) => profile.versionId === request.avatar_profile_version_id,
  );
  if (!avatar) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "AVATAR_PROFILE_NOT_FOUND",
          422,
          "Avatar Profile version was not found",
          "Choose an exact workspace-visible Avatar Profile version from the Avatar Hub.",
          false,
        ),
      ),
    };
  }
  if (avatar.status === "ARCHIVED") {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "AVATAR_PROFILE_ARCHIVED",
          409,
          "Selected avatar is archived",
          "Choose another active Avatar Profile version before creating a revision.",
          false,
        ),
      ),
    };
  }
  if (avatar.status !== "READY") {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "AVATAR_PROFILE_NOT_READY",
          409,
          "Selected avatar is not ready",
          "Wait for source validation and explicit approval before selecting this version.",
          avatar.status === "VALIDATING",
        ),
      ),
    };
  }

  const style = imageStyleCatalog(scenario, addedStyles).find(
    (candidate) => candidate.versionId === request.image_style_version_id,
  );
  if (!style) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "IMAGE_STYLE_VERSION_NOT_FOUND",
          422,
          "Image Style version was not found",
          "Choose an exact workspace-visible published Image Style version.",
          false,
        ),
      ),
    };
  }
  if (style.status !== "PUBLISHED" || style.activeVersion < 1) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "STYLE_NOT_READY",
          409,
          "Selected Image Style is not published",
          "Choose an active published style version. A draft or analyzing version cannot be pinned.",
          style.status === "ANALYZING",
        ),
      ),
    };
  }

  const defaultProfiles = resolveFixtureExecutionProfiles(request.generation_mode);
  const overrideEntries = [
    ["image_media_profile_id", "image_media"],
    ["avatar_primary_profile_id", "avatar_primary"],
  ] as const;
  for (const [field, lane] of overrideEntries) {
    const profileId =
      request.execution_profile_overrides?.[field] ?? defaultProfiles[lane].profile_id;
    try {
      const profile = getFixtureExecutionProfile(profileId);
      if (profile.lane !== lane) throw new Error("lane mismatch");
    } catch {
      return {
        ok: false,
        response: problemResponse(
          apiProblem(
            "EXECUTION_PROFILE_NOT_AVAILABLE",
            409,
            "Selected compute profile is not available",
            `Choose a tested ${lane.replaceAll("_", " ")} execution profile. The production candidate remains unavailable until ${EXECUTION_PROFILE_GATE_BY_LANE[lane]} passes.`,
            false,
          ),
        ),
      };
    }
  }

  if (request.apply_extra_prompt_keywords) {
    const keywordValidation = validateOutputRuleKeywords(request.extra_prompt_keywords ?? "");
    if (!keywordValidation.valid) {
      return {
        ok: false,
        response: problemResponse(
          apiProblem(
            "EXTRA_KEYWORDS_FORBIDDEN_OUTPUT",
            422,
            "Extra keywords conflict with output rules",
            "Enabled keywords cannot request prohibited text, graphics, borders, watermarks, or decorative transitions.",
            false,
          ),
          keywordValidation.conflicts,
        ),
      };
    }
  }

  if (FIXTURE_ESTIMATED_COST_USD > request.spend_cap_usd) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "BUDGET_CAP_EXCEEDED",
          409,
          "Project is blocked by its spend cap",
          `The fixture estimate is $${FIXTURE_ESTIMATED_COST_USD.toFixed(2)} and the configured cap is $${request.spend_cap_usd.toFixed(2)}.`,
          false,
        ),
      ),
    };
  }

  return { ok: true, estimatedCostUsd: FIXTURE_ESTIMATED_COST_USD };
}

export function scenarioMutationProblemFor(
  scenario: FixtureScenario,
  operation: FixtureMutationOperation,
  request: CreateProjectRequest,
): FixtureProblem | null {
  const problem = scenario.snapshot.mutationProblem;
  if (!problem) return null;
  if (
    problem.code.startsWith("AVATAR_") &&
    request.avatar_profile_version_id !== scenario.snapshot.draft.avatarProfileVersionId
  ) {
    return null;
  }
  if (
    problem.code.startsWith("STYLE_") &&
    request.image_style_version_id !== scenario.snapshot.draft.imageStyleVersionId
  ) {
    return null;
  }
  if (
    (operation === "PROJECT_CREATE" || operation === "PROJECT_PREFLIGHT") &&
    PROJECT_INPUT_PROBLEM_CODES.has(problem.code)
  ) {
    return problem;
  }
  return null;
}
