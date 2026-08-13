export type ProviderFreeLane = "mage_image" | "echo_avatar";

export type ProviderFreePodPhase =
  | "CREATING"
  | "CONTAINER_READY"
  | "VOLUME_READY"
  | "MODEL_LOADING"
  | "MODEL_READY"
  | "WORKING"
  | "WARM"
  | "DELETE_REQUESTED"
  | "ABSENCE_VERIFIED";

export type ProviderFreeProjectStage =
  | "WAITING"
  | "BOOTING"
  | "PREPARING"
  | "GENERATING"
  | "RENDERING"
  | "READY_FOR_REVIEW"
  | "CANCELLED"
  | "REMOVED";

export interface ProviderFreeGpuPair {
  readonly mage: { readonly receiptId: string; readonly gpuSku: string };
  readonly echo: { readonly receiptId: string; readonly gpuSku: string };
}

export interface ProviderFreePodAttempt {
  readonly attemptId: string;
  readonly podId: string;
  readonly originProjectId: string;
  phase: ProviderFreePodPhase;
  callbackSequence: number;
  readonly createdAt: string;
  containerReadyAt: string | null;
  volumeReadyAt: string | null;
  modelLoadingAt: string | null;
  warmupPassedAt: string | null;
  modelReadyAt: string | null;
  workStartedAt: string | null;
  laneCompletedAt: string | null;
  deleteRequestedAt: string | null;
  absenceVerifiedAt: string | null;
  absenceReceiptSha256: string | null;
}

export interface ProviderFreeLaneState {
  readonly lane: ProviderFreeLane;
  readonly volumeId: string;
  readonly volumeManifestSha256: string;
  readonly selectedGpuSku: string;
  readonly attempts: ProviderFreePodAttempt[];
}

export interface ProviderFreeProjectState {
  readonly queueEntryId: string;
  readonly projectId: string;
  readonly title: string;
  stage: ProviderFreeProjectStage;
  readonly createdAt: string;
  activatedAt: string | null;
  completedAt: string | null;
  workStartedAt: string | null;
  readonly barriers: {
    transcriptSha256: string | null;
    timelineSha256: string | null;
    promptManifestSha256: string | null;
    mageOutputSha256: string | null;
    echoOutputSha256: string | null;
    renderManifestSha256: string | null;
    finalMp4Sha256: string | null;
  };
  readonly cost: {
    kind: "SIMULATED_FIXTURE";
    reservedMicroUsd: number;
    reportedMicroUsd: number;
    settledMicroUsd: number;
    actualExternalSpendUsd: 0;
  };
  finalAsset: null | {
    artifactId: string;
    sha256: string;
    byteSize: number;
    contentType: "video/mp4";
    width: 1920;
    height: 1080;
    durationMs: 1000;
    audioCodec: "aac";
    videoCodec: "h264";
    downloadPath: string;
  };
}

export interface ProviderFreeSessionState {
  readonly sessionId: string;
  state: "ACTIVE" | "DRAINING" | "CLOSED";
  readonly gpuPair: ProviderFreeGpuPair;
  readonly openedAt: string;
  closedAt: string | null;
  activeProjectId: string | null;
  recoveryCount: number;
  readonly lanes: Record<ProviderFreeLane, ProviderFreeLaneState>;
}

export interface ProviderFreeOrchestrationState {
  readonly schemaVersion: "videoforge.provider-free-orchestration/v1";
  session: ProviderFreeSessionState | null;
  lastClosedSession: ProviderFreeSessionState | null;
  readonly projects: ProviderFreeProjectState[];
  readonly events: Array<{
    readonly id: string;
    readonly kind: string;
    readonly projectId: string | null;
    readonly lane: ProviderFreeLane | null;
    readonly at: string;
  }>;
}

export interface ProviderFreeAdvanceResult {
  readonly event: string;
  readonly completedProjectId: string | null;
  readonly promotedProjectId: string | null;
  readonly sessionClosed: boolean;
}

export interface ProviderFreeFoundationReceipts {
  readonly transcriptSha256: string;
  readonly timelineSha256: string;
  readonly promptManifestSha256: string;
}

export class ProviderFreeOrchestrationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderFreeOrchestrationError";
  }
}

const FINAL_MP4_SHA256 = "sha256:fa27620397740bb5c47b8402b47cf0f5d90074246d3feb16e65b6498b81a2c37";
const FINAL_MP4_BYTE_SIZE = 9764;
const SIMULATED_PROJECT_COST_MICRO_USD = 880_000;

function now(): string {
  return new Date().toISOString();
}

async function sha256(label: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(label));
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function emptyState(): ProviderFreeOrchestrationState {
  return {
    schemaVersion: "videoforge.provider-free-orchestration/v1",
    session: null,
    lastClosedSession: null,
    projects: [],
    events: [],
  };
}

function laneFor(session: ProviderFreeSessionState, lane: ProviderFreeLane): ProviderFreeLaneState {
  return session.lanes[lane];
}

function latestAttempt(lane: ProviderFreeLaneState): ProviderFreePodAttempt {
  const attempt = lane.attempts.at(-1);
  if (!attempt) {
    throw new ProviderFreeOrchestrationError(
      "POD_ATTEMPT_MISSING",
      `Synthetic ${lane.lane} lane has no current Pod attempt.`,
    );
  }
  return attempt;
}

function createAttempt(
  lane: ProviderFreeLane,
  projectId: string,
  attemptNumber: number,
  at: string,
): ProviderFreePodAttempt {
  return {
    attemptId: `fixture-attempt-${lane}-${attemptNumber}`,
    podId: `fixture-pod-${lane}-${attemptNumber}`,
    originProjectId: projectId,
    phase: "CREATING",
    callbackSequence: 0,
    createdAt: at,
    containerReadyAt: null,
    volumeReadyAt: null,
    modelLoadingAt: null,
    warmupPassedAt: null,
    modelReadyAt: null,
    workStartedAt: null,
    laneCompletedAt: null,
    deleteRequestedAt: null,
    absenceVerifiedAt: null,
    absenceReceiptSha256: null,
  };
}

function createProject(
  queueEntryId: string,
  projectId: string,
  title: string,
  stage: ProviderFreeProjectStage,
  at: string,
): ProviderFreeProjectState {
  return {
    queueEntryId,
    projectId,
    title,
    stage,
    createdAt: at,
    activatedAt: stage === "WAITING" ? null : at,
    completedAt: null,
    workStartedAt: null,
    barriers: {
      transcriptSha256: null,
      timelineSha256: null,
      promptManifestSha256: null,
      mageOutputSha256: null,
      echoOutputSha256: null,
      renderManifestSha256: null,
      finalMp4Sha256: null,
    },
    cost: {
      kind: "SIMULATED_FIXTURE",
      reservedMicroUsd: SIMULATED_PROJECT_COST_MICRO_USD,
      reportedMicroUsd: 0,
      settledMicroUsd: 0,
      actualExternalSpendUsd: 0,
    },
    finalAsset: null,
  };
}

function isTerminal(stage: ProviderFreeProjectStage): boolean {
  return ["READY_FOR_REVIEW", "CANCELLED", "REMOVED"].includes(stage);
}

export class ProviderFreeMvpOrchestrator {
  readonly #state: ProviderFreeOrchestrationState;

  constructor(snapshot?: ProviderFreeOrchestrationState) {
    this.#state = snapshot ? clone(snapshot) : emptyState();
    this.assertValid();
  }

  snapshot(): ProviderFreeOrchestrationState {
    return clone(this.#state);
  }

  reset(): void {
    const fresh = emptyState();
    this.#state.session = fresh.session;
    this.#state.lastClosedSession = fresh.lastClosedSession;
    this.#state.projects.splice(0);
    this.#state.events.splice(0);
  }

  startSession(input: {
    queueEntryId: string;
    projectId: string;
    title: string;
    gpuPair: ProviderFreeGpuPair;
  }): void {
    if (this.#state.session !== null) {
      throw new ProviderFreeOrchestrationError(
        "SESSION_ALREADY_ACTIVE",
        "Only one synthetic generation session may be active.",
      );
    }
    const at = now();
    const sessionId = crypto.randomUUID();
    this.#state.session = {
      sessionId,
      state: "ACTIVE",
      gpuPair: clone(input.gpuPair),
      openedAt: at,
      closedAt: null,
      activeProjectId: input.projectId,
      recoveryCount: 0,
      lanes: {
        mage_image: {
          lane: "mage_image",
          volumeId: "fixture-volume-mage-vnext",
          volumeManifestSha256:
            "sha256:4f5589227925824fa055e0df49d095a5801fd058cb05241ceee41bd77968f384",
          selectedGpuSku: input.gpuPair.mage.gpuSku,
          attempts: [createAttempt("mage_image", input.projectId, 1, at)],
        },
        echo_avatar: {
          lane: "echo_avatar",
          volumeId: "fixture-volume-echo-vnext",
          volumeManifestSha256:
            "sha256:48104a7917f6835512fc71dd68f4bb4773257f934640873716e2fe17771d157a",
          selectedGpuSku: input.gpuPair.echo.gpuSku,
          attempts: [createAttempt("echo_avatar", input.projectId, 1, at)],
        },
      },
    };
    this.#state.projects.push(
      createProject(input.queueEntryId, input.projectId, input.title, "BOOTING", at),
    );
    this.record("SESSION_OPENED", input.projectId, null, at);
    this.assertValid();
  }

  addWaiting(queueEntryId: string, projectId: string, title: string): void {
    if (this.#state.session === null || this.#state.session.state !== "ACTIVE") {
      throw new ProviderFreeOrchestrationError(
        "SESSION_NOT_ACTIVE",
        "A waiting project requires one active synthetic session.",
      );
    }
    if (this.#state.projects.some((project) => project.projectId === projectId)) {
      throw new ProviderFreeOrchestrationError(
        "PROJECT_ALREADY_REGISTERED",
        "Project is already present in synthetic orchestration history.",
      );
    }
    const at = now();
    this.#state.projects.push(createProject(queueEntryId, projectId, title, "WAITING", at));
    this.record("WAITING_ADDED_INERT", projectId, null, at);
    this.assertValid();
  }

  removeWaiting(projectId: string): void {
    const project = this.requireProject(projectId);
    if (project.stage !== "WAITING") {
      throw new ProviderFreeOrchestrationError(
        "PROJECT_NOT_WAITING",
        "Only an inert waiting project may be removed.",
      );
    }
    project.stage = "REMOVED";
    project.completedAt = now();
    this.record("WAITING_REMOVED", projectId, null, project.completedAt);
    this.assertValid();
  }

  recover(): void {
    this.assertValid();
    const session = this.requireSession();
    session.recoveryCount += 1;
    this.record("RECOVERY_RECONCILED", session.activeProjectId, null, now());
  }

  acceptLaneCallback(input: {
    sessionId: string;
    projectId: string;
    lane: ProviderFreeLane;
    podId: string;
    gpuSku: string;
    volumeId: string;
    sequence: number;
  }): void {
    const session = this.requireSession();
    if (input.sessionId !== session.sessionId || input.projectId !== session.activeProjectId) {
      throw new ProviderFreeOrchestrationError(
        "STALE_CALLBACK",
        "Callback does not belong to current session and active project.",
      );
    }
    const lane = laneFor(session, input.lane);
    const attempt = latestAttempt(lane);
    if (
      input.podId !== attempt.podId ||
      input.gpuSku !== lane.selectedGpuSku ||
      input.volumeId !== lane.volumeId
    ) {
      throw new ProviderFreeOrchestrationError(
        "POD_IDENTITY_MISMATCH",
        "Callback Pod, GPU, and volume must match exact current lane authority.",
      );
    }
    if (!Number.isSafeInteger(input.sequence) || input.sequence <= attempt.callbackSequence) {
      throw new ProviderFreeOrchestrationError(
        "STALE_CALLBACK",
        "Callback sequence must advance monotonically for current Pod attempt.",
      );
    }
    attempt.callbackSequence = input.sequence;
    this.record("CALLBACK_ACCEPTED", input.projectId, input.lane, now());
  }

  cancelActive(waitingProjectIds: readonly string[]): ProviderFreeAdvanceResult {
    const session = this.requireSession();
    const project = this.requireActiveProject(session);
    const at = now();
    project.stage = "CANCELLED";
    project.completedAt = at;
    project.cost.settledMicroUsd = project.cost.reportedMicroUsd;
    for (const laneName of ["mage_image", "echo_avatar"] as const) {
      const attempt = latestAttempt(laneFor(session, laneName));
      if (attempt.phase !== "ABSENCE_VERIFIED") {
        if (waitingProjectIds.length > 0 && !["DELETE_REQUESTED"].includes(attempt.phase)) {
          attempt.phase = "WARM";
        } else if (attempt.phase !== "DELETE_REQUESTED") {
          attempt.phase = "DELETE_REQUESTED";
          attempt.deleteRequestedAt = at;
        }
      }
    }
    this.record("ACTIVE_CANCELLED", project.projectId, null, at);
    return this.finishOrPromote(project.projectId, waitingProjectIds, at);
  }

  async advance(
    waitingProjectIds: readonly string[],
    foundations?: ProviderFreeFoundationReceipts,
  ): Promise<ProviderFreeAdvanceResult> {
    const session = this.requireSession();
    if (session.state === "DRAINING") return this.advanceDrain(session);
    const project = this.requireActiveProject(session);

    const deletion = await this.advancePendingDeletion(session, project);
    if (deletion) return deletion;

    if (project.stage === "BOOTING" || project.stage === "PREPARING") {
      const boot = this.advanceBoot(session, project);
      if (boot) return boot;
      if (
        foundations === undefined ||
        !Object.values(foundations).every((value) => /^sha256:[0-9a-f]{64}$/u.test(value))
      ) {
        throw new ProviderFreeOrchestrationError(
          "FOUNDATION_RECEIPTS_REQUIRED",
          "Validated CP-03 transcript, CP-04 timeline, and prompt fixture receipts are required.",
        );
      }
      const at = now();
      project.stage = "GENERATING";
      project.workStartedAt = at;
      project.barriers.transcriptSha256 = foundations.transcriptSha256;
      project.barriers.timelineSha256 = foundations.timelineSha256;
      project.barriers.promptManifestSha256 = foundations.promptManifestSha256;
      project.cost.reportedMicroUsd = 200_000;
      for (const laneName of ["mage_image", "echo_avatar"] as const) {
        const attempt = latestAttempt(laneFor(session, laneName));
        if (!["MODEL_READY", "WARM"].includes(attempt.phase)) {
          throw new ProviderFreeOrchestrationError(
            "MODEL_NOT_READY",
            "Both exact synthetic models must be ready before project work starts.",
          );
        }
        attempt.phase = "WORKING";
        attempt.workStartedAt = at;
      }
      this.record("FOUNDATIONS_DURABLE", project.projectId, null, at);
      this.assertValid();
      return this.result("FOUNDATIONS_DURABLE");
    }

    if (project.stage === "GENERATING") {
      if (project.barriers.mageOutputSha256 === null) {
        project.barriers.mageOutputSha256 = await sha256(`${project.projectId}:mage-assets:v1`);
        project.cost.reportedMicroUsd = 500_000;
        this.completeLane(session, project, "mage_image", waitingProjectIds.length > 0);
        return this.result("MAGE_DURABLE");
      }
      if (project.barriers.echoOutputSha256 === null) {
        project.barriers.echoOutputSha256 = await sha256(`${project.projectId}:echo-assets:v1`);
        project.cost.reportedMicroUsd = 800_000;
        this.completeLane(session, project, "echo_avatar", waitingProjectIds.length > 0);
        project.stage = "RENDERING";
        return this.result("ECHO_DURABLE");
      }
    }

    if (project.stage === "RENDERING") {
      const at = now();
      project.barriers.renderManifestSha256 = await sha256(
        `${project.projectId}:resolved-render-manifest:v1`,
      );
      project.barriers.finalMp4Sha256 = FINAL_MP4_SHA256;
      project.cost.reportedMicroUsd = SIMULATED_PROJECT_COST_MICRO_USD;
      project.cost.settledMicroUsd = SIMULATED_PROJECT_COST_MICRO_USD;
      project.finalAsset = {
        artifactId: `fixture-final-mp4-${project.projectId}`,
        sha256: FINAL_MP4_SHA256,
        byteSize: FINAL_MP4_BYTE_SIZE,
        contentType: "video/mp4",
        width: 1920,
        height: 1080,
        durationMs: 1000,
        audioCodec: "aac",
        videoCodec: "h264",
        downloadPath: `/api/v1/shared-app/projects/${encodeURIComponent(project.projectId)}/download`,
      };
      project.stage = "READY_FOR_REVIEW";
      project.completedAt = at;
      this.record("FINAL_MP4_DURABLE", project.projectId, null, at);
      return this.finishOrPromote(project.projectId, waitingProjectIds, at);
    }

    throw new ProviderFreeOrchestrationError(
      "NO_ADVANCE_AVAILABLE",
      `Project stage ${project.stage} has no provider-free advance.`,
    );
  }

  project(projectId: string): ProviderFreeProjectState {
    return clone(this.requireProject(projectId));
  }

  private finishOrPromote(
    completedProjectId: string,
    waitingProjectIds: readonly string[],
    at: string,
  ): ProviderFreeAdvanceResult {
    const session = this.requireSession();
    const promotedProjectId = waitingProjectIds[0] ?? null;
    if (promotedProjectId === null) {
      session.activeProjectId = null;
      session.state = "DRAINING";
      for (const laneName of ["mage_image", "echo_avatar"] as const) {
        const attempt = latestAttempt(laneFor(session, laneName));
        if (!["DELETE_REQUESTED", "ABSENCE_VERIFIED"].includes(attempt.phase)) {
          attempt.phase = "DELETE_REQUESTED";
          attempt.deleteRequestedAt = at;
        }
      }
      this.record("SESSION_DRAINING", completedProjectId, null, at);
      this.assertValid();
      return {
        event: "SESSION_DRAINING",
        completedProjectId,
        promotedProjectId: null,
        sessionClosed: false,
      };
    }

    const promoted = this.requireProject(promotedProjectId);
    if (promoted.stage !== "WAITING") {
      throw new ProviderFreeOrchestrationError(
        "PROMOTION_NOT_WAITING",
        "Only first inert waiting project may be promoted.",
      );
    }
    promoted.stage = "PREPARING";
    promoted.activatedAt = at;
    session.activeProjectId = promotedProjectId;
    for (const laneName of ["mage_image", "echo_avatar"] as const) {
      const lane = laneFor(session, laneName);
      const attempt = latestAttempt(lane);
      if (attempt.phase === "ABSENCE_VERIFIED") {
        lane.attempts.push(
          createAttempt(laneName, promotedProjectId, lane.attempts.length + 1, at),
        );
      } else if (attempt.phase === "WARM") {
        // Existing exact warm Pod stays ready. No waiter work happened before this activation.
      } else {
        throw new ProviderFreeOrchestrationError(
          "LANE_PROMOTION_UNSAFE",
          `Lane ${laneName} is neither warm nor absent at project promotion.`,
        );
      }
    }
    this.record("WAITING_PROMOTED", promotedProjectId, null, at);
    this.assertValid();
    return {
      event: "WAITING_PROMOTED",
      completedProjectId,
      promotedProjectId,
      sessionClosed: false,
    };
  }

  private advanceBoot(
    session: ProviderFreeSessionState,
    project: ProviderFreeProjectState,
  ): ProviderFreeAdvanceResult | null {
    for (const phase of ["CREATING", "CONTAINER_READY", "VOLUME_READY", "MODEL_LOADING"] as const) {
      for (const laneName of ["mage_image", "echo_avatar"] as const) {
        const attempt = latestAttempt(laneFor(session, laneName));
        if (attempt.phase !== phase) continue;
        const at = now();
        let event: string;
        if (phase === "CREATING") {
          attempt.phase = "CONTAINER_READY";
          attempt.containerReadyAt = at;
          event = "CONTAINER_READY";
        } else if (phase === "CONTAINER_READY") {
          attempt.phase = "VOLUME_READY";
          attempt.volumeReadyAt = at;
          event = "VOLUME_READY";
        } else if (phase === "VOLUME_READY") {
          attempt.phase = "MODEL_LOADING";
          attempt.modelLoadingAt = at;
          event = "MODEL_LOADING";
        } else {
          attempt.phase = "MODEL_READY";
          attempt.warmupPassedAt = at;
          attempt.modelReadyAt = at;
          event = "MODEL_READY";
        }
        this.record(event, project.projectId, laneName, at);
        this.assertValid();
        return this.result(`${laneName.toUpperCase()}_${event}`);
      }
    }
    return null;
  }

  private completeLane(
    session: ProviderFreeSessionState,
    project: ProviderFreeProjectState,
    laneName: ProviderFreeLane,
    waiterExists: boolean,
  ): void {
    const attempt = latestAttempt(laneFor(session, laneName));
    if (attempt.phase !== "WORKING") {
      throw new ProviderFreeOrchestrationError(
        "LANE_NOT_WORKING",
        `Synthetic ${laneName} lane cannot complete before exact work starts.`,
      );
    }
    const at = now();
    attempt.laneCompletedAt = at;
    if (waiterExists) {
      attempt.phase = "WARM";
    } else {
      attempt.phase = "DELETE_REQUESTED";
      attempt.deleteRequestedAt = at;
    }
    this.record(
      waiterExists ? "LANE_WARM_FOR_WAITER" : "POD_DELETE_REQUESTED",
      project.projectId,
      laneName,
      at,
    );
    this.assertValid();
  }

  private async advancePendingDeletion(
    session: ProviderFreeSessionState,
    project: ProviderFreeProjectState,
  ): Promise<ProviderFreeAdvanceResult | null> {
    for (const laneName of ["mage_image", "echo_avatar"] as const) {
      const attempt = latestAttempt(laneFor(session, laneName));
      if (attempt.phase !== "DELETE_REQUESTED") continue;
      const at = now();
      attempt.phase = "ABSENCE_VERIFIED";
      attempt.absenceVerifiedAt = at;
      attempt.absenceReceiptSha256 = await sha256(`${session.sessionId}:${attempt.podId}:absent`);
      this.record("POD_ABSENCE_VERIFIED", project.projectId, laneName, at);
      this.assertValid();
      return this.result(`${laneName.toUpperCase()}_ABSENCE_VERIFIED`);
    }
    return null;
  }

  private async advanceDrain(
    session: ProviderFreeSessionState,
  ): Promise<ProviderFreeAdvanceResult> {
    for (const laneName of ["mage_image", "echo_avatar"] as const) {
      const attempt = latestAttempt(laneFor(session, laneName));
      if (attempt.phase === "DELETE_REQUESTED") {
        const at = now();
        attempt.phase = "ABSENCE_VERIFIED";
        attempt.absenceVerifiedAt = at;
        attempt.absenceReceiptSha256 = await sha256(`${session.sessionId}:${attempt.podId}:absent`);
        this.record("POD_ABSENCE_VERIFIED", null, laneName, at);
        this.assertValid();
        return this.result(`${laneName.toUpperCase()}_ABSENCE_VERIFIED`);
      }
    }
    for (const laneName of ["mage_image", "echo_avatar"] as const) {
      if (latestAttempt(laneFor(session, laneName)).phase !== "ABSENCE_VERIFIED") {
        throw new ProviderFreeOrchestrationError(
          "SESSION_NOT_DRAINED",
          "Session cannot close until both exact synthetic Pods are absent.",
        );
      }
    }
    const at = now();
    session.state = "CLOSED";
    session.closedAt = at;
    this.record("SESSION_CLOSED", null, null, at);
    this.#state.lastClosedSession = clone(session);
    this.#state.session = null;
    this.assertValid();
    return {
      event: "SESSION_CLOSED",
      completedProjectId: null,
      promotedProjectId: null,
      sessionClosed: true,
    };
  }

  private requireSession(): ProviderFreeSessionState {
    if (this.#state.session === null) {
      throw new ProviderFreeOrchestrationError(
        "SESSION_NOT_ACTIVE",
        "No synthetic generation session is active.",
      );
    }
    return this.#state.session;
  }

  private requireProject(projectId: string): ProviderFreeProjectState {
    const project = this.#state.projects.find((candidate) => candidate.projectId === projectId);
    if (!project) {
      throw new ProviderFreeOrchestrationError("PROJECT_NOT_FOUND", "Synthetic project not found.");
    }
    return project;
  }

  private requireActiveProject(session: ProviderFreeSessionState): ProviderFreeProjectState {
    if (session.activeProjectId === null) {
      throw new ProviderFreeOrchestrationError(
        "ACTIVE_PROJECT_MISSING",
        "Active session has no current project.",
      );
    }
    const project = this.requireProject(session.activeProjectId);
    if (isTerminal(project.stage) || project.stage === "WAITING") {
      throw new ProviderFreeOrchestrationError(
        "ACTIVE_PROJECT_INVALID",
        "Session active project is not executable.",
      );
    }
    return project;
  }

  private record(
    kind: string,
    projectId: string | null,
    lane: ProviderFreeLane | null,
    at: string,
  ): void {
    this.#state.events.push({
      id: `fixture-event-${this.#state.events.length + 1}`,
      kind,
      projectId,
      lane,
      at,
    });
  }

  private result(event: string): ProviderFreeAdvanceResult {
    return { event, completedProjectId: null, promotedProjectId: null, sessionClosed: false };
  }

  private assertValid(): void {
    if (this.#state.schemaVersion !== "videoforge.provider-free-orchestration/v1") {
      throw new ProviderFreeOrchestrationError(
        "ORCHESTRATION_SCHEMA_INVALID",
        "Synthetic orchestration snapshot has an unknown schema.",
      );
    }
    const activeProjects = this.#state.projects.filter(
      (project) => !isTerminal(project.stage) && project.stage !== "WAITING",
    );
    if (activeProjects.length > 1) {
      throw new ProviderFreeOrchestrationError(
        "MULTIPLE_ACTIVE_PROJECTS",
        "Exactly one synthetic project may execute at a time.",
      );
    }
    for (const project of this.#state.projects.filter(
      (candidate) => candidate.stage === "WAITING",
    )) {
      if (
        project.activatedAt !== null ||
        project.workStartedAt !== null ||
        Object.values(project.barriers).some((value) => value !== null) ||
        project.cost.reportedMicroUsd !== 0 ||
        project.cost.settledMicroUsd !== 0 ||
        project.finalAsset !== null
      ) {
        throw new ProviderFreeOrchestrationError(
          "WAITING_PROJECT_NOT_INERT",
          "Waiting project contains forbidden orchestration work.",
        );
      }
    }
    const session = this.#state.session;
    if (session === null) return;
    if (session.lanes.mage_image.volumeId === session.lanes.echo_avatar.volumeId) {
      throw new ProviderFreeOrchestrationError(
        "CROSS_LANE_VOLUME",
        "Mage and Echo synthetic volumes must remain different.",
      );
    }
    if (session.state === "ACTIVE" && activeProjects.length !== 1) {
      throw new ProviderFreeOrchestrationError(
        "ACTIVE_PROJECT_MISSING",
        "Active session must own exactly one executable project.",
      );
    }
    if (session.activeProjectId !== (activeProjects[0]?.projectId ?? null)) {
      throw new ProviderFreeOrchestrationError(
        "ACTIVE_PROJECT_MISMATCH",
        "Session and project active identity differ.",
      );
    }
    for (const laneName of ["mage_image", "echo_avatar"] as const) {
      const lane = laneFor(session, laneName);
      if (lane.attempts.length === 0) {
        throw new ProviderFreeOrchestrationError(
          "POD_ATTEMPT_MISSING",
          `Synthetic ${laneName} lane has no attempt history.`,
        );
      }
      for (const attempt of lane.attempts) {
        if (attempt.originProjectId.length === 0) {
          throw new ProviderFreeOrchestrationError(
            "POD_ORIGIN_MISSING",
            "Every synthetic Pod attempt must bind one active-project origin.",
          );
        }
      }
    }
  }
}
