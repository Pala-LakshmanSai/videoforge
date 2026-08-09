export const scenarioIds = [
  "happy_generating",
  "project_create_ready",
  "avatar_hub_empty",
  "avatar_profile_uploading",
  "avatar_profile_invalid",
  "avatar_profile_ready",
  "avatar_profile_archived_during_draft",
  "avatar_profile_newer_version_available",
  "avatar_test_cancelled",
  "style_analyzing",
  "style_v2_analyzing_v1_active",
  "style_needs_review",
  "style_analysis_failed",
  "extra_keywords_not_applied",
  "extra_keywords_conflict",
  "preset_roundtrip_draft_preserved",
  "gpu_cold_start",
  "image_partial_failure",
  "avatar_lip_failure",
  "skyreels_approval_required",
  "budget_blocked",
  "dispatch_ack_unknown",
  "callback_reconciling",
  "cancel_requested",
  "project_ready_for_review",
  "project_approved",
] as const;

export type ScenarioId = (typeof scenarioIds)[number];

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export interface FixtureUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  invited: boolean;
}

export interface AvatarProfile {
  id: string;
  versionId: string;
  name: string;
  initials: string;
  version: number;
  status: "READY" | "VALIDATING" | "NEEDS_REVIEW" | "FAILED" | "ARCHIVED";
  compatibility: "UNTESTED" | "RUNNING" | "PASSED" | "FAILED" | "STALE" | "CANCELLED";
  dimensions: string;
  lastUsed: string;
  thumbnailUrl: string;
  profileHash: string;
  preparationProfile: string;
  validationProfile: string;
  rightsStatus: "ATTESTED";
}

export interface ImageStyle {
  id: string;
  versionId: string;
  name: string;
  summary: string;
  version: number;
  status: "PUBLISHED" | "ANALYZING" | "NEEDS_REVIEW" | "FAILED" | "ARCHIVED";
  referenceCount: number;
  isDefault?: boolean;
  palette: [string, string];
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

export interface ProjectStage {
  id: string;
  label: string;
  status: "QUEUED" | "RUNNING" | "RETRYING" | "BLOCKED" | "FAILED" | "CANCELLED" | "COMPLETE";
  completed: number;
  total: number;
  detail: string;
}

export interface ProjectSummary {
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
  stages?: ProjectStage[];
  capUsd: number;
  lanes: {
    image: { state: string; completed: number; total: number; action: string };
    avatar: { state: string; completed: number; total: number; action: string };
  };
  latestArtifact: { kind: "IMAGE" | "AVATAR_CLIP" | "VIDEO"; url: string; label: string } | null;
  reviewState: "NOT_READY" | "READY_FOR_REVIEW" | "CHANGES_REQUESTED" | "APPROVED";
}

export interface UsageSummary {
  currentMonth: number;
  projectSpend: number;
  styleSpend: number;
  avatarTestSpend: number;
  storageGb: number;
  gpuSeconds: number;
  retries: number;
}

export interface FixtureBootstrap {
  scenario: ScenarioId;
  user: FixtureUser;
  projects: ProjectSummary[];
  avatars: AvatarProfile[];
  styles: ImageStyle[];
  usage: UsageSummary;
}

export interface HealthResponse {
  app: "videoforge";
  status: "ok";
  mode: "fixture";
  commit: string;
  fixture_id: ScenarioId;
  synthetic: true;
  provider_calls_authorized: false;
  authorized_spend_usd: 0;
}
