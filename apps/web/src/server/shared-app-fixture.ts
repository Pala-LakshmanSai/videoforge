import {
  ProviderFreeMvpOrchestrator,
  ProviderFreeOrchestrationError,
  type ProviderFreeAdvanceResult,
  type ProviderFreeLane,
  type ProviderFreeGpuRevalidationPair,
  type ProviderFreeMaterializedReceipts,
  type ProviderFreeOrchestrationState,
  type ProviderFreeProjectState,
} from "@videoforge/control-plane/provider-free-orchestration";

import { MemorySharedAppPersistence, type SharedAppPersistence } from "./shared-app-persistence";
import {
  MemoryProviderFreeArtifactRuntime,
  type ProviderFreeArtifactRuntime,
} from "./provider-free-artifact-runtime";
import { buildProviderFreeProjectBundle } from "./provider-free-foundations";

export type FixtureAuthMethod = "EMAIL_PASSWORD" | "GOOGLE";
export type SharedQueueState = "ACTIVE" | "WAITING";

export interface GpuOffer {
  readonly receiptId: string;
  readonly lane: "image_media" | "avatar_primary";
  readonly gpuSku: string;
  readonly vramGb: number;
  readonly rateUsdPerHour: number;
  readonly cloudType: "SECURE";
  readonly region: "EU-RO-1";
  readonly observedAt: string;
  readonly expiresAt: string;
}

export interface LockedGpuPair {
  readonly image: GpuOffer;
  readonly avatar: GpuOffer;
  readonly lockedAt: string;
}

export interface SharedQueueEntry {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly state: SharedQueueState;
  readonly actor: string;
  readonly position: number;
  readonly createdAt: string;
}

export interface SharedQueueAudit {
  readonly id: string;
  readonly operation: "START" | "ADD" | "MOVE" | "REMOVE";
  readonly actor: string;
  readonly oldOrder: readonly string[];
  readonly newOrder: readonly string[];
  readonly oldVersion: number;
  readonly newVersion: number;
  readonly occurredAt: string;
}

export interface SharedAppView {
  readonly rights: "EQUAL";
  readonly admission: {
    readonly admitted: boolean;
    readonly email: string | null;
    readonly authMethod: FixtureAuthMethod | null;
  };
  readonly inventory: readonly GpuOffer[];
  readonly session: null | {
    readonly id: string;
    readonly queueVersion: number;
    readonly gpuPair: LockedGpuPair;
  };
  readonly queue: readonly SharedQueueEntry[];
  readonly audits: readonly SharedQueueAudit[];
  readonly orchestration: ProviderFreeOrchestrationState;
  readonly canSelectGpuPair: boolean;
  readonly providerCallsAuthorized: false;
  readonly authorizedSpendUsd: 0;
}

export class SharedFixtureError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SharedFixtureError";
  }
}

interface Admission {
  readonly email: string;
  readonly method: FixtureAuthMethod;
  readonly credentialHash: string;
}

interface Invite {
  readonly email: string;
  readonly codeHash: string;
  readonly emailPasswordHash: string;
  readonly googleAssertionHash: string;
  consumed: boolean;
}

interface MutableState {
  admissions: Map<string, Admission>;
  sessionAdmissions: Map<string, Admission>;
  invites: Map<string, Invite>;
  sessionId: string | null;
  pair: LockedGpuPair | null;
  queueVersion: number;
  queue: SharedQueueEntry[];
  audits: SharedQueueAudit[];
  orchestration: ProviderFreeOrchestrationState;
}

const OFFER_TEMPLATES = Object.freeze([
  Object.freeze({
    receiptId: "receipt_image_rtx4090_001",
    lane: "image_media",
    gpuSku: "NVIDIA RTX 4090",
    vramGb: 24,
    rateUsdPerHour: 0.34,
    cloudType: "SECURE",
    region: "EU-RO-1",
  }),
  Object.freeze({
    receiptId: "receipt_image_a6000_001",
    lane: "image_media",
    gpuSku: "NVIDIA RTX A6000",
    vramGb: 48,
    rateUsdPerHour: 0.42,
    cloudType: "SECURE",
    region: "EU-RO-1",
  }),
  Object.freeze({
    receiptId: "receipt_avatar_rtx4090_001",
    lane: "avatar_primary",
    gpuSku: "NVIDIA RTX 4090",
    vramGb: 24,
    rateUsdPerHour: 0.34,
    cloudType: "SECURE",
    region: "EU-RO-1",
  }),
  Object.freeze({
    receiptId: "receipt_avatar_a6000_001",
    lane: "avatar_primary",
    gpuSku: "NVIDIA RTX A6000",
    vramGb: 48,
    rateUsdPerHour: 0.42,
    cloudType: "SECURE",
    region: "EU-RO-1",
  }),
]);

function liveOffers(): readonly GpuOffer[] {
  const observedAt = new Date();
  const expiresAt = new Date(observedAt.getTime() + 5 * 60_000).toISOString();
  return OFFER_TEMPLATES.map((offer) =>
    Object.freeze({ ...offer, observedAt: observedAt.toISOString(), expiresAt }),
  );
}

function normalizedEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(normalized)) {
    throw new SharedFixtureError("EMAIL_INVALID", 400, "Enter one valid verified email.");
  }
  return normalized;
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashBytes(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function currentOrder(queue: readonly SharedQueueEntry[]): string[] {
  return queue.map((entry) => entry.id);
}

function positions(queue: readonly SharedQueueEntry[]): SharedQueueEntry[] {
  return queue.map((entry, index) => ({ ...entry, position: index + 1 }));
}

function normalizeProviderFreeSnapshot(
  snapshot: ProviderFreeOrchestrationState,
): ProviderFreeOrchestrationState {
  const normalized = structuredClone(snapshot) as ProviderFreeOrchestrationState;
  for (const project of normalized.projects) {
    const barriers = project.barriers as ProviderFreeProjectState["barriers"] &
      Partial<ProviderFreeProjectState["barriers"]>;
    barriers.generationWorkManifestSha256 ??= null;
    barriers.renderWorkManifestSha256 ??= null;
    if (project.finalAsset !== null) {
      const finalAsset = project.finalAsset as ProviderFreeProjectState["finalAsset"] & {
        totalFrames?: number;
        renderer?: "DIRECT_FFMPEG" | "WORKERD_SAFE_FIXTURE";
      };
      finalAsset.totalFrames ??= Math.round((finalAsset.durationMs * 30) / 1_000);
      finalAsset.renderer ??= "WORKERD_SAFE_FIXTURE";
    }
  }
  for (const session of [normalized.session, normalized.lastClosedSession]) {
    if (session === null) continue;
    for (const lane of Object.values(session.lanes)) {
      for (const attempt of lane.attempts) {
        const legacy = attempt as typeof attempt & {
          gpuValidationId?: string;
          gpuValidatedAt?: string;
        };
        legacy.gpuValidationId ??= `legacy-fixture-validation-${attempt.podId}`;
        legacy.gpuValidatedAt ??= attempt.createdAt;
      }
    }
  }
  return normalized;
}

export class SharedAppFixtureStore {
  #state: MutableState;
  readonly #persistence: SharedAppPersistence;
  readonly #artifacts: ProviderFreeArtifactRuntime;
  #orchestrator: ProviderFreeMvpOrchestrator;
  #asyncMutationTail: Promise<void> = Promise.resolve();
  #pendingAsyncMutations = 0;

  constructor(
    persistence: SharedAppPersistence = new MemorySharedAppPersistence(),
    artifacts: ProviderFreeArtifactRuntime = new MemoryProviderFreeArtifactRuntime(),
  ) {
    this.#persistence = persistence;
    this.#artifacts = artifacts;
    const snapshot = persistence.read();
    this.#state = snapshot ? SharedAppFixtureStore.parse(snapshot) : SharedAppFixtureStore.empty();
    this.#orchestrator = new ProviderFreeMvpOrchestrator(this.#state.orchestration);
  }

  reset(): void {
    this.commit(() => {
      this.#state = SharedAppFixtureStore.empty();
      this.#orchestrator = new ProviderFreeMvpOrchestrator(this.#state.orchestration);
    });
  }

  static empty(): MutableState {
    return {
      admissions: new Map(),
      sessionAdmissions: new Map(),
      invites: new Map(),
      sessionId: null,
      pair: null,
      queueVersion: 0,
      queue: [],
      audits: [],
      orchestration: new ProviderFreeMvpOrchestrator().snapshot(),
    };
  }

  static parse(snapshot: string): MutableState {
    const value = JSON.parse(snapshot) as {
      admissions: Admission[];
      sessionAdmissions: [string, Admission][];
      invites: Invite[];
      sessionId: string | null;
      pair: LockedGpuPair | null;
      queueVersion: number;
      queue: SharedQueueEntry[];
      audits: SharedQueueAudit[];
      orchestration?: ProviderFreeOrchestrationState;
    };
    return {
      ...value,
      admissions: new Map(value.admissions.map((item) => [item.email, item])),
      sessionAdmissions: new Map(value.sessionAdmissions),
      invites: new Map(value.invites.map((item) => [item.codeHash, item])),
      orchestration:
        value.orchestration === undefined
          ? new ProviderFreeMvpOrchestrator().snapshot()
          : normalizeProviderFreeSnapshot(value.orchestration),
    };
  }

  exportSnapshot(): string {
    return JSON.stringify({
      ...this.#state,
      admissions: [...this.#state.admissions.values()],
      sessionAdmissions: [...this.#state.sessionAdmissions.entries()],
      invites: [...this.#state.invites.values()],
      orchestration: this.#orchestrator.snapshot(),
    });
  }

  async issueInvite(intendedEmail: string): Promise<{
    code: string;
    emailPassword: string;
    googleAssertion: string;
  }> {
    return this.commitAsync(async () => {
      const email = normalizedEmail(intendedEmail);
      if ([...this.#state.invites.values()].some((invite) => invite.email === email)) {
        throw new SharedFixtureError(
          "INVITE_EMAIL_EXISTS",
          409,
          "One unique invite already exists for this email.",
        );
      }
      const raw = `vf_${crypto.randomUUID()}_${crypto.randomUUID()}`;
      const emailPassword = `vf_pw_${crypto.randomUUID()}`;
      const googleAssertion = `vf_google_${crypto.randomUUID()}_${crypto.randomUUID()}`;
      const codeHash = await hash(raw);
      this.#state.invites.set(codeHash, {
        email,
        codeHash,
        emailPasswordHash: await hash(emailPassword),
        googleAssertionHash: await hash(googleAssertion),
        consumed: false,
      });
      return { code: raw, emailPassword, googleAssertion };
    });
  }

  seedAdmittedSession(sessionId: string, emailValue: string): void {
    this.commit(() => {
      const email = normalizedEmail(emailValue);
      const admission =
        this.#state.admissions.get(email) ??
        Object.freeze({
          email,
          method: "EMAIL_PASSWORD" as const,
          credentialHash: "fixture-bootstrap-identity",
        });
      this.#state.admissions.set(email, admission);
      this.#state.sessionAdmissions.set(sessionId, admission);
    });
  }

  async authenticate(input: {
    sessionId: string;
    method: FixtureAuthMethod;
    email: string;
    emailPassword?: string;
    googleAccountEmail?: string;
    googleAssertion?: string;
    inviteCode?: string;
  }): Promise<{ outcome: "ADMITTED" | "RETURNING"; email: string; rights: "EQUAL" }> {
    return this.commitAsync(async () => {
      const email = normalizedEmail(input.email);
      const presentedCredential =
        input.method === "EMAIL_PASSWORD" ? input.emailPassword : input.googleAssertion;
      if (!presentedCredential || presentedCredential.length < 16) {
        throw new SharedFixtureError(
          "AUTH_CREDENTIAL_REQUIRED",
          403,
          input.method === "EMAIL_PASSWORD"
            ? "The issued email password fixture is required."
            : "The issued Google fixture assertion is required.",
        );
      }
      const presentedCredentialHash = await hash(presentedCredential);
      if (input.method === "GOOGLE") {
        const google = normalizedEmail(input.googleAccountEmail ?? "");
        if (google !== email) {
          throw new SharedFixtureError(
            "GOOGLE_EMAIL_MISMATCH",
            403,
            "Google verified email must equal the login email.",
          );
        }
      }
      const existing = this.#state.admissions.get(email);
      if (existing) {
        if (existing.method !== input.method) {
          throw new SharedFixtureError(
            "AUTH_IDENTITY_CONFLICT",
            409,
            "Use the login method already bound to this email.",
          );
        }
        if (existing.credentialHash !== presentedCredentialHash) {
          throw new SharedFixtureError(
            "AUTH_CREDENTIAL_INVALID",
            403,
            "Fixture credential is invalid.",
          );
        }
        this.#state.sessionAdmissions.set(input.sessionId, existing);
        return { outcome: "RETURNING", email, rights: "EQUAL" };
      }
      if (!input.inviteCode) {
        throw new SharedFixtureError("INVITE_REQUIRED", 403, "A one-time invite code is required.");
      }
      const invite = this.#state.invites.get(await hash(input.inviteCode));
      if (!invite) throw new SharedFixtureError("INVITE_INVALID", 403, "Invite code is invalid.");
      if (invite.consumed)
        throw new SharedFixtureError("INVITE_ALREADY_USED", 409, "Invite code was already used.");
      if (invite.email !== email) {
        throw new SharedFixtureError(
          "INVITE_EMAIL_MISMATCH",
          403,
          "Invite code belongs to another verified email.",
        );
      }
      const expectedCredentialHash =
        input.method === "EMAIL_PASSWORD" ? invite.emailPasswordHash : invite.googleAssertionHash;
      if (presentedCredentialHash !== expectedCredentialHash) {
        throw new SharedFixtureError(
          "AUTH_CREDENTIAL_INVALID",
          403,
          "Fixture credential is invalid.",
        );
      }
      const admission = Object.freeze({
        email,
        method: input.method,
        credentialHash: presentedCredentialHash,
      });
      invite.consumed = true;
      this.#state.admissions.set(email, admission);
      this.#state.sessionAdmissions.set(input.sessionId, admission);
      return { outcome: "ADMITTED", email, rights: "EQUAL" };
    });
  }

  view(sessionId: string): SharedAppView {
    const admission = this.#state.sessionAdmissions.get(sessionId);
    return {
      rights: "EQUAL",
      admission: {
        admitted: admission !== undefined,
        email: admission?.email ?? null,
        authMethod: admission?.method ?? null,
      },
      inventory: liveOffers(),
      session:
        this.#state.sessionId && this.#state.pair
          ? {
              id: this.#state.sessionId,
              queueVersion: this.#state.queueVersion,
              gpuPair: this.#state.pair,
            }
          : null,
      queue: this.#state.queue,
      audits: this.#state.audits,
      orchestration: this.#orchestrator.snapshot(),
      canSelectGpuPair: this.#state.sessionId === null && this.#state.queue.length === 0,
      providerCallsAuthorized: false,
      authorizedSpendUsd: 0,
    };
  }

  startOrEnqueue(input: {
    sessionId: string;
    projectId: string;
    title: string;
    imageReceiptId?: string;
    avatarReceiptId?: string;
  }): { outcome: "STARTED" | "QUEUED"; queueVersion: number } {
    return this.commit(() => {
      const actor = this.requireAdmission(input.sessionId).email;
      const oldOrder = currentOrder(this.#state.queue);
      const oldVersion = this.#state.queueVersion;
      let operation: SharedQueueAudit["operation"];
      let outcome: "STARTED" | "QUEUED";
      let gpuPair: LockedGpuPair | null = null;
      if (this.#state.sessionId === null && this.#state.queue.length === 0) {
        const offers = liveOffers();
        const image = offers.find(
          (offer) => offer.lane === "image_media" && offer.receiptId === input.imageReceiptId,
        );
        const avatar = offers.find(
          (offer) => offer.lane === "avatar_primary" && offer.receiptId === input.avatarReceiptId,
        );
        if (
          !image ||
          !avatar ||
          Date.parse(image.expiresAt) <= Date.now() ||
          Date.parse(avatar.expiresAt) <= Date.now()
        ) {
          throw new SharedFixtureError(
            "GPU_RECEIPT_STALE",
            409,
            "Refresh and select both current GPU offers.",
          );
        }
        this.#state.sessionId = crypto.randomUUID();
        gpuPair = Object.freeze({ image, avatar, lockedAt: new Date().toISOString() });
        this.#state.pair = gpuPair;
        operation = "START";
        outcome = "STARTED";
      } else {
        operation = "ADD";
        outcome = "QUEUED";
      }
      const queueEntryId = crypto.randomUUID();
      this.#state.queueVersion += 1;
      this.#state.queue = positions([
        ...this.#state.queue,
        {
          id: queueEntryId,
          projectId: input.projectId,
          title: input.title,
          state: outcome === "STARTED" ? "ACTIVE" : "WAITING",
          actor,
          position: 0,
          createdAt: new Date().toISOString(),
        },
      ]);
      if (outcome === "STARTED") {
        if (gpuPair === null) throw new Error("Started fixture session is missing its GPU pair.");
        this.#orchestrator.startSession({
          queueEntryId,
          projectId: input.projectId,
          title: input.title,
          gpuPair: {
            mage: {
              receiptId: gpuPair.image.receiptId,
              gpuSku: gpuPair.image.gpuSku,
            },
            echo: {
              receiptId: gpuPair.avatar.receiptId,
              gpuSku: gpuPair.avatar.gpuSku,
            },
          },
        });
      } else {
        this.#orchestrator.addWaiting(queueEntryId, input.projectId, input.title);
      }
      this.audit(operation, actor, oldOrder, oldVersion);
      return { outcome, queueVersion: this.#state.queueVersion };
    });
  }

  reorder(input: {
    sessionId: string;
    entryId: string;
    toPosition: number;
    ifMatch: number;
  }): void {
    this.commit(() => {
      const actor = this.requireAdmission(input.sessionId).email;
      this.requireVersion(input.ifMatch);
      const oldOrder = currentOrder(this.#state.queue);
      const oldVersion = this.#state.queueVersion;
      const index = this.#state.queue.findIndex((entry) => entry.id === input.entryId);
      const entry = this.#state.queue[index];
      if (!entry)
        throw new SharedFixtureError("QUEUE_ENTRY_NOT_FOUND", 404, "Queue entry not found.");
      if (entry.state !== "WAITING")
        throw new SharedFixtureError(
          "ACTIVE_QUEUE_ENTRY_IMMUTABLE",
          409,
          "Active entries cannot move.",
        );
      const waiting = this.#state.queue.filter(
        (item) => item.state === "WAITING" && item.id !== entry.id,
      );
      const target = Math.max(0, Math.min(waiting.length, input.toPosition - 2));
      waiting.splice(target, 0, entry);
      this.#state.queue = positions([
        ...this.#state.queue.filter((item) => item.state === "ACTIVE"),
        ...waiting,
      ]);
      this.#state.queueVersion += 1;
      this.audit("MOVE", actor, oldOrder, oldVersion);
    });
  }

  remove(input: { sessionId: string; entryId: string; ifMatch: number }): void {
    this.commit(() => {
      const actor = this.requireAdmission(input.sessionId).email;
      this.requireVersion(input.ifMatch);
      const oldOrder = currentOrder(this.#state.queue);
      const oldVersion = this.#state.queueVersion;
      const entry = this.#state.queue.find((item) => item.id === input.entryId);
      if (!entry)
        throw new SharedFixtureError("QUEUE_ENTRY_NOT_FOUND", 404, "Queue entry not found.");
      if (entry.state !== "WAITING")
        throw new SharedFixtureError(
          "ACTIVE_QUEUE_ENTRY_IMMUTABLE",
          409,
          "Active entries cannot be removed.",
        );
      this.#state.queue = positions(this.#state.queue.filter((item) => item.id !== input.entryId));
      this.#orchestrator.removeWaiting(entry.projectId);
      this.#state.queueVersion += 1;
      this.audit("REMOVE", actor, oldOrder, oldVersion);
    });
  }

  async advance(): Promise<ProviderFreeAdvanceResult> {
    return this.commitAsync(async () => {
      const waitingProjectIds = this.#state.queue
        .filter((entry) => entry.state === "WAITING")
        .map((entry) => entry.projectId);
      const activeProjectId = this.#orchestrator.snapshot().session?.activeProjectId;
      const activeProject =
        activeProjectId === null || activeProjectId === undefined
          ? undefined
          : this.#orchestrator.project(activeProjectId);
      const bundle =
        activeProjectId === null || activeProjectId === undefined
          ? undefined
          : await buildProviderFreeProjectBundle(activeProjectId);
      const foundations = bundle?.receipts;
      if (bundle !== undefined && activeProject !== undefined) {
        if (["BOOTING", "PREPARING"].includes(activeProject.stage))
          await this.#artifacts.persist(bundle.foundationArtifacts);
      }
      let materialized: ProviderFreeMaterializedReceipts | undefined;
      if (bundle !== undefined && activeProject?.stage === "GENERATING") {
        materialized =
          activeProject.barriers.mageOutputSha256 === null
            ? { mageOutput: await this.#artifacts.laneReceipt(bundle, "mage_image") }
            : activeProject.barriers.echoOutputSha256 === null
              ? { echoOutput: await this.#artifacts.laneReceipt(bundle, "echo_avatar") }
              : undefined;
      } else if (bundle !== undefined && activeProject?.stage === "RENDERING") {
        materialized = { render: await this.#artifacts.render(bundle) };
      }
      const result = await this.#orchestrator.advance(
        waitingProjectIds,
        foundations,
        this.freshGpuRevalidation(),
        materialized,
      );
      this.synchronizeAfterAdvance(result);
      return result;
    });
  }

  cancelActive(sessionId: string): ProviderFreeAdvanceResult {
    return this.commit(() => {
      this.requireAdmission(sessionId);
      const waitingProjectIds = this.#state.queue
        .filter((entry) => entry.state === "WAITING")
        .map((entry) => entry.projectId);
      const result = this.#orchestrator.cancelActive(
        waitingProjectIds,
        this.freshGpuRevalidation(),
      );
      this.synchronizeAfterAdvance(result);
      return result;
    });
  }

  recover(): void {
    this.commit(() => this.#orchestrator.recover());
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
    this.commit(() => this.#orchestrator.acceptLaneCallback(input));
  }

  projectOrchestration(projectId: string): ProviderFreeProjectState {
    return this.#orchestrator.project(projectId);
  }

  assertAdmitted(sessionId: string): void {
    this.requireAdmission(sessionId);
  }

  async finalMp4(projectId: string): Promise<Uint8Array> {
    const project = this.#orchestrator.project(projectId);
    if (project.stage !== "READY_FOR_REVIEW" || project.finalAsset === null)
      throw new SharedFixtureError(
        "PROJECT_DOWNLOAD_NOT_READY",
        409,
        "Every transcript, generation, and render barrier must complete before download.",
      );
    const bytes = await this.#artifacts.read(project.finalAsset.sha256);
    if (bytes === null || bytes.length !== project.finalAsset.byteSize)
      throw new SharedFixtureError(
        "FINAL_ASSET_UNAVAILABLE",
        409,
        "Content-addressed final MP4 bytes are unavailable or incomplete.",
      );
    const actual = `sha256:${await hashBytes(bytes)}`;
    if (actual !== project.finalAsset.sha256)
      throw new SharedFixtureError(
        "FINAL_ASSET_HASH_MISMATCH",
        409,
        "Content-addressed final MP4 bytes failed exact checksum verification.",
      );
    return bytes;
  }

  private synchronizeAfterAdvance(result: ProviderFreeAdvanceResult): void {
    if (result.completedProjectId !== null) {
      this.#state.queue = this.#state.queue.filter(
        (entry) => entry.projectId !== result.completedProjectId,
      );
    }
    if (result.promotedProjectId !== null) {
      this.#state.queue = this.#state.queue.map((entry) =>
        entry.projectId === result.promotedProjectId ? { ...entry, state: "ACTIVE" } : entry,
      );
    }
    this.#state.queue = positions(this.#state.queue);
    if (result.completedProjectId !== null || result.promotedProjectId !== null) {
      this.#state.queueVersion += 1;
    }
    if (result.sessionClosed) {
      if (this.#state.queue.length !== 0) {
        throw new ProviderFreeOrchestrationError(
          "SESSION_CLOSE_QUEUE_NOT_EMPTY",
          "Synthetic session closed while queue still contained work.",
        );
      }
      this.#state.sessionId = null;
      this.#state.pair = null;
    }
  }

  private freshGpuRevalidation(): ProviderFreeGpuRevalidationPair | undefined {
    const pair = this.#state.pair;
    if (pair === null) return undefined;
    const offers = liveOffers();
    const observedAt = new Date();
    const expiresAt = new Date(observedAt.getTime() + 60_000).toISOString();
    const receipt = (locked: GpuOffer, lane: GpuOffer["lane"]) => {
      const current = offers.find(
        (offer) =>
          offer.lane === lane &&
          offer.receiptId === locked.receiptId &&
          offer.gpuSku === locked.gpuSku,
      );
      if (current === undefined)
        throw new SharedFixtureError(
          "GPU_REVALIDATION_UNAVAILABLE",
          409,
          `Locked ${lane} GPU is absent from current fake inventory.`,
        );
      return Object.freeze({
        validationId: `fixture-gpu-validation-${crypto.randomUUID()}`,
        lockedReceiptId: locked.receiptId,
        gpuSku: locked.gpuSku,
        observedAt: observedAt.toISOString(),
        expiresAt,
        providerCallsAuthorized: false as const,
      });
    };
    return Object.freeze({
      mage: receipt(pair.image, "image_media"),
      echo: receipt(pair.avatar, "avatar_primary"),
    });
  }

  private commit<T>(operation: () => T): T {
    if (this.#pendingAsyncMutations > 0)
      throw new SharedFixtureError(
        "SHARED_MUTATION_IN_PROGRESS",
        409,
        "Another shared-app mutation is still committing. Retry from fresh state.",
      );
    const before = this.exportSnapshot();
    try {
      const result = operation();
      this.persist();
      return result;
    } catch (error) {
      this.restore(before);
      throw error;
    }
  }

  private async commitAsync<T>(operation: () => Promise<T>): Promise<T> {
    this.#pendingAsyncMutations += 1;
    const committed = this.#asyncMutationTail.then(async () => {
      const before = this.exportSnapshot();
      try {
        const result = await operation();
        this.persist();
        return result;
      } catch (error) {
        this.restore(before);
        throw error;
      }
    });
    this.#asyncMutationTail = committed.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await committed;
    } finally {
      this.#pendingAsyncMutations -= 1;
    }
  }

  private restore(snapshot: string): void {
    this.#state = SharedAppFixtureStore.parse(snapshot);
    this.#orchestrator = new ProviderFreeMvpOrchestrator(this.#state.orchestration);
  }

  private requireAdmission(sessionId: string): Admission {
    const admission = this.#state.sessionAdmissions.get(sessionId);
    if (!admission)
      throw new SharedFixtureError("ADMISSION_REQUIRED", 403, "Complete invite admission first.");
    return admission;
  }

  private requireVersion(ifMatch: number): void {
    if (ifMatch !== this.#state.queueVersion) {
      throw new SharedFixtureError(
        "QUEUE_VERSION_CONFLICT",
        409,
        "Queue changed. Refresh before retrying.",
      );
    }
  }

  private audit(
    operation: SharedQueueAudit["operation"],
    actor: string,
    oldOrder: string[],
    oldVersion: number,
  ): void {
    this.#state.audits.push({
      id: crypto.randomUUID(),
      operation,
      actor,
      oldOrder,
      newOrder: currentOrder(this.#state.queue),
      oldVersion,
      newVersion: this.#state.queueVersion,
      occurredAt: new Date().toISOString(),
    });
  }

  private persist(): void {
    this.#state.orchestration = this.#orchestrator.snapshot();
    this.#persistence.write(this.exportSnapshot());
  }
}
