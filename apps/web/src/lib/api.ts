import type {
  AvatarProfile,
  FixtureBootstrap,
  HealthResponse,
  ImageStyle,
  ProjectSummary,
  ScenarioId,
  UsageSummary,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as T | { error?: { code?: string; message?: string } };
  if (!response.ok) {
    const error =
      "error" in (payload as object)
        ? (payload as { error?: { code?: string; message?: string } }).error
        : undefined;
    throw new ApiError(
      error?.message ?? "VideoForge request failed",
      error?.code ?? "UNKNOWN",
      response.status,
    );
  }
  return payload as T;
}

function query(scenario: ScenarioId) {
  return `?fixture=${encodeURIComponent(scenario)}`;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  bootstrap: (scenario: ScenarioId) =>
    request<FixtureBootstrap>(`/api/v1/bootstrap${query(scenario)}`),
  projects: (scenario: ScenarioId) =>
    request<ProjectSummary[]>(`/api/v1/projects${query(scenario)}`),
  project: (id: string, scenario: ScenarioId) =>
    request<{ project: ProjectSummary; events: Array<{ id: string; detail: string; at: string }> }>(
      `/api/v1/projects/${encodeURIComponent(id)}${query(scenario)}`,
    ),
  avatars: (scenario: ScenarioId) =>
    request<AvatarProfile[]>(`/api/v1/avatar-profiles${query(scenario)}`),
  styles: (scenario: ScenarioId) => request<ImageStyle[]>(`/api/v1/image-styles${query(scenario)}`),
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
