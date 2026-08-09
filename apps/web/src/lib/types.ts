import type { ExecutionProfileCatalog } from "@videoforge/config";

export type { ExecutionProfileCatalog };

export const scenarioIds = [
  "invite_sign_in",
  "invite_access_denied",
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

export interface FixtureAccessState {
  state: "AUTHORIZED" | "SIGN_IN_REQUIRED" | "DENIED";
  selectedAccount: {
    displayName: string;
    email: string;
  } | null;
  workspaceName: string;
  adminContact: string;
  reason: string | null;
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
  activeVersion: number;
  selectedVersion: number;
  warning: string | null;
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
  activeVersion: number;
  draftVersion: number | null;
  draftStatus: "DRAFT" | "ANALYZING" | "NEEDS_REVIEW" | "FAILED" | null;
  warning: string | null;
}

export interface ProjectStage {
  id: string;
  label: string;
  status:
    | "PENDING"
    | "QUEUED"
    | "STARTING"
    | "RUNNING"
    | "RETRYING"
    | "BLOCKED"
    | "FAILED"
    | "CANCEL_REQUESTED"
    | "COMPLETE";
  completed: number;
  total: number;
  detail: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  owner: string;
  status:
    | "DRAFT"
    | "QUEUED"
    | "RUNNING"
    | "NEEDS_ATTENTION"
    | "RECONCILING"
    | "CANCEL_REQUESTED"
    | "READY_FOR_REVIEW"
    | "APPROVED";
  stage: string;
  completed: number;
  total: number;
  eta: string;
  mode: "LOWEST_COST" | "BALANCED" | "FASTER";
  estimatedCost: number;
  actualCost: number;
  queuePosition: number | null;
  createdAt: string;
  stages: ProjectStage[];
  revisionId: string;
  versionToken: string;
  pins: {
    avatarProfileVersionId: string | null;
    imageStyleVersionId: string;
  };
  capUsd: number;
  lanes: {
    image: { state: string; completed: number; total: number; action: string };
    avatar: { state: string; completed: number; total: number; action: string };
  };
  latestArtifact: { kind: "IMAGE" | "AVATAR_CLIP" | "VIDEO"; url: string; label: string } | null;
  review: {
    candidateId: string | null;
    candidateSha256: string | null;
    state: "NOT_READY" | "READY_FOR_REVIEW" | "CHANGES_REQUESTED" | "APPROVED";
    flaggedDefect: "LIP_SYNC_ONLY" | "WHOLE_FRAME" | "IMAGE_QUALITY" | null;
    selectedAvatarClipId: string | null;
    downloadUrl: string | null;
  };
  allowedActions: ProjectAllowedAction[];
}

export type ProjectAllowedAction =
  | "APPROVE"
  | "APPROVE_FALLBACK"
  | "CANCEL"
  | "DOWNLOAD"
  | "RETRY_FAILED_ITEMS"
  | "REVIEW";

export interface FixtureNotice {
  tone: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  title: string;
  detail: string;
  action: string | null;
  scope: "ACCESS" | "AVATAR" | "CREATE" | "PROJECT" | "STYLE";
}

export interface FixtureDraftState {
  title: string;
  voiceover: {
    assetId: string | null;
    filename: string | null;
    durationSeconds: number | null;
    uploadState: "EMPTY" | "UPLOADING" | "VERIFIED" | "FAILED";
  };
  avatarProfileVersionId: string | null;
  imageStyleVersionId: string;
  optionalScript: string | null;
  extraPromptKeywords: string | null;
  applyExtraPromptKeywords: boolean;
  effectiveExtraPromptKeywords: string | null;
  generationMode: "LOWEST_COST" | "BALANCED" | "FASTER";
  spendCapUsd: number;
  preservedAcrossPresetRoundtrip: boolean;
  returnRoute: string | null;
  preflight: {
    status: "PENDING" | "READY" | "BLOCKED";
    checks: Array<{
      id: string;
      label: string;
      state: "PENDING" | "PASS" | "WARN" | "BLOCK";
      message: string;
    }>;
  };
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
  access: FixtureAccessState;
  user: FixtureUser;
  projects: ProjectSummary[];
  avatars: AvatarProfile[];
  styles: ImageStyle[];
  usage: UsageSummary;
  draft: FixtureDraftState;
  notice: FixtureNotice | null;
  activeOperations: { avatar: string | null; style: string | null };
}

export interface ProjectDetail {
  project: ProjectSummary;
  events: Array<{ id: string; detail: string; at: string }>;
  notice: FixtureNotice | null;
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

export interface RegisteredVoiceover {
  assetId: string;
  checksum: string;
  filename: string;
  durationSeconds: number;
  sampleRate: number;
  channels: 1 | 2;
  verificationState: "VERIFIED";
  persistedBytes: false;
  providerCallsAuthorized: false;
}
