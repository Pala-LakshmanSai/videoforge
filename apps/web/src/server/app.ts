import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createProjectRequestSchema,
  validateOutputRuleKeywords,
  type CreateProjectRequest,
} from "@videoforge/contracts";
import {
  executionProfileCatalog,
  getFixtureExecutionProfile,
  resolveFixtureExecutionProfiles,
} from "@videoforge/config";
import {
  DEFAULT_FIXTURE_SCENARIO_ID,
  FIXTURE_SCENARIO_IDS,
  listFixtureScenarios,
  toAvatarProfileResponse,
  toBootstrapResponse,
  toImageStyleResponse,
  toProjectDetailResponse,
  toUsageSummaryResponse,
  type AvatarProfileResponse,
  type FixtureBootstrapResponse,
  type FixtureProblem,
  type FixtureProjectDetailResponse,
  type FixtureScenario,
  type FixtureScenarioId,
  type ImageStyleResponse,
  type ProjectSummaryResponse,
} from "@videoforge/test-fixtures";
import { Hono, type Context } from "hono";
import { z } from "zod";

import { fixtureFromRequest, resolveFixture, safeCommit, type FixtureResolution } from "./fixture";
import { apiProblem, problemResponse } from "./problem";

const FIXTURE_ESTIMATED_COST_USD = 0.88;
const FIXTURE_FALLBACK_INCREMENT_USD = 0.18;
const FIXTURE_VERSION_TOKEN = "fixture-v1";
const VERIFIED_FIXTURE_VOICEOVER_HANDLE = /^fixture_voiceover_sha256_[a-f0-9]{64}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const AVATAR_FIXTURE_PATH = /^\/fixtures\/avatar\/[a-z0-9][a-z0-9._-]*\.svg$/u;
const STYLE_FIXTURE_PATH = /^\/fixtures\/styles\/[a-z0-9][a-z0-9._-]*\.svg$/u;
const VOICEOVER_FILENAME = /^[^/\\\0]{1,255}\.(?:aac|flac|m4a|mp3|wav)$/iu;
const FIXTURE_SESSION_HEADER = "x-videoforge-fixture-session";
const DEFAULT_FIXTURE_SESSION_ID = "default";
const MAX_FIXTURE_SESSION_ID_LENGTH = 96;
const MAX_FIXTURE_SESSION_NAMESPACES = 256;
const FIXTURE_SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,95})$/u;
const FIXTURE_PREVIEW_FILE = resolve(process.cwd(), "public/fixtures/media/watermelon-market.svg");

type FixtureMutationOperation = "PROJECT_CREATE" | "PROJECT_PREFLIGHT";

const PROJECT_INPUT_PROBLEM_CODES: ReadonlySet<string> = new Set([
  "AVATAR_PROFILE_REQUIRED",
  "AVATAR_PROFILE_NOT_READY",
  "AVATAR_SOURCE_INVALID",
  "AVATAR_PROFILE_ARCHIVED",
  "EXTRA_KEYWORDS_FORBIDDEN_OUTPUT",
  "BUDGET_CAP_EXCEEDED",
]);

interface IdempotencyRecord {
  readonly fingerprint: string;
  response: Response | null;
  pending: Promise<Response> | null;
}

type IdempotencyLedger = Map<string, IdempotencyRecord>;

interface ProjectPins {
  avatarProfileVersionId: string | null;
  imageStyleVersionId: string;
}

type RuntimeProjectSummary = ProjectSummaryResponse & {
  revisionId: string;
  pins: ProjectPins;
};

type RuntimeProjectDetail = Omit<FixtureProjectDetailResponse, "project"> & {
  project: RuntimeProjectSummary;
};

type RuntimeProjects = Map<FixtureScenarioId, Map<string, RuntimeProjectDetail>>;

interface RegisteredVoiceover {
  assetId: string;
  checksum: string;
  filename: string;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  verificationState: "VERIFIED";
  persistedBytes: false;
  providerCallsAuthorized: false;
}

interface FixtureSessionState {
  readonly idempotencyLedger: IdempotencyLedger;
  readonly runtimeProjects: RuntimeProjects;
  readonly registeredVoiceovers: Map<string, RegisteredVoiceover>;
  readonly createdAvatars: AvatarProfileResponse[];
  readonly createdStyles: ImageStyleResponse[];
  createdProjectRequest: CreateProjectRequest | null;
  avatarSequence: number;
  styleSequence: number;
}

type FixtureSessionResolution =
  | { ok: true; id: string; state: FixtureSessionState }
  | { ok: false; response: Response };

function createFixtureSessionState(): FixtureSessionState {
  return {
    idempotencyLedger: new Map(),
    runtimeProjects: new Map(),
    registeredVoiceovers: new Map(),
    createdAvatars: [],
    createdStyles: [],
    createdProjectRequest: null,
    avatarSequence: 0,
    styleSequence: 0,
  };
}

const voiceoverRegistrationSchema = z
  .object({
    asset_id: z.string().regex(VERIFIED_FIXTURE_VOICEOVER_HANDLE),
    checksum: z.string().regex(SHA256),
    filename: z.string().regex(VOICEOVER_FILENAME),
    duration_seconds: z.number().min(10).max(3_600),
    sample_rate: z.number().int().min(8_000).max(192_000),
    channels: z.union([z.literal(1), z.literal(2)]),
  })
  .strict();

const avatarProfileMetadataSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    thumbnail_url: z.string().regex(AVATAR_FIXTURE_PATH),
    source_dimensions: z
      .object({
        width: z.number().int().min(512).max(16_384),
        height: z.number().int().min(512).max(16_384),
      })
      .strict(),
    profile_hash: z.string().regex(SHA256),
    preparation_profile: z.string().trim().min(1).max(120),
    validation_profile: z.string().trim().min(1).max(120),
    compatibility: z.enum(["UNTESTED", "RUNNING", "PASSED", "FAILED", "CANCELLED", "STALE"]),
    lifecycle: z.literal("ACTIVE"),
    version_state: z.literal("READY"),
    uploaded_bytes_persisted: z.literal(false),
    attestations: z
      .object({
        image_use_rights: z.literal(true),
        likeness_animation_consent: z.literal(true),
      })
      .strict(),
  })
  .strict();

const imageStyleMetadataSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(500),
    cover_url: z.string().regex(STYLE_FIXTURE_PATH),
    reference_urls: z.array(z.string().regex(STYLE_FIXTURE_PATH)).max(8),
    example_urls: z.array(z.string().regex(STYLE_FIXTURE_PATH)).max(8),
    profile_hash: z.string().regex(SHA256),
    medium: z.string().trim().min(1).max(160),
    lighting: z.string().trim().min(1).max(160),
    color: z.string().trim().min(1).max(160),
    texture: z.string().trim().min(1).max(160),
    retention_summary: z.string().trim().min(1).max(300),
    lifecycle: z.literal("ACTIVE"),
    version_state: z.literal("PUBLISHED"),
    uploaded_bytes_persisted: z.literal(false),
    attestations: z
      .object({
        reference_rights: z.literal(true),
        processing_disclosure_acknowledged: z.literal(true),
      })
      .strict(),
  })
  .strict()
  .refine((value) => value.reference_urls.length + value.example_urls.length > 0, {
    message: "At least one owned same-origin fixture reference or example is required.",
    path: ["example_urls"],
  });

function resolveContextFixture(c: Context): FixtureResolution {
  return fixtureFromRequest(c.req.raw);
}

type ProjectDetailResolution =
  | { ok: true; detail: RuntimeProjectDetail }
  | { ok: false; response: Response };

function enrichProjectSummary(
  scenario: FixtureScenario,
  project: ProjectSummaryResponse,
): RuntimeProjectSummary {
  return {
    ...structuredClone(project),
    revisionId: scenario.snapshot.project?.revisionId ?? "revision_fixture_unknown",
    pins: {
      avatarProfileVersionId: scenario.snapshot.draft.avatarProfileVersionId,
      imageStyleVersionId: scenario.snapshot.draft.imageStyleVersionId,
    },
  };
}

function baseProjectDetail(scenario: FixtureScenario): RuntimeProjectDetail | null {
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

function putRuntimeProject(
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

function projectDetailsForScenario(
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

function resolveProjectDetail(
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

function mergeByVersionId<T extends { versionId: string }>(base: T[], added: T[]): T[] {
  const merged = new Map(base.map((item) => [item.versionId, structuredClone(item)]));
  for (const item of added) merged.set(item.versionId, structuredClone(item));
  return [...merged.values()];
}

function avatarCatalog(
  scenario: FixtureScenario,
  added: AvatarProfileResponse[],
): AvatarProfileResponse[] {
  return mergeByVersionId(scenario.snapshot.avatarHub.profiles.map(toAvatarProfileResponse), added);
}

function imageStyleCatalog(
  scenario: FixtureScenario,
  added: ImageStyleResponse[],
): ImageStyleResponse[] {
  return mergeByVersionId(scenario.snapshot.imageStyles.styles.map(toImageStyleResponse), added);
}

type CreateProjectRequestResolution =
  | { ok: true; data: CreateProjectRequest }
  | { ok: false; response: Response };

function parseJsonBody(
  rawBody: string,
): { ok: true; data: unknown } | { ok: false; response: Response } {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "INVALID_JSON",
          400,
          "Request body is not valid JSON",
          "Send one JSON object as the request body.",
          false,
        ),
      ),
    };
  }
  return { ok: true, data: payload };
}

function readStrictMetadata<T>(
  rawBody: string,
  schema: z.ZodType<T>,
  code: string,
  title: string,
  detail: string,
): { ok: true; data: T } | { ok: false; response: Response } {
  const payload = parseJsonBody(rawBody);
  if (!payload.ok) return payload;
  const result = schema.safeParse(payload.data);
  if (!result.success) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(code, 422, title, detail, false),
        result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        })),
      ),
    };
  }
  return { ok: true, data: result.data };
}

function readCreateProjectRequest(rawBody: string): CreateProjectRequestResolution {
  const payload = parseJsonBody(rawBody);
  if (!payload.ok) return payload;
  const result = createProjectRequestSchema.safeParse(payload.data);
  if (!result.success) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "INVALID_CREATE_PROJECT_REQUEST",
          422,
          "Create Project request is invalid",
          "The request does not satisfy create-project-request/v2.",
          false,
        ),
        result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        })),
      ),
    };
  }
  return { ok: true, data: result.data };
}

function mutationHeadersError(c: Context, requireVersion = false): Response | null {
  const idempotencyKey = c.req.header("idempotency-key")?.trim();
  if (!idempotencyKey) {
    return problemResponse(
      apiProblem(
        "IDEMPOTENCY_KEY_REQUIRED",
        400,
        "Idempotency-Key header is required",
        "Fixture mutations require a stable Idempotency-Key so duplicate clicks remain safe.",
        false,
      ),
    );
  }
  if (requireVersion && !c.req.header("if-match")) {
    return problemResponse(
      apiProblem(
        "IF_MATCH_REQUIRED",
        428,
        "If-Match header is required",
        "This fixture mutation requires the exact current candidate/version token.",
        false,
      ),
    );
  }
  if (requireVersion && c.req.header("if-match") !== FIXTURE_VERSION_TOKEN) {
    return problemResponse(
      apiProblem(
        "REVISION_CONFLICT",
        412,
        "The project version has changed",
        `Send the exact current If-Match token '${FIXTURE_VERSION_TOKEN}' before retrying.`,
        false,
      ),
    );
  }
  return null;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("Value is not valid JSON.");
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}

function normalizedBodyFingerprint(rawBody: string): string {
  try {
    return canonicalJson(JSON.parse(rawBody) as unknown);
  } catch {
    return rawBody;
  }
}

function idempotencyFingerprint(c: Context, rawBody: string): string {
  const url = new URL(c.req.url);
  return [
    c.req.method.toUpperCase(),
    url.pathname,
    url.searchParams.get("fixture") ?? "",
    normalizedBodyFingerprint(rawBody),
  ].join("\n");
}

async function idempotentMutation(
  c: Context,
  ledger: IdempotencyLedger,
  requireVersion: boolean,
  handle: (rawBody: string) => Response | Promise<Response>,
): Promise<Response> {
  const headersError = mutationHeadersError(c, requireVersion);
  if (headersError) return headersError;

  const idempotencyKey = c.req.header("idempotency-key")?.trim();
  if (!idempotencyKey) {
    throw new Error("Idempotency-Key was validated but is unavailable.");
  }
  const rawBody = await c.req.text();
  const fingerprint = idempotencyFingerprint(c, rawBody);
  const existing = ledger.get(idempotencyKey);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      return problemResponse(
        apiProblem(
          "IDEMPOTENCY_KEY_REUSED",
          409,
          "Idempotency key was reused for a different request",
          "Use the original request body to replay this operation or send a new Idempotency-Key.",
          false,
        ),
      );
    }
    if (existing.pending) await existing.pending;
    if (!existing.response) {
      throw new Error("Idempotent mutation completed without a replayable response.");
    }
    const replay = existing.response.clone();
    replay.headers.set("x-videoforge-idempotent-replay", "true");
    return replay;
  }

  const record: IdempotencyRecord = { fingerprint, response: null, pending: null };
  const pending = Promise.resolve()
    .then(() => handle(rawBody))
    .then((response) => {
      record.response = response.clone();
      record.pending = null;
      return response;
    })
    .catch((error: unknown) => {
      ledger.delete(idempotencyKey);
      throw error;
    });
  record.pending = pending;
  ledger.set(idempotencyKey, record);
  return pending;
}

type ProjectMutationRequestResolution =
  | { ok: true; projectId: string }
  | { ok: false; response: Response };

function readProjectMutationRequest(
  rawBody: string,
  pathProjectId: string,
): ProjectMutationRequestResolution {
  const payload = parseJsonBody(rawBody);
  if (!payload.ok) return payload;
  if (
    payload.data === null ||
    typeof payload.data !== "object" ||
    Array.isArray(payload.data) ||
    !("project_id" in payload.data) ||
    typeof payload.data.project_id !== "string" ||
    payload.data.project_id.length === 0 ||
    payload.data.project_id.length > 160
  ) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "INVALID_PROJECT_MUTATION_REQUEST",
          422,
          "Project mutation request is invalid",
          "Send a non-empty project_id matching the project in the route.",
          false,
        ),
      ),
    };
  }
  if (payload.data.project_id !== pathProjectId) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "PROJECT_ID_MISMATCH",
          409,
          "Project ID does not match the route",
          `Body project_id '${payload.data.project_id}' does not match route project '${pathProjectId}'.`,
          false,
        ),
      ),
    };
  }
  return { ok: true, projectId: payload.data.project_id };
}

type FinalApprovalRequestResolution =
  | { ok: true; projectId: string; candidateId: string }
  | { ok: false; response: Response };

function readFinalApprovalRequest(
  rawBody: string,
  pathProjectId: string,
): FinalApprovalRequestResolution {
  const payload = parseJsonBody(rawBody);
  if (!payload.ok) return payload;
  if (
    payload.data === null ||
    typeof payload.data !== "object" ||
    Array.isArray(payload.data) ||
    Object.keys(payload.data).length !== 2 ||
    !("project_id" in payload.data) ||
    !("candidate_id" in payload.data) ||
    typeof payload.data.project_id !== "string" ||
    payload.data.project_id.length === 0 ||
    payload.data.project_id.length > 160 ||
    typeof payload.data.candidate_id !== "string" ||
    payload.data.candidate_id.length === 0 ||
    payload.data.candidate_id.length > 160
  ) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "INVALID_FINAL_APPROVAL_REQUEST",
          422,
          "Final approval request is invalid",
          "Send exactly project_id and the current non-empty candidate_id.",
          false,
        ),
      ),
    };
  }
  if (payload.data.project_id !== pathProjectId) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "PROJECT_ID_MISMATCH",
          409,
          "Project ID does not match the route",
          `Body project_id '${payload.data.project_id}' does not match route project '${pathProjectId}'.`,
          false,
        ),
      ),
    };
  }
  return {
    ok: true,
    projectId: payload.data.project_id,
    candidateId: payload.data.candidate_id,
  };
}

type FallbackApprovalRequestResolution =
  | { ok: true; projectId: string; approvedIncrementUsd: number }
  | { ok: false; response: Response };

function readFallbackApprovalRequest(
  rawBody: string,
  pathProjectId: string,
): FallbackApprovalRequestResolution {
  const projectRequest = readProjectMutationRequest(rawBody, pathProjectId);
  if (!projectRequest.ok) return projectRequest;
  const payload = parseJsonBody(rawBody);
  if (!payload.ok) return payload;
  if (
    payload.data === null ||
    typeof payload.data !== "object" ||
    Array.isArray(payload.data) ||
    Object.keys(payload.data).length !== 2 ||
    !("approved_increment_usd" in payload.data) ||
    payload.data.approved_increment_usd !== FIXTURE_FALLBACK_INCREMENT_USD
  ) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "INVALID_FALLBACK_APPROVAL_AMOUNT",
          422,
          "Fallback approval amount is invalid",
          `Fixture fallback approval requires the exact capped increment of $${FIXTURE_FALLBACK_INCREMENT_USD.toFixed(2)}.`,
          false,
        ),
      ),
    };
  }
  return {
    ok: true,
    projectId: projectRequest.projectId,
    approvedIncrementUsd: FIXTURE_FALLBACK_INCREMENT_USD,
  };
}

type SemanticPreflightResolution =
  | {
      ok: true;
      estimatedCostUsd: number;
    }
  | { ok: false; response: Response };

function semanticProjectPreflight(
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
    ["avatar_repair_profile_id", "avatar_repair"],
    ["avatar_quality_profile_id", "avatar_quality"],
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
            `Choose a tested ${lane.replaceAll("_", " ")} execution profile. Planned GPUs remain unavailable until GATE_GPU_001 passes.`,
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

function scenarioMutationProblemFor(
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

export function createApiApp(
  options: { commit?: string; environment?: "development" | "test" | "production" } = {},
): Hono {
  const app = new Hono();
  const commit = safeCommit(options.commit ?? process.env.VIDEOFORGE_COMMIT);
  const environment = options.environment ?? process.env.NODE_ENV ?? "development";
  const fixtureSessions = new Map<string, FixtureSessionState>();
  const requestFixtureSessions = new WeakMap<
    Request,
    Extract<FixtureSessionResolution, { ok: true }>
  >();

  function resolveFixtureSession(c: Context): FixtureSessionResolution {
    const cached = requestFixtureSessions.get(c.req.raw);
    if (cached) return cached;

    const requestedId = c.req.header(FIXTURE_SESSION_HEADER);
    if (environment === "production" && requestedId !== undefined) {
      return {
        ok: false,
        response: problemResponse(
          apiProblem(
            "FIXTURE_SESSION_NOT_AVAILABLE",
            400,
            "Fixture sessions are unavailable",
            "The fixture-session header is accepted only by development and test servers.",
            false,
          ),
        ),
      };
    }

    const sessionId = requestedId ?? DEFAULT_FIXTURE_SESSION_ID;
    if (
      sessionId.length === 0 ||
      sessionId.length > MAX_FIXTURE_SESSION_ID_LENGTH ||
      !FIXTURE_SESSION_ID.test(sessionId)
    ) {
      return {
        ok: false,
        response: problemResponse(
          apiProblem(
            "INVALID_FIXTURE_SESSION",
            400,
            "Fixture session is invalid",
            `Use 1-${MAX_FIXTURE_SESSION_ID_LENGTH} ASCII letters, numbers, dots, underscores, colons, or hyphens; the first character must be alphanumeric.`,
            false,
          ),
        ),
      };
    }

    let state = fixtureSessions.get(sessionId);
    if (!state) {
      if (fixtureSessions.size >= MAX_FIXTURE_SESSION_NAMESPACES) {
        return {
          ok: false,
          response: problemResponse(
            apiProblem(
              "FIXTURE_SESSION_CAPACITY_EXCEEDED",
              429,
              "Fixture session capacity is full",
              "Restart the local fixture server to clear completed isolated test sessions.",
              true,
            ),
          ),
        };
      }
      state = createFixtureSessionState();
      fixtureSessions.set(sessionId, state);
    }
    const resolution = { ok: true as const, id: sessionId, state };
    requestFixtureSessions.set(c.req.raw, resolution);
    return resolution;
  }

  function fixtureMutation(
    c: Context,
    requireVersion: boolean,
    handle: (rawBody: string, state: FixtureSessionState) => Response | Promise<Response>,
  ): Promise<Response> {
    const session = resolveFixtureSession(c);
    if (!session.ok) return Promise.resolve(session.response);
    return idempotentMutation(c, session.state.idempotencyLedger, requireVersion, (rawBody) =>
      handle(rawBody, session.state),
    );
  }

  function bootstrapResponse(
    scenario: FixtureScenario,
    state: FixtureSessionState,
  ): FixtureBootstrapResponse {
    const response = toBootstrapResponse(scenario);
    if (scenario.snapshot.access.state !== "AUTHORIZED") return response;
    response.projects = projectDetailsForScenario(state.runtimeProjects, scenario).map(
      (detail) => detail.project,
    );
    response.avatars = avatarCatalog(scenario, state.createdAvatars);
    response.styles = imageStyleCatalog(scenario, state.createdStyles);
    if (scenario.id === "happy_generating" && state.createdProjectRequest) {
      const registeredVoiceover = state.registeredVoiceovers.get(
        state.createdProjectRequest.voiceover_asset_id,
      );
      response.draft = {
        ...response.draft,
        title: state.createdProjectRequest.title,
        voiceover: {
          assetId: state.createdProjectRequest.voiceover_asset_id,
          filename: registeredVoiceover?.filename ?? response.draft.voiceover.filename,
          durationSeconds:
            registeredVoiceover?.durationSeconds ?? response.draft.voiceover.durationSeconds,
          uploadState: "VERIFIED",
        },
        avatarProfileVersionId: state.createdProjectRequest.avatar_profile_version_id,
        imageStyleVersionId: state.createdProjectRequest.image_style_version_id,
        optionalScript: state.createdProjectRequest.optional_script ?? null,
        extraPromptKeywords: state.createdProjectRequest.extra_prompt_keywords ?? null,
        applyExtraPromptKeywords: state.createdProjectRequest.apply_extra_prompt_keywords,
        effectiveExtraPromptKeywords: state.createdProjectRequest.apply_extra_prompt_keywords
          ? (state.createdProjectRequest.extra_prompt_keywords ?? null)
          : null,
        generationMode: state.createdProjectRequest.generation_mode,
        spendCapUsd: state.createdProjectRequest.spend_cap_usd,
      };
    }
    return response;
  }

  app.use("/api/*", async (c, next) => {
    if (environment === "production") {
      return problemResponse(
        apiProblem(
          "API_ROUTE_NOT_FOUND",
          404,
          "API route not found",
          "No production API is registered by this local fixture server.",
          false,
        ),
      );
    }
    await next();
  });

  app.use("/api/*", async (c, next) => {
    const session = resolveFixtureSession(c);
    if (!session.ok) return session.response;
    await next();
    c.header("cache-control", "no-store");
    c.header("x-videoforge-provider-mode", "fixture");
    c.header("x-videoforge-synthetic", "true");
    c.header(FIXTURE_SESSION_HEADER, session.id);
  });

  app.use("/api/v1/*", async (c, next) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    if (c.req.path === "/api/v1/bootstrap") {
      await next();
      return;
    }
    if (resolved.scenario.snapshot.access.state !== "AUTHORIZED") {
      return problemResponse(
        apiProblem(
          "WORKSPACE_ACCESS_REQUIRED",
          403,
          "Workspace access is required",
          resolved.scenario.snapshot.access.state === "DENIED"
            ? "This account is not invited to the selected workspace. Try another invited account."
            : "Continue with an invited account before requesting workspace data or actions.",
          false,
        ),
      );
    }
    await next();
  });

  app.get("/api/health", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    return c.json({
      app: "videoforge" as const,
      status: "ok" as const,
      mode: "fixture" as const,
      commit,
      fixture_id: resolved.id,
      synthetic: true as const,
      provider_calls_authorized: false as const,
      authorized_spend_usd: 0 as const,
    });
  });

  if (environment !== "production") {
    app.get("/api/dev/fixtures", (c) =>
      c.json({
        defaultFixtureId: DEFAULT_FIXTURE_SCENARIO_ID,
        count: FIXTURE_SCENARIO_IDS.length,
        fixtures: listFixtureScenarios(),
      }),
    );

    app.get("/api/dev/fixtures/:fixtureId", (c) => {
      const resolved = resolveFixture(c.req.param("fixtureId"));
      if (!resolved.ok) return resolved.response;
      return c.json(resolved.scenario);
    });

    app.post("/api/dev/fixture-session/reset", (c) => {
      const session = resolveFixtureSession(c);
      if (!session.ok) return session.response;
      fixtureSessions.set(session.id, createFixtureSessionState());
      return c.json({ ok: true as const, sessionId: session.id, providerCallsAuthorized: false });
    });
  }

  app.get("/api/v1/bootstrap", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const session = resolveFixtureSession(c);
    if (!session.ok) return session.response;
    return c.json(bootstrapResponse(resolved.scenario, session.state));
  });

  app.get("/api/v1/execution-profiles", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    return c.json(executionProfileCatalog);
  });

  app.get("/api/v1/avatar-profiles", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const session = resolveFixtureSession(c);
    if (!session.ok) return session.response;
    return c.json(avatarCatalog(resolved.scenario, session.state.createdAvatars));
  });

  app.post("/api/v1/avatar-profiles", (c) =>
    fixtureMutation(c, false, (rawBody, state) => {
      const resolved = resolveContextFixture(c);
      if (!resolved.ok) return resolved.response;
      const metadata = readStrictMetadata(
        rawBody,
        avatarProfileMetadataSchema,
        "INVALID_AVATAR_PROFILE_METADATA",
        "Avatar Profile metadata is invalid",
        "Send strict fixture metadata with an owned same-origin thumbnail, a 64-hex hash, and both required attestations.",
      );
      if (!metadata.ok) return metadata.response;
      const duplicate = avatarCatalog(resolved.scenario, state.createdAvatars).some(
        (profile) => profile.name.toLocaleLowerCase() === metadata.data.name.toLocaleLowerCase(),
      );
      if (duplicate) {
        return problemResponse(
          apiProblem(
            "AVATAR_PROFILE_NAME_CONFLICT",
            409,
            "Avatar Profile name is already in use",
            "Choose a unique workspace Avatar Profile name.",
            false,
          ),
        );
      }
      state.avatarSequence += 1;
      const suffix = String(state.avatarSequence).padStart(3, "0");
      const profile: AvatarProfileResponse = {
        id: `avatar_profile_fixture_created_${suffix}`,
        versionId: `avatar_profile_version_fixture_created_${suffix}`,
        name: metadata.data.name,
        initials: metadata.data.name
          .split(/\s+/u)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase() ?? "")
          .join(""),
        version: 1,
        status: "READY",
        compatibility: metadata.data.compatibility,
        dimensions: `${metadata.data.source_dimensions.width}×${metadata.data.source_dimensions.height}`,
        lastUsed: "Never",
        activeVersion: 1,
        selectedVersion: 1,
        warning: "Fixture metadata only; uploaded bytes were not persisted",
        thumbnailUrl: metadata.data.thumbnail_url,
        profileHash: metadata.data.profile_hash,
        preparationProfile: metadata.data.preparation_profile,
        validationProfile: metadata.data.validation_profile,
        rightsStatus: "ATTESTED",
      };
      state.createdAvatars.push(profile);
      return c.json(
        {
          ok: true as const,
          avatarProfile: profile,
          lifecycle: {
            profile: metadata.data.lifecycle,
            version: metadata.data.version_state,
          },
          immutableVersion: true as const,
          uploadedBytesPersisted: false as const,
          providerCallsAuthorized: false as const,
        },
        201,
      );
    }),
  );

  app.get("/api/v1/image-styles", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const session = resolveFixtureSession(c);
    if (!session.ok) return session.response;
    return c.json(imageStyleCatalog(resolved.scenario, session.state.createdStyles));
  });

  app.post("/api/v1/image-styles", (c) =>
    fixtureMutation(c, false, (rawBody, state) => {
      const resolved = resolveContextFixture(c);
      if (!resolved.ok) return resolved.response;
      const metadata = readStrictMetadata(
        rawBody,
        imageStyleMetadataSchema,
        "INVALID_IMAGE_STYLE_METADATA",
        "Image Style metadata is invalid",
        "Send strict published-version metadata with owned same-origin media paths, a 64-hex hash, and both required attestations.",
      );
      if (!metadata.ok) return metadata.response;
      const duplicate = imageStyleCatalog(resolved.scenario, state.createdStyles).some(
        (style) => style.name.toLocaleLowerCase() === metadata.data.name.toLocaleLowerCase(),
      );
      if (duplicate) {
        return problemResponse(
          apiProblem(
            "IMAGE_STYLE_NAME_CONFLICT",
            409,
            "Image Style name is already in use",
            "Choose a unique workspace Image Style name.",
            false,
          ),
        );
      }
      state.styleSequence += 1;
      const suffix = String(state.styleSequence).padStart(3, "0");
      const style: ImageStyleResponse = {
        id: `image_style_fixture_created_${suffix}`,
        versionId: `image_style_version_fixture_created_${suffix}`,
        name: metadata.data.name,
        summary: metadata.data.summary,
        version: 1,
        status: "PUBLISHED",
        referenceCount: metadata.data.reference_urls.length,
        palette: ["#1f3b45", "#b6805e"],
        activeVersion: 1,
        draftVersion: null,
        draftStatus: null,
        warning: "Fixture metadata only; uploaded references were not persisted",
        coverUrl: metadata.data.cover_url,
        referenceUrls: [...metadata.data.reference_urls],
        exampleUrls: [...metadata.data.example_urls],
        profileHash: metadata.data.profile_hash,
        medium: metadata.data.medium,
        lighting: metadata.data.lighting,
        color: metadata.data.color,
        texture: metadata.data.texture,
        rightsStatus: "ATTESTED",
        retentionSummary: metadata.data.retention_summary,
      };
      state.createdStyles.push(style);
      return c.json(
        {
          ok: true as const,
          imageStyle: style,
          lifecycle: {
            style: metadata.data.lifecycle,
            version: metadata.data.version_state,
          },
          immutableVersion: true as const,
          uploadedBytesPersisted: false as const,
          providerCallsAuthorized: false as const,
        },
        201,
      );
    }),
  );

  app.post("/api/v1/voiceovers/register", (c) =>
    fixtureMutation(c, false, (rawBody, state) => {
      const resolved = resolveContextFixture(c);
      if (!resolved.ok) return resolved.response;
      const metadata = readStrictMetadata(
        rawBody,
        voiceoverRegistrationSchema,
        "INVALID_VOICEOVER_REGISTRATION",
        "Voiceover registration is invalid",
        "Send exact browser-validated metadata; no audio bytes belong in this request.",
      );
      if (!metadata.ok) return metadata.response;
      const handleHex = metadata.data.asset_id.slice("fixture_voiceover_sha256_".length);
      if (metadata.data.checksum !== `sha256:${handleHex}`) {
        return problemResponse(
          apiProblem(
            "VOICEOVER_CHECKSUM_MISMATCH",
            422,
            "Voiceover handle does not match its checksum",
            "The fixture asset_id SHA-256 suffix must exactly equal the checksum hex digest.",
            false,
          ),
        );
      }
      const voiceover: RegisteredVoiceover = {
        assetId: metadata.data.asset_id,
        checksum: metadata.data.checksum,
        filename: metadata.data.filename,
        durationSeconds: metadata.data.duration_seconds,
        sampleRate: metadata.data.sample_rate,
        channels: metadata.data.channels,
        verificationState: "VERIFIED",
        persistedBytes: false,
        providerCallsAuthorized: false,
      };
      const existing = state.registeredVoiceovers.get(voiceover.assetId);
      if (existing && canonicalJson(existing) !== canonicalJson(voiceover)) {
        return problemResponse(
          apiProblem(
            "VOICEOVER_REGISTRATION_CONFLICT",
            409,
            "Voiceover handle is already registered differently",
            "A checksum-bound fixture handle is immutable; use a new handle for different metadata.",
            false,
          ),
        );
      }
      state.registeredVoiceovers.set(voiceover.assetId, voiceover);
      return c.json(
        { ok: true as const, voiceover, synthetic: true as const },
        existing ? 200 : 201,
      );
    }),
  );

  app.get("/api/v1/voiceovers/:assetId", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const session = resolveFixtureSession(c);
    if (!session.ok) return session.response;
    const voiceover = session.state.registeredVoiceovers.get(c.req.param("assetId"));
    if (!voiceover) {
      return problemResponse(
        apiProblem(
          "VOICEOVER_ASSET_NOT_FOUND",
          404,
          "Registered voiceover was not found",
          "Register the browser-validated voiceover metadata before requesting its status.",
          false,
        ),
      );
    }
    return c.json(voiceover);
  });

  app.get("/api/v1/projects", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const session = resolveFixtureSession(c);
    if (!session.ok) return session.response;
    return c.json(
      projectDetailsForScenario(session.state.runtimeProjects, resolved.scenario).map(
        (detail) => detail.project,
      ),
    );
  });

  app.get("/api/v1/projects/:projectId", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const session = resolveFixtureSession(c);
    if (!session.ok) return session.response;
    const project = resolveProjectDetail(
      resolved.scenario,
      c.req.param("projectId"),
      session.state.runtimeProjects,
    );
    if (!project.ok) return project.response;
    return c.json(project.detail);
  });

  app.get("/api/v1/projects/:projectId/events", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const session = resolveFixtureSession(c);
    if (!session.ok) return session.response;
    const project = resolveProjectDetail(
      resolved.scenario,
      c.req.param("projectId"),
      session.state.runtimeProjects,
    );
    if (!project.ok) return project.response;
    return c.json(project.detail.events);
  });

  app.get("/api/v1/projects/:projectId/download", async (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const session = resolveFixtureSession(c);
    if (!session.ok) return session.response;
    const project = resolveProjectDetail(
      resolved.scenario,
      c.req.param("projectId"),
      session.state.runtimeProjects,
    );
    if (!project.ok) return project.response;
    if (project.detail.project.review.state !== "APPROVED") {
      return problemResponse(
        apiProblem(
          "PROJECT_DOWNLOAD_NOT_READY",
          409,
          "Fixture preview is not ready",
          "Approve the exact current review candidate before downloading its synthetic preview.",
          false,
        ),
      );
    }
    const preview = await readFile(FIXTURE_PREVIEW_FILE, "utf8");
    c.header("content-type", "image/svg+xml; charset=utf-8");
    c.header("content-disposition", 'attachment; filename="videoforge-fixture-preview.svg"');
    c.header("x-videoforge-artifact-kind", "synthetic-preview");
    return c.body(preview);
  });

  app.get("/api/v1/usage", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    return c.json(toUsageSummaryResponse(resolved.scenario));
  });

  app.post("/api/v1/projects/preflight", (c) =>
    fixtureMutation(c, false, (rawBody, state) => {
      const resolved = resolveContextFixture(c);
      if (!resolved.ok) return resolved.response;
      const request = readCreateProjectRequest(rawBody);
      if (!request.ok) return request.response;
      const preflight = semanticProjectPreflight(
        resolved.scenario,
        request.data,
        state.registeredVoiceovers,
        state.createdAvatars,
        state.createdStyles,
      );
      if (!preflight.ok) return preflight.response;
      const scenarioProblem = scenarioMutationProblemFor(
        resolved.scenario,
        "PROJECT_PREFLIGHT",
        request.data,
      );
      if (scenarioProblem) return problemResponse(scenarioProblem);
      return c.json({
        ok: true as const,
        status: "READY" as const,
        fixture: resolved.id,
        avatarProfileVersionId: request.data.avatar_profile_version_id,
        imageStyleVersionId: request.data.image_style_version_id,
        estimatedCostUsd: preflight.estimatedCostUsd,
        spendCapUsd: request.data.spend_cap_usd,
        providerCallsAuthorized: false as const,
      });
    }),
  );

  app.post("/api/v1/projects", (c) =>
    fixtureMutation(c, false, (rawBody, state) => {
      const resolved = resolveContextFixture(c);
      if (!resolved.ok) return resolved.response;
      const request = readCreateProjectRequest(rawBody);
      if (!request.ok) return request.response;
      const preflight = semanticProjectPreflight(
        resolved.scenario,
        request.data,
        state.registeredVoiceovers,
        state.createdAvatars,
        state.createdStyles,
      );
      if (!preflight.ok) return preflight.response;
      const scenarioProblem = scenarioMutationProblemFor(
        resolved.scenario,
        "PROJECT_CREATE",
        request.data,
      );
      if (scenarioProblem) return problemResponse(scenarioProblem);
      const generating = resolveFixture("happy_generating");
      if (!generating.ok) return generating.response;
      const created = baseProjectDetail(generating.scenario);
      if (!created) {
        return problemResponse(
          apiProblem(
            "FIXTURE_PROJECT_TEMPLATE_MISSING",
            500,
            "Fixture project template is unavailable",
            "The happy-generating fixture must contain one project template.",
            false,
          ),
        );
      }
      created.project = {
        ...created.project,
        title: request.data.title,
        mode: request.data.generation_mode,
        estimatedCost: preflight.estimatedCostUsd,
        capUsd: request.data.spend_cap_usd,
        pins: {
          avatarProfileVersionId: request.data.avatar_profile_version_id,
          imageStyleVersionId: request.data.image_style_version_id,
        },
      };
      created.events = [
        {
          id: "event_fixture_created_001",
          detail: "Revision created from the submitted immutable preset pins",
          at: "2026-08-09T09:20:00.000Z",
        },
        ...created.events.filter((event) => event.id !== "event_fixture_001"),
      ];
      putRuntimeProject(state.runtimeProjects, "happy_generating", created);
      state.createdProjectRequest = structuredClone(request.data);
      return c.json(
        {
          ok: true as const,
          id: created.project.id,
          revisionId: created.project.revisionId,
          status: "QUEUED" as const,
          fixture: resolved.id,
          nextFixture: "happy_generating" as const,
          pins: {
            avatarProfileVersionId: request.data.avatar_profile_version_id,
            imageStyleVersionId: request.data.image_style_version_id,
          },
          providerCallsAuthorized: false as const,
        },
        202,
      );
    }),
  );

  app.post("/api/v1/projects/:projectId/cancel", (c) =>
    fixtureMutation(c, true, (rawBody, state) => {
      const pathProjectId = c.req.param("projectId");
      const mutationRequest = readProjectMutationRequest(rawBody, pathProjectId);
      if (!mutationRequest.ok) return mutationRequest.response;
      const resolved = resolveContextFixture(c);
      if (!resolved.ok) return resolved.response;
      const project = resolveProjectDetail(resolved.scenario, pathProjectId, state.runtimeProjects);
      if (!project.ok) return project.response;
      if (project.detail.project.status === "APPROVED") {
        return problemResponse(
          apiProblem(
            "PROJECT_ALREADY_APPROVED",
            409,
            "Approved project cannot be cancelled",
            "Archive the approved project instead of cancelling its immutable revision.",
            false,
          ),
        );
      }
      if (project.detail.project.status === "CANCEL_REQUESTED") {
        return problemResponse(
          apiProblem(
            "PROJECT_CANCEL_ALREADY_REQUESTED",
            409,
            "Cancellation is already settling",
            "Wait for the existing cancellation request to reach a terminal state.",
            false,
          ),
        );
      }
      const cancellableStatuses: ReadonlySet<string> = new Set([
        "QUEUED",
        "RUNNING",
        "NEEDS_ATTENTION",
        "RECONCILING",
      ]);
      if (!cancellableStatuses.has(project.detail.project.status)) {
        return problemResponse(
          apiProblem(
            "PROJECT_CANCEL_NOT_ALLOWED",
            409,
            "Project cannot be cancelled in its current state",
            "Only queued, running, attention-required, or reconciling work can be cancelled.",
            false,
          ),
        );
      }
      const cancelled = structuredClone(project.detail);
      cancelled.project.status = "CANCEL_REQUESTED";
      cancelled.project.stage = "CANCEL_REQUESTED";
      cancelled.project.eta = "Calculating";
      cancelled.project.queuePosition = null;
      cancelled.project.allowedActions = [];
      cancelled.project.lanes.image = {
        ...cancelled.project.lanes.image,
        state: "CANCEL_REQUESTED",
        action: "Stopping after the current safe checkpoint",
      };
      cancelled.project.lanes.avatar = {
        ...cancelled.project.lanes.avatar,
        state: "CANCEL_REQUESTED",
        action: "Cancellation signal acknowledged",
      };
      cancelled.project.stages = cancelled.project.stages?.map((stage) =>
        ["RUNNING", "RETRYING", "STARTING", "QUEUED"].includes(stage.status)
          ? { ...stage, status: "CANCEL_REQUESTED", detail: "Cancellation is settling" }
          : stage,
      );
      cancelled.notice = {
        tone: "WARNING",
        title: "Cancellation requested",
        detail: "Workers are settling; accepted fixture artifacts remain recorded.",
        action: null,
        scope: "PROJECT",
      };
      cancelled.events.push({
        id: `event_fixture_cancel_${cancelled.events.length + 1}`,
        detail: "Cancellation requested once; conflicting actions are disabled",
        at: "2026-08-09T09:32:00.000Z",
      });
      putRuntimeProject(state.runtimeProjects, resolved.id, cancelled);
      return c.json(
        {
          ok: true as const,
          id: project.detail.project.id,
          status: "CANCEL_REQUESTED" as const,
        },
        202,
      );
    }),
  );

  app.post("/api/v1/projects/:projectId/retry", (c) =>
    fixtureMutation(c, true, (rawBody, state) => {
      const pathProjectId = c.req.param("projectId");
      const mutationRequest = readProjectMutationRequest(rawBody, pathProjectId);
      if (!mutationRequest.ok) return mutationRequest.response;
      const resolved = resolveContextFixture(c);
      if (!resolved.ok) return resolved.response;
      const project = resolveProjectDetail(resolved.scenario, pathProjectId, state.runtimeProjects);
      if (!project.ok) return project.response;
      if (
        project.detail.project.status === "APPROVED" ||
        project.detail.project.status === "CANCEL_REQUESTED" ||
        !project.detail.project.allowedActions.includes("RETRY_FAILED_ITEMS")
      ) {
        return problemResponse(
          apiProblem(
            "PROJECT_RETRY_NOT_ALLOWED",
            409,
            "Project cannot be retried in its current state",
            "Approved or cancellation-pending projects cannot dispatch another attempt.",
            false,
          ),
        );
      }
      const retryableScenarios: readonly string[] = ["image_partial_failure", "avatar_lip_failure"];
      if (!retryableScenarios.includes(resolved.id)) {
        return problemResponse(
          apiProblem(
            "PROJECT_RETRY_NOT_ALLOWED",
            409,
            "Project has no retryable failed items",
            "Retry only an explicitly failed item set; reconciliation and active work must not be dispatched twice.",
            false,
          ),
        );
      }
      const retrying = structuredClone(project.detail);
      const imageRetry = resolved.id === "image_partial_failure";
      retrying.project.status = "RUNNING";
      retrying.project.stage = imageRetry ? "IMAGE_RETRY" : "AVATAR_REPAIR";
      retrying.project.eta = "10 min";
      retrying.project.queuePosition = null;
      retrying.project.allowedActions = imageRetry ? ["CANCEL"] : ["CANCEL", "REVIEW"];
      const lane = imageRetry ? retrying.project.lanes.image : retrying.project.lanes.avatar;
      lane.state = "RETRYING";
      lane.action = imageRetry
        ? "Retrying failed image chunk; accepted images remain checkpointed"
        : "MuseTalk repair queued for the flagged lip-sync clip";
      const generationStage = retrying.project.stages?.find((stage) => stage.id === "generation");
      if (generationStage) {
        generationStage.status = "RETRYING";
        generationStage.detail = imageRetry
          ? "Failed image chunk retry accepted"
          : "Targeted lip repair accepted";
      }
      if (!imageRetry) retrying.project.review.state = "CHANGES_REQUESTED";
      retrying.notice = {
        tone: "INFO",
        title: imageRetry ? "Image retry queued" : "Lip repair queued",
        detail: imageRetry
          ? "Accepted images remain checkpointed; only the failed chunk is being retried."
          : "Only the flagged clip is being repaired; accepted avatar work remains unchanged.",
        action: null,
        scope: "PROJECT",
      };
      retrying.events.push({
        id: `event_fixture_retry_${retrying.events.length + 1}`,
        detail: imageRetry
          ? "Failed image chunk retry accepted once"
          : "Targeted lip-sync repair accepted once",
        at: "2026-08-09T09:34:00.000Z",
      });
      putRuntimeProject(state.runtimeProjects, resolved.id, retrying);
      return c.json(
        {
          ok: true as const,
          id: project.detail.project.id,
          status: "RETRY_REQUESTED" as const,
          retryScope:
            resolved.id === "image_partial_failure"
              ? (["scene_fixture_014", "scene_fixture_015"] as const)
              : (["avatar_span_fixture_018"] as const),
          nextCheckSeconds: 10,
        },
        202,
      );
    }),
  );

  app.post("/api/v1/projects/:projectId/fallback-approval", (c) =>
    fixtureMutation(c, true, (rawBody, state) => {
      const pathProjectId = c.req.param("projectId");
      const approvalRequest = readFallbackApprovalRequest(rawBody, pathProjectId);
      if (!approvalRequest.ok) return approvalRequest.response;
      const resolved = resolveContextFixture(c);
      if (!resolved.ok) return resolved.response;
      const project = resolveProjectDetail(resolved.scenario, pathProjectId, state.runtimeProjects);
      if (!project.ok) return project.response;
      if (
        resolved.id !== "skyreels_approval_required" ||
        project.detail.project.status !== "NEEDS_ATTENTION" ||
        project.detail.project.review.flaggedDefect !== "WHOLE_FRAME" ||
        !project.detail.project.allowedActions.includes("APPROVE_FALLBACK")
      ) {
        return problemResponse(
          apiProblem(
            "FALLBACK_APPROVAL_NOT_ALLOWED",
            409,
            "Fallback approval is not available",
            "Approve fallback spend only for the current whole-frame defect awaiting explicit approval.",
            false,
          ),
        );
      }
      const estimatedTotalUsd = Number(
        (project.detail.project.estimatedCost + approvalRequest.approvedIncrementUsd).toFixed(2),
      );
      if (estimatedTotalUsd > project.detail.project.capUsd) {
        return problemResponse(
          apiProblem(
            "BUDGET_CAP_EXCEEDED",
            409,
            "Fallback would exceed the project spend cap",
            `The $${approvalRequest.approvedIncrementUsd.toFixed(2)} fallback would raise the fixture estimate to $${estimatedTotalUsd.toFixed(2)}, above the $${project.detail.project.capUsd.toFixed(2)} cap.`,
            false,
          ),
        );
      }
      const fallback = structuredClone(project.detail);
      fallback.project.status = "RUNNING";
      fallback.project.stage = "AVATAR_FALLBACK";
      fallback.project.estimatedCost = estimatedTotalUsd;
      fallback.project.eta = "10 min";
      fallback.project.queuePosition = null;
      fallback.project.lanes.avatar.state = "STARTING";
      fallback.project.lanes.avatar.action =
        "Synthetic SkyReels fallback reserved; provider dispatch remains disabled";
      fallback.project.review.state = "CHANGES_REQUESTED";
      fallback.project.allowedActions = ["CANCEL", "REVIEW"];
      const generationStage = fallback.project.stages?.find((stage) => stage.id === "generation");
      if (generationStage) {
        generationStage.status = "STARTING";
        generationStage.detail = "Whole-frame fallback reservation accepted";
      }
      fallback.notice = {
        tone: "INFO",
        title: "Fallback reservation recorded",
        detail:
          "The fixture estimate now includes $0.18; no provider call or external spend was made.",
        action: null,
        scope: "PROJECT",
      };
      fallback.events.push({
        id: `event_fixture_fallback_${fallback.events.length + 1}`,
        detail: "Whole-frame fallback reservation approved once for $0.18",
        at: "2026-08-09T09:35:00.000Z",
      });
      putRuntimeProject(state.runtimeProjects, resolved.id, fallback);
      return c.json(
        {
          ok: true as const,
          id: project.detail.project.id,
          status: "FALLBACK_APPROVED" as const,
          approvedIncrementUsd: approvalRequest.approvedIncrementUsd,
          estimatedTotalUsd,
          spendCapUsd: project.detail.project.capUsd,
          providerCallsAuthorized: false as const,
        },
        202,
      );
    }),
  );

  app.post("/api/v1/projects/:projectId/approve", (c) =>
    fixtureMutation(c, true, (rawBody, state) => {
      const pathProjectId = c.req.param("projectId");
      const approvalRequest = readFinalApprovalRequest(rawBody, pathProjectId);
      if (!approvalRequest.ok) return approvalRequest.response;
      const resolved = resolveContextFixture(c);
      if (!resolved.ok) return resolved.response;
      const project = resolveProjectDetail(resolved.scenario, pathProjectId, state.runtimeProjects);
      if (!project.ok) return project.response;
      if (project.detail.project.status === "APPROVED") {
        return problemResponse(
          apiProblem(
            "PROJECT_ALREADY_APPROVED",
            409,
            "Project is already approved",
            "The approved fixture revision and its selected candidate are immutable.",
            false,
          ),
        );
      }
      if (
        project.detail.project.status !== "READY_FOR_REVIEW" ||
        project.detail.project.review.state !== "READY_FOR_REVIEW" ||
        project.detail.project.review.candidateId === null
      ) {
        return problemResponse(
          apiProblem(
            "PROJECT_NOT_READY_FOR_APPROVAL",
            409,
            "Project is not ready for approval",
            "A technically valid review candidate must exist before explicit approval.",
            false,
          ),
        );
      }
      if (approvalRequest.candidateId !== project.detail.project.review.candidateId) {
        return problemResponse(
          apiProblem(
            "REVIEW_CANDIDATE_CONFLICT",
            409,
            "Review candidate has changed",
            `Approve the exact current candidate '${project.detail.project.review.candidateId}'.`,
            false,
          ),
        );
      }
      const approved = structuredClone(project.detail);
      approved.project.status = "APPROVED";
      approved.project.stage = "APPROVED";
      approved.project.completed = 100;
      approved.project.eta = "Ready";
      approved.project.queuePosition = null;
      approved.project.review = {
        ...approved.project.review,
        candidateId: approvalRequest.candidateId,
        state: "APPROVED",
        flaggedDefect: null,
        downloadUrl: `/api/v1/projects/${encodeURIComponent(pathProjectId)}/download?fixture=${encodeURIComponent(resolved.id)}`,
      };
      approved.project.allowedActions = ["REVIEW", "DOWNLOAD"];
      approved.project.latestArtifact = approved.project.latestArtifact
        ? {
            ...approved.project.latestArtifact,
            kind: "IMAGE",
            url: "/fixtures/media/watermelon-market.svg",
            label: "Approved synthetic contact sheet",
          }
        : null;
      approved.notice = {
        tone: "SUCCESS",
        title: "Final revision approved",
        detail:
          "The selected candidate is immutable. A synthetic preview is available; real MP4 rendering remains in Phase 0C.",
        action: "Download fixture preview",
        scope: "PROJECT",
      };
      approved.events.push({
        id: `event_fixture_approval_${approved.events.length + 1}`,
        detail: `Candidate ${approvalRequest.candidateId} approved`,
        at: "2026-08-09T09:36:00.000Z",
      });
      putRuntimeProject(state.runtimeProjects, resolved.id, approved);
      return c.json({
        ok: true as const,
        id: approved.project.id,
        status: "APPROVED" as const,
        candidateId: approvalRequest.candidateId,
        downloadUrl: approved.project.review.downloadUrl,
      });
    }),
  );

  app.notFound(() =>
    problemResponse(
      apiProblem(
        "API_ROUTE_NOT_FOUND",
        404,
        "API route not found",
        "The requested fixture API route does not exist.",
        false,
      ),
    ),
  );

  app.onError((error) => {
    console.error(
      "VideoForge fixture API error",
      error instanceof Error ? error.message : "unknown error",
    );
    return problemResponse(
      apiProblem(
        "FIXTURE_API_INTERNAL_ERROR",
        500,
        "Fixture API failed",
        "The local synthetic API encountered an unexpected error.",
        true,
      ),
    );
  });

  return app;
}
