export const FIXTURE_SCENARIO_IDS = [
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
  "budget_blocked",
  "dispatch_ack_unknown",
  "callback_reconciling",
  "cancel_requested",
  "project_failed",
  "project_cancelled",
  "project_ready_for_review",
  "project_approved",
] as const;

export type FixtureScenarioId = (typeof FIXTURE_SCENARIO_IDS)[number];

export type FixtureProjectStatus =
  | "DRAFT"
  | "QUEUED"
  | "RUNNING"
  | "NEEDS_ATTENTION"
  | "RECONCILING"
  | "CANCEL_REQUESTED"
  | "FAILED"
  | "CANCELLED"
  | "READY_FOR_REVIEW"
  | "APPROVED";

export type FixtureStageState =
  | "PENDING"
  | "QUEUED"
  | "STARTING"
  | "RUNNING"
  | "RETRYING"
  | "BLOCKED"
  | "FAILED"
  | "CANCEL_REQUESTED"
  | "CANCELLED"
  | "COMPLETE";

export interface FixtureProblem {
  readonly type: `https://videoforge.local/problems/${string}`;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly retryable: boolean;
  readonly action?: string;
}

export interface FixtureAvatarProfile {
  readonly id: string;
  readonly versionId: string;
  readonly displayName: string;
  readonly thumbnailUrl: string;
  readonly lifecycle: "ACTIVE" | "ARCHIVED";
  readonly versionState: "UPLOADING" | "INVALID" | "NEEDS_REVIEW" | "READY";
  readonly compatibility: "UNTESTED" | "RUNNING" | "PASSED" | "FAILED" | "CANCELLED" | "STALE";
  readonly activeVersion: number;
  readonly selectedVersion: number;
  readonly sourceDimensions: string;
  readonly warning: string | null;
}

export interface FixtureImageStyle {
  readonly id: string;
  readonly versionId: string;
  readonly name: string;
  readonly summary: string;
  readonly coverUrl: string;
  readonly referenceUrls: readonly string[];
  readonly exampleUrls: readonly string[];
  readonly lifecycle: "ACTIVE" | "ARCHIVED";
  readonly versionState: "DRAFT" | "ANALYZING" | "NEEDS_REVIEW" | "PUBLISHED" | "FAILED";
  readonly activeVersion: number;
  readonly draftVersion: number | null;
  readonly isDefault: boolean;
  readonly referenceCount: number;
  readonly warning: string | null;
}

export interface FixtureDraft {
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

export interface FixtureProject {
  id: string;
  revisionId: string;
  ownerName: string;
  title: string;
  status: FixtureProjectStatus;
  stage: string;
  progressPercent: number;
  etaSeconds: number | null;
  queuePosition: number | null;
  cost: {
    estimatedUsd: number;
    currentUsd: number;
    capUsd: number;
  };
  lanes: {
    image: {
      state: FixtureStageState;
      completed: number;
      total: number;
      action: string;
    };
    avatar: {
      state: FixtureStageState;
      completed: number;
      total: number;
      action: string;
    };
  };
  stages: Array<{
    id: string;
    label: string;
    state: FixtureStageState;
    detail: string;
  }>;
  latestArtifact: {
    kind: "IMAGE" | "AVATAR_CLIP" | "VIDEO";
    url: string;
    label: string;
  } | null;
  review: {
    candidateId: string | null;
    candidateSha256: string | null;
    state: "NOT_READY" | "READY_FOR_REVIEW" | "CHANGES_REQUESTED" | "APPROVED";
    flaggedDefect: "LIP_SYNC_ONLY" | "WHOLE_FRAME" | "IMAGE_QUALITY" | null;
    selectedAvatarClipId: string | null;
    downloadUrl: string | null;
  };
}

export interface FixtureEvent {
  readonly id: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly kind: string;
  readonly message: string;
  readonly stage: string;
}

export interface FixtureAccessState {
  readonly state: "AUTHORIZED" | "SIGN_IN_REQUIRED" | "DENIED";
  readonly selectedAccount: {
    readonly displayName: string;
    readonly email: string;
  } | null;
  readonly workspaceName: string;
  readonly adminContact: string;
  readonly reason: string | null;
}

export interface FixtureSnapshot {
  development: {
    providerMode: "fixture";
    synthetic: true;
    apiHealth: "healthy";
    commit: string;
  };
  session: {
    userId: string;
    displayName: string;
    rights: "EQUAL";
    workspaceId: string;
    workspaceName: string;
  };
  access: FixtureAccessState;
  navigation: {
    activeRoute: string;
    sidebarCollapsed: boolean;
  };
  draft: FixtureDraft;
  avatarHub: {
    profiles: FixtureAvatarProfile[];
    activeOperation: string | null;
  };
  imageStyles: {
    styles: FixtureImageStyle[];
    activeOperation: string | null;
  };
  project: FixtureProject | null;
  events: FixtureEvent[];
  usage: {
    projectUsd: number;
    oneTimeStyleUsd: number;
    oneTimeAvatarTestUsd: number;
    imageGpuSeconds: number;
    avatarGpuSeconds: number;
  };
  notice: {
    tone: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
    title: string;
    detail: string;
    action: string | null;
  } | null;
  mutationProblem: FixtureProblem | null;
}

export interface FixtureScenario {
  readonly id: FixtureScenarioId;
  readonly label: string;
  readonly description: string;
  readonly route: string;
  readonly tags: readonly string[];
  readonly snapshot: FixtureSnapshot;
}

export interface FixtureScenarioSummary {
  readonly id: FixtureScenarioId;
  readonly label: string;
  readonly description: string;
  readonly route: string;
  readonly tags: readonly string[];
  readonly projectStatus: FixtureProjectStatus | null;
  readonly preflightStatus: FixtureDraft["preflight"]["status"];
  readonly hasMutationProblem: boolean;
}
