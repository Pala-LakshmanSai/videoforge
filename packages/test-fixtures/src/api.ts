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
  rights: "EQUAL";
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
  thumbnailUrl: string;
  profileHash: string;
  preparationProfile: string;
  validationProfile: string;
  rightsStatus: "ATTESTED";
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
  coverUrl: string;
  referenceUrls: string[];
  exampleUrls: string[];
  profileHash: string;
  medium: string;
  lighting: string;
  color: string;
  texture: string;
  rightsStatus: "ATTESTED" | "SYSTEM_OWNED";
  retentionSummary: string;
}

export interface ProjectStageResponse {
  id: string;
  label: string;
  status: FixtureStageState;
  completed: number;
  total: number;
  detail: string;
}

export interface ProjectSummaryResponse {
  id: string;
  title: string;
  owner: string;
  status: FixtureProject["status"];
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
  capUsd: number;
  lanes: FixtureProject["lanes"];
  latestArtifact: FixtureProject["latestArtifact"];
  review: FixtureProject["review"];
  allowedActions: ProjectAllowedAction[];
}

export type ProjectAllowedAction =
  | "APPROVE"
  | "CANCEL"
  | "DOWNLOAD"
  | "RETRY_FAILED_ITEMS"
  | "REVIEW";

export interface UsageSummaryResponse {
  currentMonth: number;
  projectSpend: number;
  styleSpend: number;
  avatarTestSpend: number;
  storageGb: number;
  gpuSeconds: number;
  retries: number;
}

export interface FixtureNoticeResponse {
  tone: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  title: string;
  detail: string;
  action: string | null;
  scope: "ACCESS" | "AVATAR" | "CREATE" | "PROJECT" | "STYLE";
}

export interface FixtureBootstrapResponse {
  scenario: FixtureScenarioId;
  access: FixtureScenario["snapshot"]["access"];
  user: FixtureUserResponse;
  projects: ProjectSummaryResponse[];
  avatars: AvatarProfileResponse[];
  styles: ImageStyleResponse[];
  usage: UsageSummaryResponse;
  draft: FixtureScenario["snapshot"]["draft"];
  notice: FixtureNoticeResponse | null;
  activeOperations: {
    avatar: string | null;
    style: string | null;
  };
}

export interface FixtureProjectDetailResponse {
  project: ProjectSummaryResponse;
  events: Array<{ id: string; detail: string; at: string }>;
  notice: FixtureNoticeResponse | null;
}

const FIXTURE_CREATED_AT = "2026-08-09T09:20:00.000Z";
const FIXTURE_LAST_USED = "2026-08-09T08:15:00.000Z";

function noticeForScenario(
  scenario: FixtureScenario,
  forcedScope?: FixtureNoticeResponse["scope"],
): FixtureNoticeResponse | null {
  if (!scenario.snapshot.notice) return null;
  const scope =
    forcedScope ??
    (scenario.snapshot.access.state !== "AUTHORIZED"
      ? "ACCESS"
      : scenario.route.startsWith("/avatars")
        ? "AVATAR"
        : scenario.route.startsWith("/styles")
          ? "STYLE"
          : scenario.route === "/projects/new"
            ? "CREATE"
            : "PROJECT");
  return { ...scenario.snapshot.notice, scope };
}

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
    thumbnailUrl: profile.thumbnailUrl,
    profileHash: "sha256:aa4f5236269ba63ae3ffdbd5ce6ed7e1c7c2cd31e93ea42b7f427afcd502d1ea",
    preparationProfile: "avatar-source-prep-v1",
    validationProfile: "avatar-source-validation-v1",
    rightsStatus: "ATTESTED",
  };
}

function styleStatus(style: FixtureImageStyle): ImageStyleResponse["status"] {
  if (style.lifecycle === "ARCHIVED") return "ARCHIVED";
  if (style.activeVersion > 0) return "PUBLISHED";
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
    version: style.activeVersion || style.draftVersion || 1,
    status: styleStatus(style),
    referenceCount: style.referenceCount,
    ...(style.isDefault ? { isDefault: true } : {}),
    palette,
    activeVersion: style.activeVersion,
    draftVersion: style.draftVersion,
    draftStatus:
      style.draftVersion === null || style.versionState === "PUBLISHED" ? null : style.versionState,
    warning: style.warning,
    coverUrl: style.coverUrl,
    referenceUrls: [...style.referenceUrls],
    exampleUrls: [...style.exampleUrls],
    profileHash: style.isDefault
      ? "sha256:a0be214b3a153a9a9641734102a53ed450af0ad99b8ecfb8b0196a7b83cdb0a2"
      : "sha256:fe8f642298a8aa93c18d3df9ee2f614b68f74e9ad0e81ab8fc4a40f15f51b65b",
    medium: style.isDefault ? "Observational documentary still" : "Natural-light rural documentary",
    lighting: style.isDefault
      ? "Available light, restrained contrast"
      : "Warm afternoon side light",
    color: style.isDefault
      ? "Neutral earth, muted blue-green"
      : "Warm earth, muted botanical green",
    texture: "Tactile material detail, restrained sharpening",
    rightsStatus: style.isDefault ? "SYSTEM_OWNED" : "ATTESTED",
    retentionSummary: style.isDefault
      ? "Built-in owned examples"
      : "Private normalized references retained for this published version",
  };
}

function allowedProjectActions(project: FixtureProject): ProjectAllowedAction[] {
  const actions: ProjectAllowedAction[] = [];
  if (["QUEUED", "RUNNING", "NEEDS_ATTENTION", "RECONCILING"].includes(project.status)) {
    actions.push("CANCEL");
  }
  if (
    project.status !== "FAILED" &&
    (project.lanes.image.state === "FAILED" || project.lanes.avatar.state === "FAILED")
  ) {
    actions.push("RETRY_FAILED_ITEMS");
  }
  if (project.review.state !== "NOT_READY" || project.review.flaggedDefect !== null) {
    actions.push("REVIEW");
  }
  if (project.review.state === "READY_FOR_REVIEW") actions.push("APPROVE");
  if (project.review.state === "APPROVED" && project.review.downloadUrl) actions.push("DOWNLOAD");
  return actions;
}

function etaLabel(project: FixtureProject): string {
  if (project.status === "FAILED" || project.status === "CANCELLED") return "Stopped";
  const seconds = project.etaSeconds;
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
    status: project.status,
    stage: project.stage,
    completed: project.progressPercent,
    total: 100,
    eta: etaLabel(project),
    mode,
    estimatedCost: project.cost.estimatedUsd,
    actualCost: project.cost.currentUsd,
    queuePosition: project.queuePosition,
    createdAt: FIXTURE_CREATED_AT,
    stages: project.stages.map((stage) => ({
      id: stage.id,
      label: stage.label,
      status: stage.state,
      completed:
        stage.state === "COMPLETE"
          ? 1
          : stage.state === "PENDING" || stage.state === "QUEUED"
            ? 0
            : 0,
      total: 1,
      detail: stage.detail,
    })),
    capUsd: project.cost.capUsd,
    lanes: project.lanes,
    latestArtifact: project.latestArtifact,
    review: project.review,
    allowedActions: allowedProjectActions(project),
  };
}

export function toUsageSummaryResponse(scenario: FixtureScenario): UsageSummaryResponse {
  if (scenario.snapshot.access.state !== "AUTHORIZED") {
    return {
      currentMonth: 0,
      projectSpend: 0,
      styleSpend: 0,
      avatarTestSpend: 0,
      storageGb: 0,
      gpuSeconds: 0,
      retries: 0,
    };
  }

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
    retries: scenario.id === "image_partial_failure" ? 1 : 0,
  };
}

export function toBootstrapResponse(scenario: FixtureScenario): FixtureBootstrapResponse {
  const selectedAccount = scenario.snapshot.access.selectedAccount;
  return {
    scenario: scenario.id,
    access: structuredClone(scenario.snapshot.access),
    user: {
      id: scenario.snapshot.session.userId,
      name: selectedAccount?.displayName ?? scenario.snapshot.session.displayName,
      email: selectedAccount?.email ?? "signed-out.fixture@example.invalid",
      rights: scenario.snapshot.session.rights,
      invited: scenario.snapshot.access.state !== "DENIED",
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
    draft: structuredClone(scenario.snapshot.draft),
    notice: noticeForScenario(scenario),
    activeOperations: {
      avatar: scenario.snapshot.avatarHub.activeOperation,
      style: scenario.snapshot.imageStyles.activeOperation,
    },
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
    notice: noticeForScenario(scenario, "PROJECT"),
  };
}
