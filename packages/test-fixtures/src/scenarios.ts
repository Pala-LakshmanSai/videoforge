import {
  FIXTURE_SCENARIO_IDS,
  type FixtureAvatarProfile,
  type FixtureImageStyle,
  type FixtureProblem,
  type FixtureScenario,
  type FixtureScenarioId,
  type FixtureScenarioSummary,
  type FixtureSnapshot,
} from "./types";

export const DEFAULT_FIXTURE_SCENARIO_ID: FixtureScenarioId = "happy_generating";

const FIXED_TIME = "2026-08-09T09:30:00.000Z";

const readyAvatar: FixtureAvatarProfile = {
  id: "avatar_profile_fixture_001",
  versionId: "avatar_profile_version_fixture_001",
  displayName: "Amish Farm Host",
  thumbnailUrl: "/fixtures/avatar/amish-farm-host.svg",
  lifecycle: "ACTIVE",
  versionState: "READY",
  compatibility: "PASSED",
  activeVersion: 1,
  selectedVersion: 1,
  sourceDimensions: "1024x1024",
  warning: null,
};

const documentaryStyle: FixtureImageStyle = {
  id: "style_documentary_stock",
  versionId: "style_version_documentary_stock_v1",
  name: "Authentic Documentary Stock",
  summary: "Believable observational photography with natural texture and light.",
  coverUrl: "/fixtures/styles/documentary-stock.svg",
  referenceUrls: [],
  exampleUrls: [
    "/fixtures/styles/documentary-field.svg",
    "/fixtures/styles/documentary-market.svg",
    "/fixtures/styles/documentary-workshop.svg",
  ],
  lifecycle: "ACTIVE",
  versionState: "PUBLISHED",
  activeVersion: 1,
  draftVersion: null,
  isDefault: true,
  referenceCount: 0,
  warning: null,
};

const customStyle: FixtureImageStyle = {
  id: "style_warm_rural",
  versionId: "style_version_warm_rural_v1",
  name: "Warm Rural Documentary",
  summary: "Natural afternoon light, tactile materials, restrained warm color.",
  coverUrl: "/fixtures/styles/warm-rural.svg",
  referenceUrls: [
    "/fixtures/styles/rural-field.svg",
    "/fixtures/styles/rural-hands.svg",
    "/fixtures/styles/rural-kitchen.svg",
    "/fixtures/styles/rural-market.svg",
  ],
  exampleUrls: [],
  lifecycle: "ACTIVE",
  versionState: "PUBLISHED",
  activeVersion: 1,
  draftVersion: null,
  isDefault: false,
  referenceCount: 4,
  warning: null,
};

function baseSnapshot(): FixtureSnapshot {
  return {
    development: {
      providerMode: "fixture",
      synthetic: true,
      apiHealth: "healthy",
      commit: "fixture-uncommitted",
    },
    session: {
      userId: "user_fixture_lakshman",
      displayName: "Lakshman",
      role: "ADMIN",
      workspaceId: "workspace_fixture_001",
      workspaceName: "VideoForge Studio",
    },
    access: {
      state: "AUTHORIZED",
      selectedAccount: {
        displayName: "Lakshman",
        email: "lakshman.fixture@example.invalid",
      },
      workspaceName: "VideoForge Studio",
      adminContact: "admin.fixture@example.invalid",
      reason: null,
    },
    navigation: {
      activeRoute: "/projects/project_fixture_001",
      sidebarCollapsed: false,
    },
    draft: {
      title: "How to Recognize a Sweet Watermelon",
      voiceover: {
        assetId: "asset_voiceover_example",
        filename: "watermelon-voiceover.wav",
        durationSeconds: 94.4,
        uploadState: "VERIFIED",
      },
      avatarProfileVersionId: readyAvatar.versionId,
      imageStyleVersionId: documentaryStyle.versionId,
      optionalScript: null,
      extraPromptKeywords: "ultra realistic, no AI look",
      applyExtraPromptKeywords: false,
      effectiveExtraPromptKeywords: null,
      generationMode: "BALANCED",
      spendCapUsd: 1.5,
      preservedAcrossPresetRoundtrip: false,
      returnRoute: null,
      preflight: {
        status: "READY",
        checks: [
          { id: "voiceover", label: "Voiceover", state: "PASS", message: "94 seconds, verified" },
          { id: "avatar", label: "Avatar", state: "PASS", message: "Amish Farm Host v1 pinned" },
          {
            id: "style",
            label: "Image style",
            state: "PASS",
            message: "Authentic Documentary Stock v1 pinned",
          },
          { id: "keywords", label: "Extra keywords", state: "PASS", message: "Not applied" },
          {
            id: "budget",
            label: "Spend cap",
            state: "PASS",
            message: "$1.50 cap covers fixture estimate",
          },
        ],
      },
    },
    avatarHub: {
      profiles: [{ ...readyAvatar }],
      activeOperation: null,
    },
    imageStyles: {
      styles: [{ ...documentaryStyle }, { ...customStyle }],
      activeOperation: null,
    },
    project: {
      id: "project_fixture_001",
      revisionId: "revision_fixture_001",
      ownerName: "Lakshman",
      title: "How to Recognize a Sweet Watermelon",
      status: "RUNNING",
      stage: "GENERATING_MEDIA",
      progressPercent: 62,
      etaSeconds: 544,
      queuePosition: null,
      cost: {
        estimatedUsd: 0.88,
        currentUsd: 0.41,
        capUsd: 1.5,
      },
      lanes: {
        image: { state: "RUNNING", completed: 184, total: 260, action: "Mage: image 185/260" },
        avatar: { state: "RUNNING", completed: 48, total: 52, action: "AvatarForcing: clip 49/52" },
      },
      stages: [
        { id: "ingest", label: "Prepare", state: "COMPLETE", detail: "Voiceover verified" },
        {
          id: "timing",
          label: "Transcribe",
          state: "COMPLETE",
          detail: "Word timing complete",
        },
        {
          id: "timeline",
          label: "Plan",
          state: "COMPLETE",
          detail: "Deterministic plan locked",
        },
        {
          id: "prompts",
          label: "Write image prompts",
          state: "COMPLETE",
          detail: "260 fixture prompts ready",
        },
        {
          id: "generation",
          label: "Generate media",
          state: "RUNNING",
          detail: "Parallel fixture lanes",
        },
        {
          id: "assembly",
          label: "Assemble",
          state: "PENDING",
          detail: "Waiting for asset barrier",
        },
        { id: "qa", label: "Technical check", state: "PENDING", detail: "Not started" },
        { id: "ready", label: "Review", state: "PENDING", detail: "Not started" },
      ],
      latestArtifact: {
        kind: "IMAGE",
        url: "/fixtures/media/watermelon-market.svg",
        label: "Image 184: market inspection",
      },
      review: {
        candidateId: null,
        state: "NOT_READY",
        flaggedDefect: null,
        selectedAvatarClipId: null,
        downloadUrl: null,
      },
    },
    events: [
      {
        id: "event_fixture_001",
        sequence: 1,
        occurredAt: "2026-08-09T09:20:00.000Z",
        kind: "REVISION_CREATED",
        message: "Revision created from pinned presets",
        stage: "INGEST",
      },
      {
        id: "event_fixture_002",
        sequence: 2,
        occurredAt: "2026-08-09T09:23:00.000Z",
        kind: "TIMELINE_LOCKED",
        message: "Deterministic timeline plan locked",
        stage: "TIMELINE",
      },
      {
        id: "event_fixture_003",
        sequence: 3,
        occurredAt: FIXED_TIME,
        kind: "MEDIA_PROGRESS",
        message: "Image and avatar lanes are running",
        stage: "GENERATING_MEDIA",
      },
    ],
    usage: {
      projectUsd: 0.41,
      oneTimeStyleUsd: 0,
      oneTimeAvatarTestUsd: 0.04,
      imageGpuSeconds: 326,
      avatarGpuSeconds: 781,
    },
    notice: null,
    mutationProblem: null,
  };
}

function problem(
  code: string,
  status: number,
  title: string,
  detail: string,
  retryable: boolean,
  action?: string,
): FixtureProblem {
  return {
    type: `https://videoforge.local/problems/${code.toLowerCase().replaceAll("_", "-")}`,
    title,
    status,
    code,
    detail,
    retryable,
    ...(action === undefined ? {} : { action }),
  };
}

function blockPreflight(snapshot: FixtureSnapshot, checkId: string, message: string): void {
  snapshot.draft.preflight.status = "BLOCKED";
  const check = snapshot.draft.preflight.checks.find((item) => item.id === checkId);
  if (check) {
    check.state = "BLOCK";
    check.message = message;
  }
}

function clearConsoleData(snapshot: FixtureSnapshot): void {
  snapshot.project = null;
  snapshot.events = [];
  snapshot.avatarHub = { profiles: [], activeOperation: null };
  snapshot.imageStyles = { styles: [], activeOperation: null };
  snapshot.usage = {
    projectUsd: 0,
    oneTimeStyleUsd: 0,
    oneTimeAvatarTestUsd: 0,
    imageGpuSeconds: 0,
    avatarGpuSeconds: 0,
  };
  snapshot.draft = {
    title: "",
    voiceover: {
      assetId: null,
      filename: null,
      durationSeconds: null,
      uploadState: "EMPTY",
    },
    avatarProfileVersionId: null,
    imageStyleVersionId: "",
    optionalScript: null,
    extraPromptKeywords: null,
    applyExtraPromptKeywords: false,
    effectiveExtraPromptKeywords: null,
    generationMode: "BALANCED",
    spendCapUsd: 1.5,
    preservedAcrossPresetRoundtrip: false,
    returnRoute: null,
    preflight: {
      status: "BLOCKED",
      checks: [
        {
          id: "access",
          label: "Workspace access",
          state: "BLOCK",
          message: "Sign in with an invited account",
        },
      ],
    },
  };
  snapshot.mutationProblem = null;
}

function createScenario(
  id: FixtureScenarioId,
  label: string,
  description: string,
  route: string,
  tags: readonly string[],
  mutate: (snapshot: FixtureSnapshot) => void,
): FixtureScenario {
  const snapshot = baseSnapshot();
  snapshot.navigation.activeRoute = route;
  mutate(snapshot);
  return { id, label, description, route: `${route}?fixture=${id}`, tags, snapshot };
}

const scenarios = {
  invite_sign_in: createScenario(
    "invite_sign_in",
    "Invite-only sign in",
    "A synthetic invited account can enter the fixture console without contacting Google.",
    "/",
    ["access", "sign-in", "synthetic"],
    (snapshot) => {
      clearConsoleData(snapshot);
      snapshot.access = {
        state: "SIGN_IN_REQUIRED",
        selectedAccount: {
          displayName: "Lakshman (fixture)",
          email: "lakshman.fixture@example.invalid",
        },
        workspaceName: "VideoForge Studio",
        adminContact: "admin.fixture@example.invalid",
        reason: null,
      };
      snapshot.session.userId = "user_fixture_signed_out";
      snapshot.session.displayName = "Lakshman (fixture)";
      snapshot.draft.preflight.checks[0]!.message = "Continue with the invited fixture account";
      snapshot.notice = null;
    },
  ),
  invite_access_denied: createScenario(
    "invite_access_denied",
    "Invite required",
    "An uninvited synthetic account is blocked before any workspace console data is returned.",
    "/",
    ["access", "denied", "blocked"],
    (snapshot) => {
      clearConsoleData(snapshot);
      snapshot.access = {
        state: "DENIED",
        selectedAccount: {
          displayName: "Guest account (fixture)",
          email: "guest.fixture@example.invalid",
        },
        workspaceName: "VideoForge Studio",
        adminContact: "admin.fixture@example.invalid",
        reason: "This account has not been invited to this workspace.",
      };
      snapshot.session.userId = "user_fixture_uninvited";
      snapshot.session.displayName = "Guest account (fixture)";
      snapshot.session.role = "MEMBER";
      snapshot.draft.preflight.checks[0]!.message = "Ask a workspace admin for an invite";
      snapshot.notice = {
        tone: "ERROR",
        title: "Workspace invite required",
        detail: "This account is not on the VideoForge Studio invite list.",
        action: "Try another account",
      };
    },
  ),
  happy_generating: createScenario(
    "happy_generating",
    "Happy path: generating",
    "Both fixture media lanes are making healthy progress.",
    "/projects/project_fixture_001",
    ["project", "progress", "success"],
    () => undefined,
  ),
  project_create_ready: createScenario(
    "project_create_ready",
    "Create project: ready",
    "All required inputs are pinned and preflight is ready.",
    "/projects/new",
    ["create", "preflight", "success"],
    (snapshot) => {
      snapshot.project = null;
      snapshot.events = [];
      snapshot.usage.projectUsd = 0;
    },
  ),
  avatar_hub_empty: createScenario(
    "avatar_hub_empty",
    "Avatar Hub: empty",
    "No ready Avatar Profile exists; project creation is blocked with a clear next action.",
    "/avatars",
    ["avatar", "empty", "blocked"],
    (snapshot) => {
      snapshot.project = null;
      snapshot.avatarHub.profiles = [];
      snapshot.draft.avatarProfileVersionId = null;
      blockPreflight(snapshot, "avatar", "Create your first avatar before generating");
      snapshot.notice = {
        tone: "INFO",
        title: "Create your first avatar",
        detail: "Store and approve one reusable presenter in the Avatar Hub.",
        action: "New avatar",
      };
      snapshot.mutationProblem = problem(
        "AVATAR_PROFILE_REQUIRED",
        422,
        "A ready Avatar Profile is required",
        "Create and select a ready Avatar Profile; inline project avatar uploads are not accepted.",
        false,
        "Open Avatar Hub",
      );
    },
  ),
  avatar_profile_uploading: createScenario(
    "avatar_profile_uploading",
    "Avatar profile: uploading",
    "A reusable avatar source is uploading and duplicate submission is disabled.",
    "/avatars/new",
    ["avatar", "uploading", "pending"],
    (snapshot) => {
      snapshot.project = null;
      snapshot.avatarHub.profiles = [
        {
          ...readyAvatar,
          versionState: "UPLOADING",
          compatibility: "UNTESTED",
          warning: "Upload 72% complete",
        },
      ];
      snapshot.avatarHub.activeOperation = "Uploading source: 72%";
      snapshot.draft.avatarProfileVersionId = null;
      blockPreflight(snapshot, "avatar", "Avatar source upload has not completed");
      snapshot.mutationProblem = problem(
        "AVATAR_PROFILE_NOT_READY",
        409,
        "Avatar is still uploading",
        "Wait for source validation and explicit approval before selecting this version.",
        true,
      );
    },
  ),
  avatar_profile_invalid: createScenario(
    "avatar_profile_invalid",
    "Avatar profile: invalid source",
    "Source validation rejects an undersized or off-center avatar image.",
    "/avatars",
    ["avatar", "validation", "error"],
    (snapshot) => {
      snapshot.project = null;
      snapshot.avatarHub.profiles = [
        {
          ...readyAvatar,
          versionState: "INVALID",
          compatibility: "UNTESTED",
          sourceDimensions: "420x420",
          warning: "Source is too small and horizontally off-center",
        },
      ];
      snapshot.draft.avatarProfileVersionId = null;
      blockPreflight(snapshot, "avatar", "Replace the invalid avatar source");
      snapshot.notice = {
        tone: "ERROR",
        title: "Source needs replacement",
        detail: "Upload a larger, centered source. VideoForge does not apply an invisible crop.",
        action: "Replace source",
      };
      snapshot.mutationProblem = problem(
        "AVATAR_SOURCE_INVALID",
        422,
        "Avatar source failed validation",
        "The selected source does not meet the required dimensions and centering rules.",
        false,
        "Replace source",
      );
    },
  ),
  avatar_profile_ready: createScenario(
    "avatar_profile_ready",
    "Avatar profile: ready",
    "A named reusable Avatar Profile version is ready and selectable.",
    "/avatars",
    ["avatar", "ready", "success"],
    (snapshot) => {
      snapshot.project = null;
      snapshot.notice = {
        tone: "SUCCESS",
        title: "Amish Farm Host is ready",
        detail: "Version 1 can be selected without uploading it again inside a project.",
        action: "Use in a project",
      };
    },
  ),
  avatar_profile_archived_during_draft: createScenario(
    "avatar_profile_archived_during_draft",
    "Selected avatar archived",
    "The exact selected version was archived before revision creation.",
    "/projects/new",
    ["avatar", "versioning", "blocked"],
    (snapshot) => {
      snapshot.project = null;
      snapshot.avatarHub.profiles = [
        { ...readyAvatar, lifecycle: "ARCHIVED", warning: "Archived after this draft selected v1" },
      ];
      blockPreflight(
        snapshot,
        "avatar",
        "Selected avatar version is archived; choose another ready version",
      );
      snapshot.mutationProblem = problem(
        "AVATAR_PROFILE_ARCHIVED",
        409,
        "Selected avatar is archived",
        "Preflight cannot create a new revision from an archived Avatar Profile version.",
        false,
        "Choose another avatar",
      );
    },
  ),
  avatar_profile_newer_version_available: createScenario(
    "avatar_profile_newer_version_available",
    "Newer avatar version available",
    "The draft remains pinned to v1 while an active v2 is available.",
    "/projects/new",
    ["avatar", "versioning", "warning"],
    (snapshot) => {
      snapshot.project = null;
      snapshot.avatarHub.profiles = [
        {
          ...readyAvatar,
          activeVersion: 2,
          selectedVersion: 1,
          warning: "Newer version v2 available; this draft remains pinned to v1",
        },
      ];
      const check = snapshot.draft.preflight.checks.find((item) => item.id === "avatar");
      if (check) {
        check.state = "WARN";
        check.message = "Amish Farm Host v1 pinned; v2 is available";
      }
    },
  ),
  avatar_test_cancelled: createScenario(
    "avatar_test_cancelled",
    "Avatar compatibility test cancelled",
    "Optional compatibility evidence was cancelled without blocking a structurally ready profile.",
    "/avatars",
    ["avatar", "test", "warning"],
    (snapshot) => {
      snapshot.project = null;
      snapshot.avatarHub.profiles = [
        {
          ...readyAvatar,
          compatibility: "CANCELLED",
          warning: "Optional compatibility test cancelled",
        },
      ];
      snapshot.notice = {
        tone: "WARNING",
        title: "Optional test cancelled",
        detail: "The source remains ready. You may retry the separately estimated test.",
        action: "Retry test",
      };
    },
  ),
  style_analyzing: createScenario(
    "style_analyzing",
    "Image style: analyzing",
    "A consented custom style analysis is asynchronous and resumable.",
    "/styles",
    ["style", "analysis", "pending"],
    (snapshot) => {
      snapshot.project = null;
      snapshot.imageStyles.styles = [
        { ...documentaryStyle },
        {
          ...customStyle,
          versionState: "ANALYZING",
          activeVersion: 0,
          draftVersion: 1,
          warning: "Analyzing 4 references",
        },
      ];
      snapshot.imageStyles.activeOperation = "Analyzing reference traits: 6/14";
    },
  ),
  style_v2_analyzing_v1_active: createScenario(
    "style_v2_analyzing_v1_active",
    "Style v2 analyzing, v1 active",
    "Published v1 remains available while a v2 draft is analyzed.",
    "/styles",
    ["style", "versioning", "pending"],
    (snapshot) => {
      snapshot.project = null;
      snapshot.imageStyles.styles = [
        { ...documentaryStyle },
        {
          ...customStyle,
          versionState: "ANALYZING",
          activeVersion: 1,
          draftVersion: 2,
          warning: "Draft v2 analyzing; published v1 remains selectable",
        },
      ];
      snapshot.imageStyles.activeOperation = "Analyzing draft v2";
    },
  ),
  style_needs_review: createScenario(
    "style_needs_review",
    "Image style: needs review",
    "Analyzer output exposes confidence, support, and outliers before publication.",
    "/styles",
    ["style", "analysis", "review"],
    (snapshot) => {
      snapshot.project = null;
      snapshot.imageStyles.styles = [
        { ...documentaryStyle },
        {
          ...customStyle,
          versionState: "NEEDS_REVIEW",
          activeVersion: 0,
          draftVersion: 1,
          warning: "2 uncertain traits; 1 outlier",
        },
      ];
      snapshot.notice = {
        tone: "WARNING",
        title: "Review extracted traits",
        detail: "Lighting and imperfection confidence are low; reference 04 is an outlier.",
        action: "Review analysis",
      };
    },
  ),
  style_analysis_failed: createScenario(
    "style_analysis_failed",
    "Image style: analysis failed",
    "A provider failure is visible, retryable, and never auto-publishes.",
    "/styles",
    ["style", "analysis", "error"],
    (snapshot) => {
      snapshot.project = null;
      snapshot.imageStyles.styles = [
        { ...documentaryStyle },
        {
          ...customStyle,
          versionState: "FAILED",
          activeVersion: 0,
          draftVersion: 1,
          warning: "Retryable fixture timeout",
        },
      ];
      snapshot.notice = {
        tone: "ERROR",
        title: "Style analysis did not finish",
        detail: "No style was published and the accepted references remain available for retry.",
        action: "Retry analysis",
      };
      snapshot.mutationProblem = problem(
        "STYLE_ANALYSIS_FAILED",
        502,
        "Style analysis failed",
        "The deterministic fixture represents a retryable provider timeout.",
        true,
        "Retry analysis",
      );
    },
  ),
  extra_keywords_not_applied: createScenario(
    "extra_keywords_not_applied",
    "Extra keywords: not applied",
    "Retained keyword text is inert while the explicit toggle is off.",
    "/projects/new",
    ["create", "keywords", "success"],
    (snapshot) => {
      snapshot.project = null;
      snapshot.draft.extraPromptKeywords = "hand-painted captions and a logo";
      snapshot.draft.applyExtraPromptKeywords = false;
      snapshot.draft.effectiveExtraPromptKeywords = null;
      const check = snapshot.draft.preflight.checks.find((item) => item.id === "keywords");
      if (check) check.message = "Not applied; retained text is not validated or submitted";
    },
  ),
  extra_keywords_conflict: createScenario(
    "extra_keywords_conflict",
    "Extra keywords: hard-rule conflict",
    "Enabled keywords requesting a logo are blocked with plain feedback.",
    "/projects/new",
    ["create", "keywords", "blocked"],
    (snapshot) => {
      snapshot.project = null;
      snapshot.draft.extraPromptKeywords = "add a logo and title text";
      snapshot.draft.applyExtraPromptKeywords = true;
      snapshot.draft.effectiveExtraPromptKeywords = null;
      blockPreflight(
        snapshot,
        "keywords",
        "Remove logo/title requests; output text and graphics are prohibited",
      );
      snapshot.mutationProblem = problem(
        "EXTRA_KEYWORDS_FORBIDDEN_OUTPUT",
        422,
        "Extra keywords conflict with output rules",
        "Enabled keywords cannot request logos, captions, title text, or decorative graphics.",
        false,
        "Edit extra keywords",
      );
    },
  ),
  preset_roundtrip_draft_preserved: createScenario(
    "preset_roundtrip_draft_preserved",
    "Preset round trip preserves draft",
    "Returning from a preset Hub retains the complete project draft and verified upload handle.",
    "/projects/new",
    ["create", "draft", "success"],
    (snapshot) => {
      snapshot.project = null;
      snapshot.draft.preservedAcrossPresetRoundtrip = true;
      snapshot.draft.returnRoute = "/projects/new";
      snapshot.draft.imageStyleVersionId = customStyle.versionId;
      snapshot.notice = {
        tone: "SUCCESS",
        title: "Draft restored",
        detail:
          "Title, verified voiceover, avatar, style, script, keywords, mode, cap, and seed were preserved.",
        action: null,
      };
    },
  ),
  gpu_cold_start: createScenario(
    "gpu_cold_start",
    "GPU cold start",
    "The project reports the concrete endpoint/container/model loading action.",
    "/projects/project_fixture_001",
    ["project", "gpu", "pending"],
    (snapshot) => {
      if (!snapshot.project) return;
      snapshot.project.stage = "GPU_COLD_START";
      snapshot.project.progressPercent = 18;
      snapshot.project.etaSeconds = 948;
      snapshot.project.lanes.image = {
        state: "STARTING",
        completed: 0,
        total: 260,
        action: "Mage endpoint: container starting",
      };
      snapshot.project.lanes.avatar = {
        state: "STARTING",
        completed: 0,
        total: 52,
        action: "AvatarForcing endpoint: model loading",
      };
      const generation = snapshot.project.stages.find((stage) => stage.id === "generation");
      if (generation) {
        generation.state = "STARTING";
        generation.detail = "Scale-to-zero workers are starting";
      }
    },
  ),
  image_partial_failure: createScenario(
    "image_partial_failure",
    "Image lane partial failure",
    "Completed image items remain checkpointed while one bounded chunk is retryable.",
    "/projects/project_fixture_001",
    ["project", "image", "error"],
    (snapshot) => {
      if (!snapshot.project) return;
      snapshot.project.status = "NEEDS_ATTENTION";
      snapshot.project.stage = "IMAGE_PARTIAL_FAILURE";
      snapshot.project.lanes.image = {
        state: "FAILED",
        completed: 181,
        total: 260,
        action: "Chunk 8 failed; 181 images retained",
      };
      snapshot.project.lanes.avatar = {
        state: "COMPLETE",
        completed: 52,
        total: 52,
        action: "Avatar lane complete",
      };
      snapshot.notice = {
        tone: "ERROR",
        title: "One image chunk needs retry",
        detail: "181 accepted images remain checkpointed; retry starts from the failed chunk.",
        action: "Retry failed chunk",
      };
      snapshot.mutationProblem = problem(
        "IMAGE_CHUNK_FAILED",
        503,
        "Image generation partially failed",
        "Accepted items are retained and the failed chunk can be retried idempotently.",
        true,
        "Retry failed chunk",
      );
    },
  ),
  avatar_lip_failure: createScenario(
    "avatar_lip_failure",
    "Avatar lip-only defect",
    "A reviewer-classified lip-sync-only defect offers the targeted MuseTalk repair path.",
    "/projects/project_fixture_001/review",
    ["project", "avatar", "review"],
    (snapshot) => {
      if (!snapshot.project) return;
      snapshot.project.status = "NEEDS_ATTENTION";
      snapshot.project.stage = "AVATAR_REVIEW";
      snapshot.project.progressPercent = 78;
      snapshot.project.lanes.avatar = {
        state: "BLOCKED",
        completed: 51,
        total: 52,
        action: "Clip 18 flagged: lip sync only",
      };
      snapshot.project.review.flaggedDefect = "LIP_SYNC_ONLY";
      snapshot.project.review.selectedAvatarClipId = "avatar_clip_fixture_018";
      snapshot.notice = {
        tone: "WARNING",
        title: "Lip-only repair available",
        detail:
          "The background, identity, and motion were accepted; only clip 18 lips were flagged.",
        action: "Estimate MuseTalk repair",
      };
    },
  ),
  skyreels_approval_required: createScenario(
    "skyreels_approval_required",
    "SkyReels approval required",
    "A whole-frame defect requires explicit fallback spend approval.",
    "/projects/project_fixture_001/review",
    ["project", "avatar", "budget", "blocked"],
    (snapshot) => {
      if (!snapshot.project) return;
      snapshot.project.status = "NEEDS_ATTENTION";
      snapshot.project.stage = "FALLBACK_APPROVAL";
      snapshot.project.lanes.avatar = {
        state: "BLOCKED",
        completed: 51,
        total: 52,
        action: "Whole-frame fallback awaiting approval",
      };
      snapshot.project.review.flaggedDefect = "WHOLE_FRAME";
      snapshot.project.review.selectedAvatarClipId = "avatar_clip_fixture_018";
      snapshot.notice = {
        tone: "WARNING",
        title: "Approve whole-frame fallback",
        detail: "SkyReels would use the same pinned canonical source and add an estimated $0.18.",
        action: "Review cost and approve",
      };
      snapshot.mutationProblem = problem(
        "FALLBACK_APPROVAL_REQUIRED",
        409,
        "Fallback approval required",
        "The costly whole-frame fallback cannot start until its reservation is approved.",
        false,
        "Approve fallback budget",
      );
    },
  ),
  budget_blocked: createScenario(
    "budget_blocked",
    "Project budget blocked",
    "Preflight truthfully blocks a project whose estimate exceeds its configured cap.",
    "/projects/new",
    ["create", "budget", "blocked"],
    (snapshot) => {
      snapshot.project = null;
      snapshot.draft.spendCapUsd = 0.5;
      blockPreflight(snapshot, "budget", "$0.88 estimate exceeds the $0.50 cap");
      snapshot.notice = {
        tone: "ERROR",
        title: "Spend cap is too low",
        detail: "Raise the cap or choose a lower-cost execution mode before generating.",
        action: "Review estimate",
      };
      snapshot.mutationProblem = problem(
        "BUDGET_CAP_EXCEEDED",
        409,
        "Project is blocked by its spend cap",
        "The fixture estimate is $0.88 and the configured cap is $0.50.",
        false,
        "Adjust spend cap",
      );
    },
  ),
  dispatch_ack_unknown: createScenario(
    "dispatch_ack_unknown",
    "Dispatch acknowledgement unknown",
    "An ambiguous provider acknowledgement enters reconciliation without blind redispatch.",
    "/projects/project_fixture_001",
    ["project", "dispatch", "reconciling"],
    (snapshot) => {
      if (!snapshot.project) return;
      snapshot.project.status = "RECONCILING";
      snapshot.project.stage = "DISPATCH_ACK_UNKNOWN";
      snapshot.project.progressPercent = 24;
      snapshot.project.lanes.image = {
        state: "BLOCKED",
        completed: 0,
        total: 260,
        action: "Checking provider job identity before retry",
      };
      snapshot.notice = {
        tone: "WARNING",
        title: "Confirming whether dispatch started",
        detail:
          "VideoForge will reconcile the provider job before deciding whether another dispatch is safe.",
        action: null,
      };
    },
  ),
  callback_reconciling: createScenario(
    "callback_reconciling",
    "Callback reconciliation",
    "A missing callback is reconciled from persisted provider and attempt identity.",
    "/projects/project_fixture_001",
    ["project", "callback", "reconciling"],
    (snapshot) => {
      if (!snapshot.project) return;
      snapshot.project.status = "RECONCILING";
      snapshot.project.stage = "CALLBACK_RECONCILING";
      snapshot.project.progressPercent = 71;
      snapshot.project.lanes.image = {
        state: "BLOCKED",
        completed: 218,
        total: 260,
        action: "Reconciling missing callback for chunk 9",
      };
      snapshot.notice = {
        tone: "INFO",
        title: "Reconnecting to image lane",
        detail:
          "Persisted uploads and job identity are being checked; accepted work will not be duplicated.",
        action: null,
      };
    },
  ),
  cancel_requested: createScenario(
    "cancel_requested",
    "Cancellation requested",
    "The command is disabled after one request while durable cancellation settles.",
    "/projects/project_fixture_001",
    ["project", "cancel", "pending"],
    (snapshot) => {
      if (!snapshot.project) return;
      snapshot.project.status = "CANCEL_REQUESTED";
      snapshot.project.stage = "CANCEL_REQUESTED";
      snapshot.project.lanes.image.state = "CANCEL_REQUESTED";
      snapshot.project.lanes.image.action = "Stopping after current safe checkpoint";
      snapshot.project.lanes.avatar.state = "CANCEL_REQUESTED";
      snapshot.project.lanes.avatar.action = "Cancellation signal acknowledged";
      snapshot.notice = {
        tone: "WARNING",
        title: "Cancellation requested",
        detail: "Workers are settling and already accepted artifacts remain recorded.",
        action: null,
      };
    },
  ),
  project_ready_for_review: createScenario(
    "project_ready_for_review",
    "Project ready for review",
    "Technical QA passed, but creative approval still requires an explicit human action.",
    "/projects/project_fixture_001/review",
    ["project", "review", "success"],
    (snapshot) => {
      if (!snapshot.project) return;
      snapshot.project.status = "READY_FOR_REVIEW";
      snapshot.project.stage = "READY_FOR_REVIEW";
      snapshot.project.progressPercent = 100;
      snapshot.project.etaSeconds = 0;
      snapshot.project.lanes.image = {
        state: "COMPLETE",
        completed: 260,
        total: 260,
        action: "Image lane complete",
      };
      snapshot.project.lanes.avatar = {
        state: "COMPLETE",
        completed: 52,
        total: 52,
        action: "Avatar lane complete",
      };
      for (const stage of snapshot.project.stages) stage.state = "COMPLETE";
      snapshot.project.latestArtifact = {
        kind: "VIDEO",
        url: "/fixtures/media/final-review-candidate.mp4",
        label: "1080p30 review candidate",
      };
      snapshot.project.review = {
        candidateId: "review_candidate_fixture_001",
        state: "READY_FOR_REVIEW",
        flaggedDefect: null,
        selectedAvatarClipId: "avatar_clip_fixture_018",
        downloadUrl: null,
      };
      snapshot.notice = {
        tone: "SUCCESS",
        title: "Ready for review",
        detail:
          "Technical QA passed. Review the video and contact sheet before approving the final revision.",
        action: "Review candidate",
      };
    },
  ),
  project_approved: createScenario(
    "project_approved",
    "Project approved",
    "A reviewer-approved immutable revision exposes its fixture download and manifest.",
    "/projects/project_fixture_001/review",
    ["project", "approved", "success"],
    (snapshot) => {
      if (!snapshot.project) return;
      snapshot.project.status = "APPROVED";
      snapshot.project.stage = "APPROVED";
      snapshot.project.progressPercent = 100;
      snapshot.project.etaSeconds = 0;
      snapshot.project.cost.currentUsd = 0.86;
      snapshot.project.lanes.image = {
        state: "COMPLETE",
        completed: 260,
        total: 260,
        action: "Image lane complete",
      };
      snapshot.project.lanes.avatar = {
        state: "COMPLETE",
        completed: 52,
        total: 52,
        action: "Avatar lane complete",
      };
      for (const stage of snapshot.project.stages) stage.state = "COMPLETE";
      snapshot.project.latestArtifact = {
        kind: "VIDEO",
        url: "/fixtures/media/final-approved.mp4",
        label: "Approved 1080p30 video",
      };
      snapshot.project.review = {
        candidateId: "review_candidate_fixture_001",
        state: "APPROVED",
        flaggedDefect: null,
        selectedAvatarClipId: "avatar_clip_fixture_018",
        downloadUrl: "/api/v1/projects/project_fixture_001/download?fixture=project_approved",
      };
      snapshot.usage.projectUsd = 0.86;
      snapshot.notice = {
        tone: "SUCCESS",
        title: "Final revision approved",
        detail: "The immutable fixture manifest and video are ready to download.",
        action: "Download video",
      };
    },
  ),
} satisfies Record<FixtureScenarioId, FixtureScenario>;

export const fixtureScenarioRegistry: Readonly<Record<FixtureScenarioId, FixtureScenario>> =
  scenarios;

const fixtureIdSet: ReadonlySet<string> = new Set(FIXTURE_SCENARIO_IDS);

export function isFixtureScenarioId(value: string): value is FixtureScenarioId {
  return fixtureIdSet.has(value);
}

export function getFixtureScenario(id: FixtureScenarioId): FixtureScenario {
  return structuredClone(fixtureScenarioRegistry[id]);
}

export function listFixtureScenarios(): FixtureScenarioSummary[] {
  return FIXTURE_SCENARIO_IDS.map((id) => {
    const scenario = fixtureScenarioRegistry[id];
    return {
      id: scenario.id,
      label: scenario.label,
      description: scenario.description,
      route: scenario.route,
      tags: scenario.tags,
      projectStatus: scenario.snapshot.project?.status ?? null,
      preflightStatus: scenario.snapshot.draft.preflight.status,
      hasMutationProblem: scenario.snapshot.mutationProblem !== null,
    };
  });
}
