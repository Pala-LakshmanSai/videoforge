import {
  getFixtureScenario,
  toBootstrapResponse,
  toUsageSummaryResponse,
  type FixtureBootstrapResponse,
} from "@videoforge/test-fixtures";
import type { Context } from "hono";

import { baseProjectDetail, rotateProjectVersion } from "../domain/project-service";
import type { RuntimeProjectDetail } from "../domain/models";
import { idempotentMutation, type IdempotencyLedger } from "../mutation";
import type {
  LocalOwnedVoiceover,
  LocalPipelineProgress,
  LocalPipelineRunRequest,
  LocalPipelineRunResult,
  LocalSliceRunner,
} from "./types";
import { LOCAL_PROJECT_ID, LOCAL_REVISION_ID } from "./types";

type LocalArtifact = {
  kind: "VIDEO";
  url: string;
  label: string;
  sha256: string;
  bytes: number;
  filename: string;
};

export type LocalProjectDetail = Omit<RuntimeProjectDetail, "project"> & {
  project: Omit<RuntimeProjectDetail["project"], "latestArtifact"> & {
    latestArtifact: LocalArtifact | null;
  };
};

const BASE_SCENARIO_ID = "project_create_ready" as const;
const RUNNING_SCENARIO_ID = "happy_generating" as const;

const STAGE_PROGRESS: Record<LocalPipelineProgress["stage"], number> = {
  TRANSCRIBING: 18,
  SCHEDULING: 36,
  RESOLVING_ASSETS: 52,
  RENDERING: 70,
  PROBING: 90,
};

const STAGE_ID: Record<LocalPipelineProgress["stage"], string> = {
  TRANSCRIBING: "timing",
  SCHEDULING: "timeline",
  RESOLVING_ASSETS: "generation",
  RENDERING: "assembly",
  PROBING: "qa",
};

function scenario(id: typeof BASE_SCENARIO_ID | typeof RUNNING_SCENARIO_ID) {
  const resolved = getFixtureScenario(id);
  if (!resolved) throw new Error(`Required local fixture scenario '${id}' is missing.`);
  return resolved;
}

function nowIso(): string {
  return new Date().toISOString();
}

function nextVersionToken(current: string): string {
  const match = /-v([1-9][0-9]*)"$/u.exec(current);
  if (!match) throw new Error("Local project has an invalid version token.");
  return current.replace(/-v[1-9][0-9]*"$/u, `-v${Number(match[1]) + 1}"`);
}

function localProjectTemplate(title: string): LocalProjectDetail {
  const detail = baseProjectDetail(scenario(RUNNING_SCENARIO_ID));
  if (!detail) throw new Error("The local project template is missing.");

  detail.project.id = LOCAL_PROJECT_ID;
  detail.project.revisionId = LOCAL_REVISION_ID;
  detail.project.versionToken = `"vf-${LOCAL_PROJECT_ID}-${LOCAL_REVISION_ID}-v1"`;
  detail.project.title = title;
  detail.project.status = "QUEUED";
  detail.project.stage = "QUEUED";
  detail.project.completed = 5;
  detail.project.eta = "Calculating";
  detail.project.estimatedCost = 0;
  detail.project.actualCost = 0;
  detail.project.queuePosition = 1;
  detail.project.stages = [
    {
      id: "ingest",
      label: "Prepare",
      status: "COMPLETE",
      completed: 1,
      total: 1,
      detail: "Owned voiceover bytes and checksum verified",
    },
    {
      id: "timing",
      label: "Transcribe",
      status: "QUEUED",
      completed: 0,
      total: 1,
      detail: "Pinned local whisper.cpp job queued",
    },
    {
      id: "timeline",
      label: "Plan",
      status: "PENDING",
      completed: 0,
      total: 1,
      detail: "Waiting for canonical word timing",
    },
    {
      id: "generation",
      label: "Resolve media",
      status: "PENDING",
      completed: 0,
      total: 1,
      detail: "Waiting for deterministic timeline",
    },
    {
      id: "assembly",
      label: "Render",
      status: "PENDING",
      completed: 0,
      total: 1,
      detail: "Waiting for the fixture asset barrier",
    },
    {
      id: "qa",
      label: "Technical check",
      status: "PENDING",
      completed: 0,
      total: 1,
      detail: "Waiting for the real MP4",
    },
    {
      id: "ready",
      label: "Review",
      status: "PENDING",
      completed: 0,
      total: 1,
      detail: "Human approval is required",
    },
  ];
  detail.project.lanes = {
    image: {
      state: "QUEUED",
      completed: 0,
      total: 3,
      action: "Three owned fixture images await deterministic binding",
    },
    avatar: {
      state: "QUEUED",
      completed: 0,
      total: 1,
      action: "One owned synthetic avatar source awaits binding",
    },
  };
  detail.project.latestArtifact = null;
  detail.project.review = {
    candidateId: null,
    candidateSha256: null,
    state: "NOT_READY",
    flaggedDefect: null,
    selectedAvatarClipId: null,
    downloadUrl: null,
  };
  detail.project.allowedActions = ["CANCEL"];
  detail.events = [
    {
      id: "event_local_created_001",
      detail: "Local revision created from the exact owned voiceover and immutable preset pins",
      at: nowIso(),
    },
  ];
  detail.notice = {
    tone: "INFO",
    title: "Local walking slice queued",
    detail:
      "State is bounded to this development server process; generated artifacts remain content-addressed on disk.",
    action: null,
    scope: "PROJECT",
  };
  return detail as LocalProjectDetail;
}

export class LocalRuntime {
  readonly idempotencyLedger: IdempotencyLedger = new Map();
  private voiceoverPromise: Promise<LocalOwnedVoiceover> | null = null;
  private projectDetail: LocalProjectDetail | null = null;
  private result: LocalPipelineRunResult | null = null;
  private abortController: AbortController | null = null;

  constructor(
    readonly environment: string,
    readonly commit: string,
    readonly runner: LocalSliceRunner,
  ) {}

  mutation(
    c: Context,
    requireVersion: boolean,
    handle: (rawBody: string) => Response | Promise<Response>,
  ): Promise<Response> {
    return idempotentMutation(c, this.idempotencyLedger, requireVersion, handle);
  }

  async ownedVoiceover(): Promise<LocalOwnedVoiceover> {
    this.voiceoverPromise ??= this.runner.prepareOwnedVoiceover();
    try {
      return await this.voiceoverPromise;
    } catch (error) {
      this.voiceoverPromise = null;
      throw error;
    }
  }

  async bootstrapResponse(): Promise<FixtureBootstrapResponse> {
    const [voiceover, base] = await Promise.all([
      this.ownedVoiceover(),
      Promise.resolve(toBootstrapResponse(scenario(BASE_SCENARIO_ID))),
    ]);
    base.projects = this.projectDetail ? [structuredClone(this.projectDetail.project)] : [];
    base.usage = {
      ...toUsageSummaryResponse(scenario(BASE_SCENARIO_ID)),
      currentMonth: 0,
      projectSpend: 0,
      styleSpend: 0,
      avatarTestSpend: 0,
      gpuSeconds: 0,
      retries: 0,
    };
    base.draft = {
      ...base.draft,
      title: "How to Recognize a Sweet Watermelon — Local Slice",
      voiceover: {
        assetId: voiceover.assetId,
        filename: voiceover.filename,
        durationSeconds: voiceover.durationSeconds,
        uploadState: "VERIFIED",
      },
      avatarProfileVersionId: "avatar_profile_version_fixture_001",
      imageStyleVersionId: "style_version_documentary_stock_v1",
      optionalScript: null,
      extraPromptKeywords: null,
      applyExtraPromptKeywords: false,
      effectiveExtraPromptKeywords: null,
      spendCapUsd: 0.1,
      preflight: {
        status: "READY",
        checks: [
          {
            id: "voiceover",
            label: "Voiceover",
            state: "PASS",
            message: `${voiceover.durationSeconds.toFixed(1)} seconds, owned bytes verified`,
          },
          {
            id: "avatar",
            label: "Avatar",
            state: "PASS",
            message: "Amish Farm Host v1 synthetic source pinned",
          },
          {
            id: "style",
            label: "Image style",
            state: "PASS",
            message: "Authentic Documentary Stock v1 owned examples pinned",
          },
          {
            id: "budget",
            label: "Spend cap",
            state: "PASS",
            message: "$0 local execution; the $0.10 request cap remains unused",
          },
        ],
      },
    };
    return base;
  }

  project(): LocalProjectDetail | null {
    return this.projectDetail ? structuredClone(this.projectDetail) : null;
  }

  output(): LocalPipelineRunResult | null {
    return this.result ? structuredClone(this.result) : null;
  }

  start(createRequest: LocalPipelineRunRequest["createRequest"], voiceover: LocalOwnedVoiceover) {
    if (this.abortController) {
      throw new Error("A local project run is already active.");
    }
    this.projectDetail = localProjectTemplate(createRequest.title);
    this.projectDetail.project.mode = createRequest.generation_mode;
    this.projectDetail.project.capUsd = createRequest.spend_cap_usd;
    this.projectDetail.project.pins = {
      avatarProfileVersionId: createRequest.avatar_profile_version_id,
      imageStyleVersionId: createRequest.image_style_version_id,
    };
    this.rememberInputs(createRequest, voiceover);
    this.result = null;
    this.abortController = new AbortController();
    const runRequest: LocalPipelineRunRequest = {
      projectId: LOCAL_PROJECT_ID,
      revisionId: LOCAL_REVISION_ID,
      createRequest: structuredClone(createRequest),
      voiceover,
      signal: this.abortController.signal,
      onProgress: (progress) => this.recordProgress(progress),
    };
    void this.runner
      .run(runRequest)
      .then((result) => this.recordReady(result))
      .catch((error: unknown) => this.recordFailure(error))
      .finally(() => {
        this.abortController = null;
      });
    return this.project();
  }

  cancel(): LocalProjectDetail | null {
    if (!this.projectDetail || !this.abortController) return null;
    this.abortController.abort();
    this.projectDetail.project.status = "CANCEL_REQUESTED";
    this.projectDetail.project.stage = "CANCEL_REQUESTED";
    this.projectDetail.project.eta = "Settling";
    this.projectDetail.project.queuePosition = null;
    this.projectDetail.project.allowedActions = [];
    this.projectDetail.events.push({
      id: `event_local_cancel_${this.projectDetail.events.length + 1}`,
      detail: "Cancellation requested for the active local media process",
      at: nowIso(),
    });
    rotateProjectVersion(this.projectDetail as RuntimeProjectDetail);
    return this.project();
  }

  approve(): LocalProjectDetail | null {
    if (!this.projectDetail || !this.result) return null;
    this.projectDetail.project.status = "APPROVED";
    this.projectDetail.project.stage = "APPROVED";
    this.projectDetail.project.review.state = "APPROVED";
    this.projectDetail.project.review.downloadUrl = `/api/v1/projects/${LOCAL_PROJECT_ID}/download`;
    this.projectDetail.project.allowedActions = ["REVIEW", "DOWNLOAD"];
    this.projectDetail.notice = {
      tone: "SUCCESS",
      title: "Local output approved",
      detail: "The exact MP4 candidate and checksum are locked for this in-process revision.",
      action: "Download MP4",
      scope: "PROJECT",
    };
    this.projectDetail.events.push({
      id: `event_local_approved_${this.projectDetail.events.length + 1}`,
      detail: `Candidate ${this.projectDetail.project.review.candidateId} approved at ${this.result.sha256}`,
      at: nowIso(),
    });
    rotateProjectVersion(this.projectDetail as RuntimeProjectDetail);
    return this.project();
  }

  retry(): LocalProjectDetail | null {
    if (!this.projectDetail || this.projectDetail.project.status !== "NEEDS_ATTENTION") return null;
    const createRequest = this.lastCreateRequest;
    const voiceover = this.lastVoiceover;
    if (!createRequest || !voiceover) return null;
    const versionToken = nextVersionToken(this.projectDetail.project.versionToken);
    this.start(createRequest, voiceover);
    if (!this.projectDetail) throw new Error("Retry did not recreate local project state.");
    this.projectDetail.project.versionToken = versionToken;
    this.projectDetail.events.push({
      id: `event_local_retry_${this.projectDetail.events.length + 1}`,
      detail: "Retry started for the failed local media pipeline",
      at: nowIso(),
    });
    return this.project();
  }

  private lastCreateRequest: LocalPipelineRunRequest["createRequest"] | null = null;
  private lastVoiceover: LocalOwnedVoiceover | null = null;

  rememberInputs(
    createRequest: LocalPipelineRunRequest["createRequest"],
    voiceover: LocalOwnedVoiceover,
  ): void {
    this.lastCreateRequest = structuredClone(createRequest);
    this.lastVoiceover = voiceover;
  }

  private recordProgress(progress: LocalPipelineProgress): void {
    if (!this.projectDetail || this.projectDetail.project.status === "CANCEL_REQUESTED") return;
    const activeId = STAGE_ID[progress.stage];
    let reachedActive = false;
    for (const stage of this.projectDetail.project.stages ?? []) {
      if (stage.id === activeId) {
        stage.status = "RUNNING";
        stage.completed = 0;
        stage.detail = progress.detail;
        reachedActive = true;
      } else if (!reachedActive && stage.id !== "ready") {
        stage.status = "COMPLETE";
        stage.completed = stage.total;
      } else if (stage.id !== "ingest") {
        stage.status = "PENDING";
        stage.completed = 0;
      }
    }
    this.projectDetail.project.status = "RUNNING";
    this.projectDetail.project.stage = progress.stage;
    this.projectDetail.project.completed = STAGE_PROGRESS[progress.stage];
    this.projectDetail.project.eta = "Under 1 min";
    this.projectDetail.project.queuePosition = null;
    if (progress.stage === "RESOLVING_ASSETS") {
      this.projectDetail.project.lanes.image = {
        state: "RUNNING",
        completed: 0,
        total: 3,
        action: "Binding owned documentary fixture images",
      };
      this.projectDetail.project.lanes.avatar = {
        state: "RUNNING",
        completed: 0,
        total: 1,
        action: "Binding owned synthetic avatar source",
      };
    }
    this.projectDetail.events.push({
      id: `event_local_stage_${this.projectDetail.events.length + 1}`,
      detail: progress.detail,
      at: nowIso(),
    });
  }

  private recordReady(result: LocalPipelineRunResult): void {
    if (!this.projectDetail || this.projectDetail.project.status === "CANCEL_REQUESTED") return;
    this.result = structuredClone(result);
    for (const stage of this.projectDetail.project.stages ?? []) {
      stage.status = "COMPLETE";
      stage.completed = stage.total;
      if (stage.id === "ready") stage.detail = "Real local MP4 awaits explicit human approval";
    }
    this.projectDetail.project.status = "READY_FOR_REVIEW";
    this.projectDetail.project.stage = "READY_FOR_REVIEW";
    this.projectDetail.project.completed = 100;
    this.projectDetail.project.eta = "Ready";
    this.projectDetail.project.queuePosition = null;
    this.projectDetail.project.lanes.image = {
      state: "COMPLETE",
      completed: 3,
      total: 3,
      action: "Owned image bindings complete",
    };
    this.projectDetail.project.lanes.avatar = {
      state: "COMPLETE",
      completed: 1,
      total: 1,
      action: "Owned synthetic avatar binding complete",
    };
    this.projectDetail.project.latestArtifact = {
      kind: "VIDEO",
      url: `/api/v1/projects/${LOCAL_PROJECT_ID}/preview`,
      label: "Local synthetic 1080p30 MP4",
      sha256: result.sha256,
      bytes: result.bytes,
      filename: result.filename,
    };
    this.projectDetail.project.review = {
      candidateId: "review_candidate_local_001",
      candidateSha256: result.sha256,
      state: "READY_FOR_REVIEW",
      flaggedDefect: null,
      selectedAvatarClipId: "avatar_clip_local_owned_001",
      downloadUrl: null,
    };
    this.projectDetail.project.allowedActions = ["REVIEW", "APPROVE"];
    this.projectDetail.notice = {
      tone: "SUCCESS",
      title: "Real local MP4 ready for review",
      detail: "FFmpeg rendering and FFprobe technical checks passed at $0 external spend.",
      action: "Review candidate",
      scope: "PROJECT",
    };
    this.projectDetail.events.push({
      id: `event_local_ready_${this.projectDetail.events.length + 1}`,
      detail: `Technical probe accepted ${result.filename} at ${result.sha256}`,
      at: nowIso(),
    });
    rotateProjectVersion(this.projectDetail as RuntimeProjectDetail);
  }

  private recordFailure(error: unknown): void {
    if (!this.projectDetail || this.projectDetail.project.status === "CANCEL_REQUESTED") return;
    const message = error instanceof Error ? error.message : "Unknown local media failure";
    const active = this.projectDetail.project.stages?.find((stage) => stage.status === "RUNNING");
    if (active) {
      active.status = "FAILED";
      active.detail = message;
    }
    this.projectDetail.project.status = "NEEDS_ATTENTION";
    this.projectDetail.project.stage = "LOCAL_PIPELINE_FAILED";
    this.projectDetail.project.eta = "Action required";
    this.projectDetail.project.queuePosition = null;
    this.projectDetail.project.allowedActions = ["RETRY_FAILED_ITEMS"];
    this.projectDetail.notice = {
      tone: "ERROR",
      title: "Local media pipeline failed",
      detail: message,
      action: "Retry local run",
      scope: "PROJECT",
    };
    this.projectDetail.events.push({
      id: `event_local_failed_${this.projectDetail.events.length + 1}`,
      detail: message,
      at: nowIso(),
    });
    rotateProjectVersion(this.projectDetail as RuntimeProjectDetail);
  }
}
