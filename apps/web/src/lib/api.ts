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
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
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

export const api = {
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
