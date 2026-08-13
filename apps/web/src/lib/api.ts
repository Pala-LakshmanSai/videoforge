import {
  imageStyleEditRequestSchema,
  imageStyleEditResponseSchema,
  type ImageStyleEditRequest,
  type ImageStyleEditResponse,
} from "@videoforge/contracts/image-style-edit";
import {
  imageStyleAnalysisRequestSchema,
  imageStyleDraftCreateRequestSchema,
  imageStyleHubVersionResponseSchema,
  imageStylePublishRequestSchema,
  imageStyleReferenceBatchRequestSchema,
  type ImageStyleDraftCreateRequest,
  type ImageStyleHubVersionResponse,
  type ImageStyleReferenceBatchRequest,
} from "@videoforge/contracts/image-style-hub";

import type {
  AvatarProfile,
  ExecutionProfileCatalog,
  FixtureBootstrap,
  HealthResponse,
  ImageStyle,
  ProjectDetail,
  ProjectSummary,
  ScenarioId,
  TimelineInspection,
  UsageSummary,
  RegisteredVoiceover,
  SharedAppState,
} from "./types";
import {
  parseAvatarsResponse,
  parseBootstrapResponse,
  parseExecutionProfilesResponse,
  parseHealthResponse,
  parseMutationResponse,
  parseProjectResponse,
  parseProjectsResponse,
  parseRegisteredVoiceoverResponse,
  parseStylesResponse,
  parseSharedAppResponse,
  parseTimelineInspectionResponse,
  parseUsageResponse,
} from "./api-schemas";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly action?: string,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ProblemPayload {
  error?: {
    action?: string;
    code?: string;
    detail?: string;
    issues?: unknown;
    message?: string;
    retryable?: boolean;
  };
}

async function request<T>(
  path: string,
  init: RequestInit | undefined,
  parse: (value: unknown) => T,
): Promise<T> {
  const fixtureSession =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("fixtureSession");
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(fixtureSession ? { "x-videoforge-fixture-session": fixtureSession } : {}),
      ...init?.headers,
    },
  });
  const responseText = await response.text();
  let payload: unknown | ProblemPayload | null = null;
  if (responseText) {
    try {
      payload = JSON.parse(responseText) as unknown;
    } catch {
      if (response.ok) throw new Error("VideoForge returned an unreadable response.");
    }
  }
  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as ProblemPayload).error
        : undefined;
    throw new ApiError(
      error?.detail ?? error?.message ?? "VideoForge request failed.",
      error?.code ?? "UNKNOWN",
      response.status,
      error?.retryable ?? false,
      error?.action,
      error?.issues,
    );
  }
  if (payload === null) throw new Error("VideoForge returned an empty response.");
  try {
    return parse(payload);
  } catch {
    throw new Error(`VideoForge returned an invalid response for ${path.split("?")[0]}.`);
  }
}

function query(scenario: ScenarioId) {
  return `?fixture=${encodeURIComponent(scenario)}`;
}

interface MutationOptions<T> {
  idempotencyKey?: string;
  ifMatch?: string;
  parse?: (value: unknown) => T;
}

export interface ImageStyleEditRequestAuthority {
  readonly sessionToken: string;
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly ifMatch: string;
}

export const api = {
  issueFixtureInvite: (email: string) =>
    request<{ code: string; shownOnce: true }>(
      "/api/dev/shared-app/invites",
      { method: "POST", body: JSON.stringify({ email }) },
      (value) => value as { code: string; shownOnce: true },
    ),
  authenticateFixture: (
    body: {
      method: "EMAIL_PASSWORD" | "GOOGLE";
      email: string;
      emailVerified: boolean;
      googleVerifiedEmail?: string;
      inviteCode?: string;
    },
    scenario: ScenarioId,
  ) =>
    request<{ outcome: "ADMITTED" | "RETURNING"; email: string; rights: "EQUAL" }>(
      `/api/v1/shared-app/authenticate${query(scenario)}`,
      { method: "POST", body: JSON.stringify(body) },
      (value) => value as { outcome: "ADMITTED" | "RETURNING"; email: string; rights: "EQUAL" },
    ),
  sharedApp: (scenario: ScenarioId) =>
    request<SharedAppState>(
      `/api/v1/shared-app${query(scenario)}`,
      undefined,
      parseSharedAppResponse,
    ),
  sharedGenerate: (
    body: { projectId: string; title: string; imageReceiptId?: string; avatarReceiptId?: string },
    scenario: ScenarioId,
  ) =>
    request<{ outcome: "STARTED" | "QUEUED"; queueVersion: number }>(
      `/api/v1/shared-app/generate${query(scenario)}`,
      { method: "POST", body: JSON.stringify(body) },
      (value) => value as { outcome: "STARTED" | "QUEUED"; queueVersion: number },
    ),
  reorderSharedQueue: (
    entryId: string,
    toPosition: number,
    queueVersion: number,
    scenario: ScenarioId,
  ) =>
    request<SharedAppState>(
      `/api/v1/shared-app/queue/${encodeURIComponent(entryId)}${query(scenario)}`,
      { method: "PATCH", body: JSON.stringify({ toPosition, queueVersion }) },
      parseSharedAppResponse,
    ),
  removeSharedQueue: (entryId: string, queueVersion: number, scenario: ScenarioId) =>
    request<SharedAppState>(
      `/api/v1/shared-app/queue/${encodeURIComponent(entryId)}?fixture=${encodeURIComponent(scenario)}&queueVersion=${queueVersion}`,
      { method: "DELETE" },
      parseSharedAppResponse,
    ),
  health: (scenario?: ScenarioId) =>
    request<HealthResponse>(
      `/api/health${scenario ? query(scenario) : ""}`,
      undefined,
      parseHealthResponse,
    ),
  bootstrap: (scenario: ScenarioId) =>
    request<FixtureBootstrap>(
      `/api/v1/bootstrap${query(scenario)}`,
      undefined,
      parseBootstrapResponse,
    ),
  projects: (scenario: ScenarioId) =>
    request<ProjectSummary[]>(
      `/api/v1/projects${query(scenario)}`,
      undefined,
      parseProjectsResponse,
    ),
  project: (id: string, scenario: ScenarioId) =>
    request<ProjectDetail>(
      `/api/v1/projects/${encodeURIComponent(id)}${query(scenario)}`,
      undefined,
      parseProjectResponse,
    ),
  timelineInspection: (id: string, scenario: ScenarioId) =>
    request<TimelineInspection>(
      `/api/v1/projects/${encodeURIComponent(id)}/timeline-inspection${query(scenario)}`,
      undefined,
      parseTimelineInspectionResponse,
    ),
  avatars: (scenario: ScenarioId) =>
    request<AvatarProfile[]>(
      `/api/v1/avatar-profiles${query(scenario)}`,
      undefined,
      parseAvatarsResponse,
    ),
  styles: (scenario: ScenarioId) =>
    request<ImageStyle[]>(`/api/v1/image-styles${query(scenario)}`, undefined, parseStylesResponse),
  createImageStyleDraft: (
    body: ImageStyleDraftCreateRequest,
    scenario: ScenarioId,
    idempotencyKey = crypto.randomUUID(),
  ) =>
    request<ImageStyleHubVersionResponse>(
      `/api/v1/image-style-drafts${query(scenario)}`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(imageStyleDraftCreateRequestSchema.parse(body)),
      },
      (value) => imageStyleHubVersionResponseSchema.parse(value),
    ),
  imageStyleDraft: (styleId: string, versionId: string, scenario: ScenarioId) =>
    request<ImageStyleHubVersionResponse>(
      `/api/v1/image-styles/${encodeURIComponent(styleId)}/versions/${encodeURIComponent(versionId)}${query(scenario)}`,
      undefined,
      (value) => imageStyleHubVersionResponseSchema.parse(value),
    ),
  registerImageStyleReferences: (
    styleId: string,
    versionId: string,
    body: ImageStyleReferenceBatchRequest,
    versionTag: string,
    scenario: ScenarioId,
    idempotencyKey = crypto.randomUUID(),
  ) =>
    request<ImageStyleHubVersionResponse>(
      `/api/v1/image-styles/${encodeURIComponent(styleId)}/versions/${encodeURIComponent(versionId)}/references${query(scenario)}`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey, "If-Match": versionTag },
        body: JSON.stringify(imageStyleReferenceBatchRequestSchema.parse(body)),
      },
      (value) => imageStyleHubVersionResponseSchema.parse(value),
    ),
  analyzeImageStyleDraft: (
    styleId: string,
    versionId: string,
    versionTag: string,
    scenario: ScenarioId,
    idempotencyKey = crypto.randomUUID(),
  ) =>
    request<ImageStyleHubVersionResponse>(
      `/api/v1/image-styles/${encodeURIComponent(styleId)}/versions/${encodeURIComponent(versionId)}/analyze${query(scenario)}`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey, "If-Match": versionTag },
        body: JSON.stringify(
          imageStyleAnalysisRequestSchema.parse({
            schema_version: "image-style-analysis-request/v1",
          }),
        ),
      },
      (value) => imageStyleHubVersionResponseSchema.parse(value),
    ),
  editFixtureImageStyleDraft: (
    styleId: string,
    versionId: string,
    body: ImageStyleEditRequest,
    versionTag: string,
    scenario: ScenarioId,
    idempotencyKey = crypto.randomUUID(),
  ) =>
    request<ImageStyleHubVersionResponse>(
      `/api/v1/image-styles/${encodeURIComponent(styleId)}/versions/${encodeURIComponent(versionId)}${query(scenario)}`,
      {
        method: "PATCH",
        headers: { "Idempotency-Key": idempotencyKey, "If-Match": versionTag },
        body: JSON.stringify(imageStyleEditRequestSchema.parse(body)),
      },
      (value) => imageStyleHubVersionResponseSchema.parse(value),
    ),
  publishImageStyleDraft: (
    styleId: string,
    versionId: string,
    versionTag: string,
    scenario: ScenarioId,
    idempotencyKey = crypto.randomUUID(),
  ) =>
    request<ImageStyleHubVersionResponse>(
      `/api/v1/image-styles/${encodeURIComponent(styleId)}/versions/${encodeURIComponent(versionId)}/publish${query(scenario)}`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey, "If-Match": versionTag },
        body: JSON.stringify(
          imageStylePublishRequestSchema.parse({
            schema_version: "image-style-publish-request/v1",
          }),
        ),
      },
      (value) => imageStyleHubVersionResponseSchema.parse(value),
    ),
  archiveImageStyle: (styleId: string, versionId: string, scenario: ScenarioId) =>
    request<{ ok: true; state: "ARCHIVED" }>(
      `/api/v1/image-styles/${encodeURIComponent(styleId)}/archive${query(scenario)}`,
      {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ version_id: versionId }),
      },
      (value) => {
        if (
          !value ||
          typeof value !== "object" ||
          !("ok" in value) ||
          value.ok !== true ||
          !("state" in value) ||
          value.state !== "ARCHIVED"
        ) {
          throw new Error("Invalid Image Style archive response.");
        }
        return { ok: true, state: "ARCHIVED" };
      },
    ),
  executionProfiles: (scenario: ScenarioId) =>
    request<ExecutionProfileCatalog>(
      `/api/v1/execution-profiles${query(scenario)}`,
      undefined,
      parseExecutionProfilesResponse,
    ),
  usage: (scenario: ScenarioId) =>
    request<UsageSummary>(`/api/v1/usage${query(scenario)}`, undefined, parseUsageResponse),
  voiceover: (assetId: string, scenario: ScenarioId) =>
    request<RegisteredVoiceover>(
      `/api/v1/voiceovers/${encodeURIComponent(assetId)}${query(scenario)}`,
      undefined,
      parseRegisteredVoiceoverResponse,
    ),
  editImageStyleProfile: (
    styleId: string,
    versionId: string,
    body: ImageStyleEditRequest,
    authority: ImageStyleEditRequestAuthority,
  ) =>
    request<ImageStyleEditResponse>(
      `/api/v1/image-styles/${encodeURIComponent(styleId)}/versions/${encodeURIComponent(versionId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${authority.sessionToken}`,
          "Idempotency-Key": authority.idempotencyKey,
          "If-Match": authority.ifMatch,
          "X-VideoForge-Workspace-Id": authority.workspaceId,
        },
        body: JSON.stringify(imageStyleEditRequestSchema.parse(body)),
      },
      (value) => imageStyleEditResponseSchema.parse(value),
    ),
  mutate: <T = Record<string, unknown>>(
    path: string,
    body: unknown,
    scenario: ScenarioId,
    options: string | MutationOptions<T> = {},
  ) => {
    const normalizedOptions: MutationOptions<T> =
      typeof options === "string" ? { idempotencyKey: options } : options;
    const headers: Record<string, string> = {
      "Idempotency-Key": normalizedOptions.idempotencyKey ?? crypto.randomUUID(),
    };
    if (normalizedOptions.ifMatch) headers["If-Match"] = normalizedOptions.ifMatch;
    return request<T>(
      `${path}${path.includes("?") ? "&" : "?"}${query(scenario).slice(1)}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
      (value) =>
        normalizedOptions.parse
          ? normalizedOptions.parse(value)
          : (parseMutationResponse(value) as T),
    );
  },
};
