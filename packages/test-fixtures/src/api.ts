import type {
  FixtureAvatarProfile,
  FixtureImageStyle,
  FixtureProject,
  FixtureScenario,
  FixtureScenarioId,
  FixtureStageState,
} from "./types";

export interface FixtureUserResponse {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  invited: boolean;
}

export interface AvatarProfileResponse {
  id: string;
  versionId: string;
  name: string;
  initials: string;
  version: number;
  status: "READY" | "VALIDATING" | "NEEDS_REVIEW" | "FAILED" | "ARCHIVED";
  compatibility: "UNTESTED" | "RUNNING" | "PASSED" | "FAILED" | "STALE" | "CANCELLED";
  dimensions: string;
  lastUsed: string;
  activeVersion: number;
  selectedVersion: number;
  warning: string | null;
}

export interface ImageStyleResponse {
  id: string;
  versionId: string;
  name: string;
  summary: string;
  version: number;
  status: "PUBLISHED" | "ANALYZING" | "NEEDS_REVIEW" | "FAILED" | "ARCHIVED";
  referenceCount: number;
  isDefault?: boolean;
  palette: [string, string];
  activeVersion: number;
  draftVersion: number | null;
  draftStatus: "DRAFT" | "ANALYZING" | "NEEDS_REVIEW" | "FAILED" | null;
  warning: string | null;
}

export interface ProjectStageResponse {
  id: string;
  label: string;
  status: "QUEUED" | "RUNNING" | "RETRYING" | "BLOCKED" | "FAILED" | "CANCELLED" | "COMPLETE";
  completed: number;
  total: number;
  detail: string;
}

export interface ProjectSummaryResponse {
  id: string;
  title: string;
  owner: string;
  status:
    | "QUEUED"
    | "STARTING"
    | "RUNNING"
    | "NEEDS_ATTENTION"
    | "READY_FOR_REVIEW"
    | "APPROVED"
    | "CANCELLED";
  stage: string;
  completed: number;
  total: number;
  eta: string;
  mode: "LOWEST_COST" | "BALANCED" | "FASTER";
  estimatedCost: number;
  actualCost: number;
  queuePosition: number | null;
  createdAt: string;
  stages?: ProjectStageResponse[];
}

export interface UsageSummaryResponse {
  currentMonth: number;
  projectSpend: number;
  styleSpend: number;
  avatarTestSpend: number;
  storageGb: number;
  gpuSeconds: number;
  retries: number;
}

export interface FixtureBootstrapResponse {
  scenario: FixtureScenarioId;
  user: FixtureUserResponse;
  projects: ProjectSummaryResponse[];
  avatars: AvatarProfileResponse[];
  styles: ImageStyleResponse[];
  usage: UsageSummaryResponse;
}

export interface FixtureProjectDetailResponse {
  project: ProjectSummaryResponse;
  events: Array<{ id: string; detail: string; at: string }>;
}

const FIXTURE_CREATED_AT = "2026-08-09T09:20:00.000Z";
const FIXTURE_LAST_USED = "2026-08-09T08:15:00.000Z";

function initials(name: string): string {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function avatarStatus(profile: FixtureAvatarProfile): AvatarProfileResponse["status"] {
  if (profile.lifecycle === "ARCHIVED") return "ARCHIVED";
  if (profile.versionState === "READY") return "READY";
  if (profile.versionState === "NEEDS_REVIEW") return "NEEDS_REVIEW";
  if (profile.versionState === "INVALID") return "FAILED";
  return "VALIDATING";
}

export function toAvatarProfileResponse(profile: FixtureAvatarProfile): AvatarProfileResponse {
  return {
    id: profile.id,
    versionId: profile.versionId,
    name: profile.displayName,
    initials: initials(profile.displayName),
    version: profile.selectedVersion,
    status: avatarStatus(profile),
    compatibility: profile.compatibility,
    dimensions: profile.sourceDimensions,
    lastUsed: FIXTURE_LAST_USED,
    activeVersion: profile.activeVersion,
    selectedVersion: profile.selectedVersion,
    warning: profile.warning,
  };
}

function styleStatus(style: FixtureImageStyle): ImageStyleResponse["status"] {
  if (style.lifecycle === "ARCHIVED") return "ARCHIVED";
  if (style.versionState === "DRAFT") return "NEEDS_REVIEW";
  return style.versionState;
}

export function toImageStyleResponse(style: FixtureImageStyle): ImageStyleResponse {
  const palette: [string, string] = style.isDefault
    ? ["#9A5D3B", "#406B62"]
    : ["#B56F44", "#5C6F55"];
  return {
    id: style.id,
    versionId: style.versionId,
    name: style.name,
    summary: style.summary,
    version: style.draftVersion ?? style.activeVersion,
    status: styleStatus(style),
    referenceCount: style.referenceCount,
    ...(style.isDefault ? { isDefault: true } : {}),
    palette,
    activeVersion: style.activeVersion,
    draftVersion: style.draftVersion,
    draftStatus:
      style.draftVersion === null || style.versionState === "PUBLISHED" ? null : style.versionState,
    warning: style.warning,
  };
}

function projectStatus(project: FixtureProject): ProjectSummaryResponse["status"] {
  switch (project.status) {
    case "DRAFT":
    case "QUEUED":
      return "QUEUED";
    case "RECONCILING":
      return "STARTING";
    case "CANCEL_REQUESTED":
      return "RUNNING";
    case "RUNNING":
    case "NEEDS_ATTENTION":
    case "READY_FOR_REVIEW":
    case "APPROVED":
      return project.status;
  }
}

function stageStatus(state: FixtureStageState): ProjectStageResponse["status"] {
  switch (state) {
    case "PENDING":
    case "STARTING":
      return "QUEUED";
    case "CANCEL_REQUESTED":
      return "CANCELLED";
    case "QUEUED":
    case "RUNNING":
    case "RETRYING":
    case "BLOCKED":
    case "FAILED":
    case "COMPLETE":
      return state;
  }
}

function etaLabel(seconds: number | null): string {
  if (seconds === null) return "Calculating";
  if (seconds === 0) return "Ready";
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} min`;
}

export function toProjectSummaryResponse(
  project: FixtureProject,
  mode: ProjectSummaryResponse["mode"],
): ProjectSummaryResponse {
  return {
    id: project.id,
    title: project.title,
    owner: project.ownerName,
    status: projectStatus(project),
    stage: project.stage,
    completed: project.progressPercent,
    total: 100,
    eta: etaLabel(project.etaSeconds),
    mode,
    estimatedCost: project.cost.estimatedUsd,
    actualCost: project.cost.currentUsd,
    queuePosition: project.queuePosition,
    createdAt: FIXTURE_CREATED_AT,
    stages: project.stages.map((stage) => ({
      id: stage.id,
      label: stage.label,
      status: stageStatus(stage.state),
      completed:
        stage.state === "COMPLETE"
          ? 1
          : stage.state === "PENDING" || stage.state === "QUEUED"
            ? 0
            : 0,
      total: 1,
      detail: stage.detail,
    })),
  };
}

export function toUsageSummaryResponse(scenario: FixtureScenario): UsageSummaryResponse {
  const currentMonth = Number(
    (
      scenario.snapshot.usage.projectUsd +
      scenario.snapshot.usage.oneTimeStyleUsd +
      scenario.snapshot.usage.oneTimeAvatarTestUsd +
      0.12
    ).toFixed(2),
  );
  return {
    currentMonth,
    projectSpend: scenario.snapshot.usage.projectUsd,
    styleSpend: scenario.snapshot.usage.oneTimeStyleUsd,
    avatarTestSpend: scenario.snapshot.usage.oneTimeAvatarTestUsd,
    storageGb: 0.18,
    gpuSeconds: scenario.snapshot.usage.imageGpuSeconds + scenario.snapshot.usage.avatarGpuSeconds,
    retries:
      scenario.id === "image_partial_failure" || scenario.id === "avatar_lip_failure" ? 1 : 0,
  };
}

export function toBootstrapResponse(scenario: FixtureScenario): FixtureBootstrapResponse {
  return {
    scenario: scenario.id,
    user: {
      id: scenario.snapshot.session.userId,
      name: scenario.snapshot.session.displayName,
      email: "lakshman@videoforge.local",
      role: scenario.snapshot.session.role,
      invited: true,
    },
    projects:
      scenario.snapshot.project === null
        ? []
        : [
            toProjectSummaryResponse(
              scenario.snapshot.project,
              scenario.snapshot.draft.generationMode,
            ),
          ],
    avatars: scenario.snapshot.avatarHub.profiles.map(toAvatarProfileResponse),
    styles: scenario.snapshot.imageStyles.styles.map(toImageStyleResponse),
    usage: toUsageSummaryResponse(scenario),
  };
}

export function toProjectDetailResponse(
  scenario: FixtureScenario,
): FixtureProjectDetailResponse | null {
  if (scenario.snapshot.project === null) return null;
  return {
    project: toProjectSummaryResponse(
      scenario.snapshot.project,
      scenario.snapshot.draft.generationMode,
    ),
    events: scenario.snapshot.events.map((event) => ({
      id: event.id,
      detail: event.message,
      at: event.occurredAt,
    })),
  };
}
