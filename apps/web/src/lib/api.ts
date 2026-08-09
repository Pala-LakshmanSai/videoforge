import type {
  AvatarProfile,
  ExecutionProfileCatalog,
  FixtureBootstrap,
  HealthResponse,
  ImageStyle,
  ProjectDetail,
  ProjectSummary,
  ScenarioId,
  UsageSummary,
} from "./types";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const responseText = await response.text();
  let payload: T | ProblemPayload | null = null;
  if (responseText) {
    try {
      payload = JSON.parse(responseText) as T | ProblemPayload;
    } catch {
      if (response.ok) throw new Error("VideoForge returned an unreadable response.");
    }
  }
  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload ? payload.error : undefined;
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
  return payload as T;
}

function query(scenario: ScenarioId) {
  return `?fixture=${encodeURIComponent(scenario)}`;
}

export const api = {
  health: (scenario?: ScenarioId) =>
    request<HealthResponse>(`/api/health${scenario ? query(scenario) : ""}`),
  bootstrap: (scenario: ScenarioId) =>
    request<FixtureBootstrap>(`/api/v1/bootstrap${query(scenario)}`),
  projects: (scenario: ScenarioId) =>
    request<ProjectSummary[]>(`/api/v1/projects${query(scenario)}`),
  project: (id: string, scenario: ScenarioId) =>
    request<ProjectDetail>(`/api/v1/projects/${encodeURIComponent(id)}${query(scenario)}`),
  avatars: (scenario: ScenarioId) =>
    request<AvatarProfile[]>(`/api/v1/avatar-profiles${query(scenario)}`),
  styles: (scenario: ScenarioId) => request<ImageStyle[]>(`/api/v1/image-styles${query(scenario)}`),
  executionProfiles: (scenario: ScenarioId) =>
    request<ExecutionProfileCatalog>(`/api/v1/execution-profiles${query(scenario)}`),
  usage: (scenario: ScenarioId) => request<UsageSummary>(`/api/v1/usage${query(scenario)}`),
  mutate: <T>(
    path: string,
    body: unknown,
    scenario: ScenarioId,
    idempotencyKey = crypto.randomUUID(),
  ) =>
    request<T>(`${path}${path.includes("?") ? "&" : "?"}${query(scenario).slice(1)}`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey, "If-Match": "fixture-v1" },
      body: JSON.stringify(body),
    }),
};
